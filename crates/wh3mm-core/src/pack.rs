//! Tolerant PFH5 header parser.
//!
//! The 28-byte PFH5 header carries the byte mask, dependency-index size, file
//! count, packed-file-index size, and reserved words. It does not carry a title
//! or an author; those belong to Workshop metadata (M3). The parser validates
//! every size against the real file length before reading, so a malformed pack
//! turns into a typed error instead of a panic or a huge allocation.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::clock::system_time_to_iso8601;
use crate::error::{AppError, ErrorCode};

pub const PFH5_MAGIC: &[u8; 4] = b"PFH5";
pub const PFH5_HEADER_LEN: usize = 28;
/// Real dependency tables are tiny. Refusing larger ones keeps a corrupt file
/// from making the app allocate a gigabyte while scanning.
pub const MAX_DEPENDENCY_INDEX_BYTES: u32 = 4 * 1024 * 1024;

/// The pack's declared kind, using the legacy `byteMask == 4` movie rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackType {
    Data,
    Movie,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackHeader {
    pub format: String,
    pub version: u8,
    pub header_len: u32,
    pub byte_mask: u32,
    pub pack_type: PackType,
    /// Pack stem, used as the display name until Workshop metadata exists.
    pub pack_name: String,
    pub author: Option<String>,
    pub timestamp: Option<String>,
    pub dependency_index_size: u32,
    pub file_count: u32,
    pub packed_file_index_size: u32,
    pub dependencies: Vec<String>,
}

/// Reads just the PFH5 header (and its dependency table) from disk.
pub fn read_pack_header(path: &Path) -> Result<PackHeader, AppError> {
    let mut file = File::open(path)
        .map_err(|error| AppError::io_path("Could not open the pack file", path, &error))?;
    let metadata = file.metadata().map_err(|error| {
        AppError::io_path("Could not read the pack file metadata", path, &error)
    })?;
    let file_len = metadata.len();
    let mut header = [0u8; PFH5_HEADER_LEN];
    file.read_exact(&mut header).map_err(|error| {
        if error.kind() == std::io::ErrorKind::UnexpectedEof {
            AppError::new(
                ErrorCode::PackParseFailed,
                "The pack file is truncated before its header",
            )
            .with_details(format!("{} is {file_len} bytes", path.display()))
        } else {
            AppError::io_path("Could not read the pack header", path, &error)
        }
    })?;

    let dependency_size = u32::from_le_bytes(header[12..16].try_into().expect("4 bytes"));
    if dependency_size > MAX_DEPENDENCY_INDEX_BYTES {
        return Err(malformed(format!(
            "Dependency index size {dependency_size} exceeds the {} byte safety cap",
            MAX_DEPENDENCY_INDEX_BYTES
        )));
    }
    let mut dependencies = Vec::new();
    if dependency_size > 0 {
        file.seek(SeekFrom::Start(PFH5_HEADER_LEN as u64))
            .map_err(|error| {
                AppError::io_path("Could not seek to the dependency table", path, &error)
            })?;
        dependencies.resize(dependency_size as usize, 0);
        file.read_exact(&mut dependencies).map_err(|error| {
            AppError::new(
                ErrorCode::PackParseFailed,
                "The pack dependency table is truncated",
            )
            .with_details(format!("{}: {error}", path.display()))
        })?;
    }

    let pack_name = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());
    let timestamp = metadata.modified().ok().and_then(system_time_to_iso8601);
    parse_pack_header(&header, &dependencies, file_len, timestamp, pack_name)
}

/// Pure parser used by tests and by `read_pack_header`.
pub fn parse_pack_header(
    header: &[u8],
    dependency_index: &[u8],
    file_len: u64,
    timestamp: Option<String>,
    pack_name: String,
) -> Result<PackHeader, AppError> {
    if header.len() < PFH5_HEADER_LEN {
        return Err(malformed(format!(
            "The pack header is truncated ({} of {PFH5_HEADER_LEN} bytes)",
            header.len()
        )));
    }
    if &header[0..4] != PFH5_MAGIC {
        let magic = String::from_utf8_lossy(&header[0..4]);
        return Err(malformed(format!(
            "Unsupported pack header {magic:?}; expected PFH5"
        )));
    }

    let byte_mask = u32::from_le_bytes(header[4..8].try_into().expect("4 bytes"));
    let dependency_index_size = u32::from_le_bytes(header[12..16].try_into().expect("4 bytes"));
    let file_count = u32::from_le_bytes(header[16..20].try_into().expect("4 bytes"));
    let packed_file_index_size = u32::from_le_bytes(header[20..24].try_into().expect("4 bytes"));

    if dependency_index_size > MAX_DEPENDENCY_INDEX_BYTES {
        return Err(malformed(format!(
            "Dependency index size {dependency_index_size} exceeds the {} byte safety cap",
            MAX_DEPENDENCY_INDEX_BYTES
        )));
    }
    if dependency_index.len() < dependency_index_size as usize {
        return Err(malformed(format!(
            "Dependency table is truncated ({} of {dependency_index_size} bytes)",
            dependency_index.len()
        )));
    }
    let dependency_end = PFH5_HEADER_LEN as u64 + u64::from(dependency_index_size);
    let index_end = dependency_end + u64::from(packed_file_index_size);
    if dependency_end > file_len {
        return Err(malformed(format!(
            "Dependency table ends at {dependency_end}, past the {file_len} byte file"
        )));
    }
    if index_end > file_len {
        return Err(malformed(format!(
            "Packed-file index ends at {index_end}, past the {file_len} byte file"
        )));
    }

    let dependencies = parse_dependency_names(&dependency_index[..dependency_index_size as usize])?;
    Ok(PackHeader {
        format: "PFH5".to_string(),
        version: 5,
        header_len: PFH5_HEADER_LEN as u32,
        byte_mask,
        pack_type: if byte_mask == 4 {
            PackType::Movie
        } else {
            PackType::Data
        },
        pack_name,
        author: None,
        timestamp,
        dependency_index_size,
        file_count,
        packed_file_index_size,
        dependencies,
    })
}

