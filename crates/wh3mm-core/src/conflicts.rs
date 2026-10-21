//! File-index conflict analysis for enabled packs.
//!
//! Only the PFH5 packed-file index is read: enough to compare entry paths, and
//! never a packed file body. The report is computed from the enabled order, so
//! the last enabled pack that contains a path is the winner, matching WH3's
//! bottom-up load order.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, ErrorCode};
use crate::mod_index::DiscoveredMod;
use crate::paths::GameLocation;
use crate::session::Session;

pub const PFH5_HEADER_LEN: usize = 28;
pub const FILENAME_HASH_MASK: u32 = 0x40;
pub const MAX_FILE_COUNT: u32 = 2_000_000;
pub const MAX_PACK_INDEX_BYTES: u32 = 256 * 1024 * 1024;
pub const MAX_TABLE_SHADOWS: usize = 200;

const FALLBACK_VANILLA_PACKS: &[&str] = &["data.pack", "db.pack", "data_script.pack"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackFileEntry {
    /// Path as stored in the pack, with `/` separators.
    pub path: String,
    pub size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileConflict {
    pub path: String,
    pub winner_mod_id: String,
    pub loser_mod_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingDependency {
    pub mod_id: String,
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatePackName {
    pub name: String,
    pub mod_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisabledDependency {
    pub mod_id: String,
    pub dependency: String,
    pub provider_mod_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseTableShadow {
    pub mod_id: String,
    pub path: String,
    pub base_pack: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictModSummary {
    pub mod_id: String,
    pub name: String,
    /// Conflicting paths this mod wins because it is lower in the load order.
    pub overrides: u32,
    /// Conflicting paths this mod loses to a lower pack.
    pub overridden_on: u32,
    /// Base-game table paths this mod replaces.
    pub base_table_overrides: u32,
    pub file_count: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictReport {
    pub conflicts: Vec<FileConflict>,
    pub missing_dependencies: Vec<MissingDependency>,
    pub duplicate_pack_names: Vec<DuplicatePackName>,
    pub disabled_dependencies: Vec<DisabledDependency>,
    /// A bounded sample; `shadowed_base_table_count` is the full total.
    pub shadowed_base_tables: Vec<BaseTableShadow>,
    pub shadowed_base_table_count: u32,
    pub mod_summaries: Vec<ConflictModSummary>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ConflictInput {
    pub mod_id: String,
    pub name: String,
    pub dependencies: Vec<String>,
    pub files: Vec<PackFileEntry>,
}

#[derive(Debug, Clone)]
pub struct PackAvailability {
    pub mod_id: String,
    pub pack_name: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Default)]
pub struct BaseGameIndex {
    /// Normalized table path -> vanilla pack file name.
    pub tables: BTreeMap<String, String>,
    pub pack_names: HashSet<String>,
    pub warnings: Vec<String>,
}

pub fn read_pack_file_index(path: &Path) -> Result<Vec<PackFileEntry>, AppError> {
    let mut file = File::open(path)
        .map_err(|error| AppError::io_path("Could not open the pack file", path, &error))?;
    let file_len = file
        .metadata()
        .map_err(|error| AppError::io_path("Could not read the pack metadata", path, &error))?
        .len();
    let mut header = [0u8; PFH5_HEADER_LEN];
    file.read_exact(&mut header).map_err(|error| {
        AppError::new(
            ErrorCode::PackParseFailed,
            "The pack file is truncated before its header",
        )
        .with_details(format!("{}: {error}", path.display()))
    })?;
    if &header[0..4] != b"PFH5" {
        return Err(AppError::new(
            ErrorCode::PackParseFailed,
            "The pack file does not start with PFH5",
        )
        .with_details(path.display().to_string()));
    }

    let byte_mask = u32::from_le_bytes(header[4..8].try_into().expect("4 bytes"));
    let dependency_size = u32::from_le_bytes(header[12..16].try_into().expect("4 bytes"));
    let file_count = u32::from_le_bytes(header[16..20].try_into().expect("4 bytes"));
    let index_size = u32::from_le_bytes(header[20..24].try_into().expect("4 bytes"));

    if file_count > MAX_FILE_COUNT {
        return Err(AppError::new(
            ErrorCode::PackParseFailed,
            "The pack declares too many files to index safely",
        )
        .with_details(format!("{file_count} entries in {}", path.display())));
    }
    if index_size > MAX_PACK_INDEX_BYTES {
        return Err(AppError::new(
            ErrorCode::PackParseFailed,
            "The pack file index is larger than the safety cap",
        )
        .with_details(format!("{index_size} bytes in {}", path.display())));
    }
    let index_start = PFH5_HEADER_LEN as u64 + u64::from(dependency_size);
    let index_end = index_start + u64::from(index_size);
    if index_end > file_len {
        return Err(AppError::new(
            ErrorCode::PackParseFailed,
            "The pack file index extends past the end of the file",
        )
        .with_details(format!("{} is {file_len} bytes", path.display())));
    }
    if file_count == 0 || index_size == 0 {
        return Ok(Vec::new());
    }

    file.seek(SeekFrom::Start(index_start))
        .map_err(|error| AppError::io_path("Could not seek to the pack index", path, &error))?;
    let mut index = vec![0u8; index_size as usize];
    file.read_exact(&mut index)
        .map_err(|error| AppError::io_path("Could not read the pack index", path, &error))?;

    let has_filename_hash = byte_mask & FILENAME_HASH_MASK != 0;
    parse_pack_file_index(&index, file_count, has_filename_hash, path)
}

fn parse_pack_file_index(
    index: &[u8],
    file_count: u32,
    has_filename_hash: bool,
    path: &Path,
) -> Result<Vec<PackFileEntry>, AppError> {
    let mut entries = Vec::with_capacity(file_count as usize);
    let mut position = 0usize;
    for entry_number in 0..file_count {
        let remaining = index.len().saturating_sub(position);
        if remaining < 4 {
            return Err(malformed_index(
                path,
                entry_number,
                "the size field is truncated",
            ));
        }
        let size = u32::from_le_bytes(index[position..position + 4].try_into().expect("4 bytes"));
        position += 4;

        if has_filename_hash {
            if index.len().saturating_sub(position) < 4 {
                return Err(malformed_index(
                    path,
                    entry_number,
                    "the filename hash is truncated",
                ));
            }
            position += 4;
        }
        // PFH5 stores a compression bool on every entry. The low header bits
        // identify the pack type, not index flags, so this byte is always read.
        if position >= index.len() {
            return Err(malformed_index(
                path,
                entry_number,
                "the compression flag is truncated",
            ));
        }
        position += 1;

        let Some(relative_end) = index[position..].iter().position(|byte| *byte == 0) else {
            return Err(malformed_index(
                path,
                entry_number,
                "the filename is not null-terminated",
            ));
        };
        let name_end = position + relative_end;
        let raw_name = std::str::from_utf8(&index[position..name_end])
            .map_err(|_| malformed_index(path, entry_number, "the filename is not valid UTF-8"))?;
        if raw_name.is_empty() {
            return Err(malformed_index(path, entry_number, "the filename is empty"));
        }
        entries.push(PackFileEntry {
            path: normalize_display_path(raw_name),
            size,
        });
        position = name_end + 1;
    }
    Ok(entries)
}

fn malformed_index(path: &Path, entry_number: u32, reason: &str) -> AppError {
    AppError::new(
        ErrorCode::PackParseFailed,
        "The pack file index is malformed",
    )
    .with_details(format!("{} entry {entry_number}: {reason}", path.display()))
}

pub fn normalize_display_path(raw: &str) -> String {
    raw.replace('\\', "/")
}

pub fn path_key(raw: &str) -> String {
    normalize_display_path(raw).to_lowercase()
}

pub fn compute_report(
    enabled: &[ConflictInput],
    all_packs: &[PackAvailability],
    duplicate_pack_names: Vec<DuplicatePackName>,
    base: &BaseGameIndex,
) -> ConflictReport {
    let mut warnings = base.warnings.clone();
    let mut file_sets: Vec<HashSet<String>> = Vec::with_capacity(enabled.len());
    let mut display_paths: HashMap<String, String> = HashMap::new();
    for input in enabled {
        let mut files = HashSet::new();
        for entry in &input.files {
            let key = path_key(&entry.path);
            if key.ends_with(".rpfm_reserved") {
                continue;
            }
            files.insert(key.clone());
            display_paths
                .entry(key)
                .or_insert_with(|| normalize_display_path(&entry.path));
        }
        file_sets.push(files);
    }

    let mut occurrences: HashMap<String, Vec<usize>> = HashMap::new();
    for (mod_index, files) in file_sets.iter().enumerate() {
        for key in files {
            occurrences.entry(key.clone()).or_default().push(mod_index);
        }
    }

    let mut conflicts = Vec::new();
    let mut overrides = vec![0u32; enabled.len()];
    let mut overridden = vec![0u32; enabled.len()];
    for (key, mut mod_indexes) in occurrences {
        if mod_indexes.len() < 2 {
            continue;
        }
        mod_indexes.sort_unstable();
        let winner = *mod_indexes.last().expect("at least two entries");
        for loser in &mod_indexes[..mod_indexes.len() - 1] {
            overridden[*loser] += 1;
        }
        overrides[winner] += 1;
        conflicts.push(FileConflict {
            path: display_paths
                .get(&key)
                .cloned()
                .unwrap_or_else(|| key.clone()),
            winner_mod_id: enabled[winner].mod_id.clone(),
            loser_mod_ids: mod_indexes[..mod_indexes.len() - 1]
                .iter()
                .map(|index| enabled[*index].mod_id.clone())
                .collect(),
        });
    }
    conflicts.sort_by(|left, right| left.path.cmp(&right.path));

    let mut base_shadows = Vec::new();
    let mut base_counts = vec![0u32; enabled.len()];
    let mut base_total = 0u32;
    if base.tables.is_empty() {
        warnings.push(
            "Base-game pack indexes were not available; base-game table shadowing was not checked"
                .to_string(),
        );
    } else {
        for (index, files) in file_sets.iter().enumerate() {
            for key in files {
                if !key.starts_with("db/") {
                    continue;
                }
                if let Some(base_pack) = base.tables.get(key) {
                    base_counts[index] += 1;
                    base_total += 1;
                    if base_shadows.len() < MAX_TABLE_SHADOWS {
                        base_shadows.push(BaseTableShadow {
                            mod_id: enabled[index].mod_id.clone(),
                            path: display_paths
                                .get(key)
                                .cloned()
                                .unwrap_or_else(|| key.clone()),
                            base_pack: base_pack.clone(),
                        });
                    }
                }
            }
        }
    }
    base_shadows.sort_by(|left, right| {
        left.mod_id
            .cmp(&right.mod_id)
            .then_with(|| left.path.cmp(&right.path))
    });

    let enabled_names: HashMap<String, (&str, &str)> = all_packs
        .iter()
        .filter(|pack| pack.enabled)
        .map(|pack| {
            (
                pack.pack_name.to_lowercase(),
                (pack.mod_id.as_str(), pack.pack_name.as_str()),
            )
        })
        .collect();
    let disabled_names: HashMap<String, (&str, &str)> = all_packs
        .iter()
        .filter(|pack| !pack.enabled)
        .map(|pack| {
            (
                pack.pack_name.to_lowercase(),
                (pack.mod_id.as_str(), pack.pack_name.as_str()),
            )
        })
        .collect();

    let mut missing_dependencies = Vec::new();
    let mut disabled_dependencies = Vec::new();
    for input in enabled {
        let mut missing = Vec::new();
        for dependency in &input.dependencies {
            let key = dependency.to_lowercase();
            if base.pack_names.contains(&key) || enabled_names.contains_key(&key) {
                continue;
            }
            if let Some((provider_id, _)) = disabled_names.get(&key) {
                disabled_dependencies.push(DisabledDependency {
                    mod_id: input.mod_id.clone(),
                    dependency: dependency.clone(),
                    provider_mod_id: (*provider_id).to_string(),
                });
            } else {
                missing.push(dependency.clone());
            }
        }
        missing.sort_by_key(|name| name.to_lowercase());
        missing.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
        if !missing.is_empty() {
            missing_dependencies.push(MissingDependency {
                mod_id: input.mod_id.clone(),
                missing,
            });
        }
    }
    missing_dependencies.sort_by(|left, right| left.mod_id.cmp(&right.mod_id));
    disabled_dependencies.sort_by(|left, right| {
        left.mod_id
            .cmp(&right.mod_id)
            .then_with(|| left.dependency.cmp(&right.dependency))
    });

    let mod_summaries = enabled
        .iter()
        .enumerate()
        .map(|(index, input)| ConflictModSummary {
            mod_id: input.mod_id.clone(),
            name: input.name.clone(),
            overrides: overrides[index],
            overridden_on: overridden[index],
            base_table_overrides: base_counts[index],
            file_count: file_sets[index].len() as u32,
        })
        .collect();

    ConflictReport {
        conflicts,
        missing_dependencies,
        duplicate_pack_names,
        disabled_dependencies,
        shadowed_base_tables: base_shadows,
        shadowed_base_table_count: base_total,
        mod_summaries,
        warnings,
    }
}

pub fn base_game_index(location: &GameLocation) -> BaseGameIndex {
    let mut index = BaseGameIndex::default();
    if let Ok(entries) = std::fs::read_dir(&location.data_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("pack"))
            {
                if let Some(name) = path.file_name() {
                    index
                        .pack_names
                        .insert(name.to_string_lossy().to_lowercase());
                }
            }
        }
    }
    let manifest = std::fs::read_to_string(location.data_path.join("manifest.txt"));
    let names = match manifest {
        Ok(text) => {
            let mut names: Vec<String> = text
                .lines()
                .filter_map(|line| line.split_whitespace().next())
                .filter(|name| name.to_ascii_lowercase().ends_with(".pack"))
                .map(|name| name.to_ascii_lowercase())
                .collect();
            names.sort();
            names.dedup();
            if names.is_empty() {
                FALLBACK_VANILLA_PACKS
                    .iter()
                    .map(|name| name.to_string())
                    .collect()
            } else {
                names
            }
        }
        Err(_) => FALLBACK_VANILLA_PACKS
            .iter()
            .map(|name| name.to_string())
            .collect(),
    };

    for name in names {
        let path = location.data_path.join(&name);
        if !path.is_file() {
            continue;
        }
        match read_pack_file_index(&path) {
            Ok(entries) => {
                for entry in entries {
                    let key = path_key(&entry.path);
                    if key.starts_with("db/") {
                        index.tables.entry(key).or_insert_with(|| name.clone());
                    }
                }
            }
            Err(error) => index.warnings.push(format!(
                "Could not index base-game pack {name}: {}",
                error.message
            )),
        }
    }
    index
}

impl Session {
    pub fn conflict_report(&self) -> Result<ConflictReport, AppError> {
        self.game_location()?;
        let location = self.location.as_ref().ok_or_else(|| {
            AppError::new(
                ErrorCode::GameNotFound,
                "Could not find a Total War: Warhammer III installation",
            )
        })?;
        let by_id: HashMap<&str, &DiscoveredMod> = self
            .mods
            .iter()
            .map(|module| (module.id.as_str(), module))
            .collect();
        let mut enabled = Vec::new();
        let mut seen = HashSet::new();
        for id in &self.enabled_ids {
            if let Some(module) = by_id.get(id.as_str()) {
                if seen.insert(module.id.as_str()) {
                    enabled.push(*module);
                }
            }
        }

        let mut warnings = Vec::new();
        let mut inputs = Vec::with_capacity(enabled.len());
        for module in enabled {
            match read_pack_file_index(&module.path) {
                Ok(files) => inputs.push(ConflictInput {
                    mod_id: module.id.clone(),
                    name: module.name.clone(),
                    dependencies: module.dependencies.clone(),
                    files,
                }),
                Err(error) => warnings.push(format!(
                    "Could not index {}: {}",
                    module.name, error.message
                )),
            }
        }

        let all_packs: Vec<PackAvailability> = self
            .mods
            .iter()
            .map(|module| PackAvailability {
                mod_id: module.id.clone(),
                pack_name: module.name.clone(),
                enabled: self.enabled_ids.iter().any(|id| id == &module.id),
            })
            .collect();
        let duplicate_pack_names = self
            .index_report
            .duplicates
            .iter()
            .map(|duplicate| DuplicatePackName {
                name: duplicate.name.clone(),
                mod_ids: std::iter::once(duplicate.kept_id.clone())
                    .chain(duplicate.dropped_ids.iter().cloned())
                    .collect(),
            })
            .collect();
        let base = base_game_index(location);
        let mut report = compute_report(&inputs, &all_packs, duplicate_pack_names, &base);
        report.warnings.splice(0..0, warnings);
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::fs;

    fn pack_with_mask(mask: u32, files: &[(&str, &[u8])], has_filename_hash: bool) -> Vec<u8> {
        let mut index = Vec::new();
        for (name, body) in files {
            index.extend_from_slice(&(body.len() as u32).to_le_bytes());
            if has_filename_hash {
                index.extend_from_slice(&0xdead_beefu32.to_le_bytes());
            }
            index.push(0);
            index.extend_from_slice(name.as_bytes());
            index.push(0);
        }
        let mut bytes = vec![0u8; PFH5_HEADER_LEN];
        bytes[0..4].copy_from_slice(b"PFH5");
        bytes[4..8].copy_from_slice(&mask.to_le_bytes());
        bytes[16..20].copy_from_slice(&(files.len() as u32).to_le_bytes());
        bytes[20..24].copy_from_slice(&(index.len() as u32).to_le_bytes());
        bytes[24..28].copy_from_slice(&0x7fff_ffffu32.to_le_bytes());
        bytes.extend_from_slice(&index);
        for (_, body) in files {
            bytes.extend_from_slice(body);
        }
        bytes
    }

    fn pack_with_files(files: &[(&str, &[u8])]) -> Vec<u8> {
        pack_with_mask(3, files, false)
    }

    fn write_pack(path: &Path, files: &[(&str, &[u8])]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, pack_with_files(files)).unwrap();
    }

    fn input(id: &str, name: &str, files: &[&str], dependencies: &[&str]) -> ConflictInput {
        ConflictInput {
            mod_id: id.to_string(),
            name: name.to_string(),
            dependencies: dependencies.iter().map(|name| name.to_string()).collect(),
            files: files
                .iter()
                .map(|path| PackFileEntry {
                    path: (*path).to_string(),
                    size: 1,
                })
                .collect(),
        }
    }

    #[test]
    fn reads_the_pack_file_index_without_file_bodies() {
        let dir = TempDir::new("conflicts-index");
        let path = dir.path().join("mod.pack");
        write_pack(
            &path,
            &[
                ("db\\units_tables\\units", b"1234"),
                ("script\\hello.lua", b"hello"),
            ],
        );
        let entries = read_pack_file_index(&path).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "db/units_tables/units");
        assert_eq!(entries[0].size, 4);
        assert_eq!(entries[1].path, "script/hello.lua");
    }

    #[test]
    fn reads_file_index_entries_for_every_wh3_pack_type() {
        for mask in 0u32..=4 {
            let dir = TempDir::new(&format!("conflicts-type-{mask}"));
            let path = dir.path().join(format!("type-{mask}.pack"));
            fs::write(
                &path,
                pack_with_mask(mask, &[("db\\type_table\\entry", b"body")], false),
            )
            .unwrap();

            let entries = read_pack_file_index(&path).unwrap();
            assert_eq!(entries.len(), 1, "pack type {mask}");
            assert_eq!(entries[0].path, "db/type_table/entry", "pack type {mask}");
        }
    }

    #[test]
    fn reads_hash_flagged_entries_for_every_wh3_pack_type() {
        for pack_type in 0u32..=4 {
            let mask = FILENAME_HASH_MASK | pack_type;
            let dir = TempDir::new(&format!("conflicts-hash-{pack_type}"));
            let path = dir.path().join(format!("hash-{pack_type}.pack"));
            fs::write(
                &path,
                pack_with_mask(mask, &[("db\\hash_table\\entry", b"x")], true),
            )
            .unwrap();

            let entries = read_pack_file_index(&path).unwrap();
            assert_eq!(
                entries[0].path, "db/hash_table/entry",
                "pack type {pack_type}"
            );
        }
    }

    #[test]
    fn base_game_index_reads_patch_and_boot_packs_from_the_manifest() {
        let dir = TempDir::new("conflicts-base-index");
        let data = dir.path().join("data");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("manifest.txt"), "data.pack\npatch.pack\n").unwrap();
        fs::write(
            data.join("data.pack"),
            pack_with_mask(1, &[("db\\units_tables\\unit", b"x")], false),
        )
        .unwrap();
        fs::write(
            data.join("patch.pack"),
            pack_with_mask(2, &[("db\\units_tables\\patch_unit", b"x")], false),
        )
        .unwrap();
        let location = GameLocation {
            game_path: dir.path().to_path_buf(),
            data_path: data,
            workshop_path: std::path::PathBuf::new(),
            steam_root: dir.path().join("steam"),
            proton_prefix: None,
            source: crate::ipc::LocationSource::Manual,
        };

        let index = base_game_index(&location);
        assert!(
            index.warnings.is_empty(),
            "unexpected warnings: {:?}",
            index.warnings
        );
        assert_eq!(
            index.tables.get("db/units_tables/unit").map(String::as_str),
            Some("data.pack")
        );
        assert_eq!(
            index
                .tables
                .get("db/units_tables/patch_unit")
                .map(String::as_str),
            Some("patch.pack")
        );
    }

    #[test]
    fn three_overlapping_mods_use_the_bottom_of_the_order_as_winner() {
        let enabled = vec![
            input("mod-a", "a.pack", &["db\\units_tables\\same", "a.txt"], &[]),
            input("mod-b", "b.pack", &["db\\units_tables\\same", "b.txt"], &[]),
            input("mod-c", "c.pack", &["db\\units_tables\\same", "c.txt"], &[]),
        ];
        let report = compute_report(&enabled, &[], Vec::new(), &BaseGameIndex::default());

        assert_eq!(report.conflicts.len(), 1);
        assert_eq!(report.conflicts[0].path, "db/units_tables/same");
        assert_eq!(report.conflicts[0].winner_mod_id, "mod-c");
        assert_eq!(
            report.conflicts[0].loser_mod_ids,
            vec!["mod-a".to_string(), "mod-b".to_string()]
        );
        let c = report
            .mod_summaries
            .iter()
            .find(|summary| summary.mod_id == "mod-c")
            .unwrap();
        assert_eq!(c.overrides, 1);
        assert_eq!(c.overridden_on, 0);
        let a = report
            .mod_summaries
            .iter()
            .find(|summary| summary.mod_id == "mod-a")
            .unwrap();
        assert_eq!(a.overrides, 0);
        assert_eq!(a.overridden_on, 1);
    }

    #[test]
    fn detects_missing_and_disabled_dependencies() {
        let enabled = vec![input(
            "mod-a",
            "a.pack",
            &[],
            &["base.pack", "missing.pack", "off.pack"],
        )];
        let all_packs = vec![
            PackAvailability {
                mod_id: "mod-a".to_string(),
                pack_name: "a.pack".to_string(),
                enabled: true,
            },
            PackAvailability {
                mod_id: "mod-off".to_string(),
                pack_name: "off.pack".to_string(),
                enabled: false,
            },
        ];
        let mut base = BaseGameIndex::default();
        base.pack_names.insert("base.pack".to_string());
        base.tables
            .insert("db/units_tables/unit".to_string(), "data.pack".to_string());

        let report = compute_report(&enabled, &all_packs, Vec::new(), &base);
        assert_eq!(report.missing_dependencies.len(), 1);
        assert_eq!(
            report.missing_dependencies[0].missing,
            vec!["missing.pack".to_string()]
        );
        assert_eq!(report.disabled_dependencies.len(), 1);
        assert_eq!(
            report.disabled_dependencies[0].provider_mod_id,
            "mod-off".to_string()
        );
    }

    #[test]
    fn reports_base_game_table_shadows() {
        let enabled = vec![input(
            "mod-a",
            "a.pack",
            &["db\\units_tables\\unit", "script\\not_a_table"],
            &[],
        )];
        let mut base = BaseGameIndex::default();
        base.tables
            .insert("db/units_tables/unit".to_string(), "data.pack".to_string());
        let report = compute_report(&enabled, &[], Vec::new(), &base);
        assert_eq!(report.shadowed_base_table_count, 1);
        assert_eq!(report.shadowed_base_tables.len(), 1);
        assert_eq!(report.shadowed_base_tables[0].base_pack, "data.pack");
        assert_eq!(report.mod_summaries[0].base_table_overrides, 1);
    }

    #[test]
    fn malformed_index_is_a_typed_pack_error() {
        let dir = TempDir::new("conflicts-bad-index");
        let path = dir.path().join("bad.pack");
        let mut bytes = vec![0u8; PFH5_HEADER_LEN];
        bytes[0..4].copy_from_slice(b"PFH5");
        bytes[4..8].copy_from_slice(&3u32.to_le_bytes());
        bytes[16..20].copy_from_slice(&1u32.to_le_bytes());
        bytes[20..24].copy_from_slice(&3u32.to_le_bytes());
        bytes.extend_from_slice(&[1, 0, 0]);
        fs::write(&path, bytes).unwrap();
        let error = read_pack_file_index(&path).unwrap_err();
        assert_eq!(error.code, ErrorCode::PackParseFailed);
    }
}