fn parse_dependency_names(bytes: &[u8]) -> Result<Vec<String>, AppError> {
    let mut names = Vec::new();
    for raw in bytes.split(|byte| *byte == 0) {
        if raw.is_empty() {
            continue;
        }
        match std::str::from_utf8(raw) {
            Ok(name) => names.push(name.to_string()),
            Err(_) => {
                return Err(malformed(
                    "The dependency table contains a name that is not valid UTF-8",
                ))
            }
        }
    }
    Ok(names)
}

fn malformed(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::PackParseFailed, message)
}

/// Builds a minimal PFH5 byte sequence. Test-only helper, shared with the
/// integration fixtures so binary blobs stay out of the repository.
pub fn synthetic_pack_bytes(byte_mask: u32, dependencies: &[&str], file_count: u32) -> Vec<u8> {
    let mut dependency_table = Vec::new();
    for dependency in dependencies {
        dependency_table.extend_from_slice(dependency.as_bytes());
        dependency_table.push(0);
    }
    let mut header = vec![0u8; PFH5_HEADER_LEN];
    header[0..4].copy_from_slice(PFH5_MAGIC);
    header[4..8].copy_from_slice(&byte_mask.to_le_bytes());
    header[12..16].copy_from_slice(&(dependency_table.len() as u32).to_le_bytes());
    header[16..20].copy_from_slice(&file_count.to_le_bytes());
    // No packed files, so the index is empty.
    header[20..24].copy_from_slice(&0u32.to_le_bytes());
    header.extend_from_slice(&dependency_table);
    header
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_header() -> Vec<u8> {
        synthetic_pack_bytes(0, &["data.pack", "ünïcode_dep.pack"], 0)
    }

    fn parse(bytes: &[u8]) -> Result<PackHeader, AppError> {
        let dependencies = if bytes.len() >= 28 {
            let size = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
            bytes.get(28..28 + size).unwrap_or(&[])
        } else {
            &[]
        };
        parse_pack_header(
            &bytes[..bytes.len().min(28)],
            dependencies,
            bytes.len() as u64,
            None,
            "testmod".to_string(),
        )
    }

    #[test]
    fn parses_valid_header_and_unicode_dependencies() {
        let header = parse(&valid_header()).unwrap();
        assert_eq!(header.format, "PFH5");
        assert_eq!(header.version, 5);
        assert_eq!(header.header_len, 28);
        assert_eq!(header.pack_type, PackType::Data);
        assert_eq!(header.dependencies, vec!["data.pack", "ünïcode_dep.pack"]);
        assert_eq!(header.pack_name, "testmod");
        assert_eq!(header.author, None);
    }

    #[test]
    fn movie_mask_is_reported() {
        let header = parse(&synthetic_pack_bytes(4, &[], 0)).unwrap();
        assert_eq!(header.pack_type, PackType::Movie);
    }

    #[test]
    fn rejects_truncated_header() {
        let error = parse(b"PFH").unwrap_err();
        assert_eq!(error.code, ErrorCode::PackParseFailed);
    }

    #[test]
    fn rejects_bad_magic() {
        let mut bytes = valid_header();
        bytes[0..4].copy_from_slice(b"PFH4");
        let error = parse(&bytes).unwrap_err();
        assert_eq!(error.code, ErrorCode::PackParseFailed);
        assert!(error.message.contains("PFH4"));
    }

    #[test]
    fn rejects_dependency_table_past_eof() {
        let mut bytes = synthetic_pack_bytes(0, &[], 0);
        bytes[12..16].copy_from_slice(&4096u32.to_le_bytes());
        let error = parse(&bytes).unwrap_err();
        assert_eq!(error.code, ErrorCode::PackParseFailed);
        assert!(error.message.contains("truncated") || error.message.contains("past"));
    }

    #[test]
    fn rejects_invalid_dependency_utf8() {
        let mut bytes = synthetic_pack_bytes(0, &[], 0);
        bytes[12..16].copy_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&[0xff, 0xfe]);
        let error = parse(&bytes).unwrap_err();
        assert_eq!(error.code, ErrorCode::PackParseFailed);
    }

    #[test]
    fn rejects_oversized_dependency_index_without_allocating() {
        let mut bytes = synthetic_pack_bytes(0, &[], 0);
        bytes[12..16].copy_from_slice(&u32::MAX.to_le_bytes());
        let error = parse(&bytes).unwrap_err();
        assert_eq!(error.code, ErrorCode::PackParseFailed);
        assert!(error.message.contains("safety cap"));
    }
}
