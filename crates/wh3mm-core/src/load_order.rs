//! `used_mods.txt` compatibility: tolerant parsing, safe planning, atomic writes,
//! and explicit backup recovery.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::atomic::{atomic_write_no_backup, atomic_write_with_backup};
use crate::error::{AppError, ErrorCode};

pub const USED_MODS_FILE: &str = "used_mods.txt";
pub const BACKUP_SUFFIX: &str = ".bak";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedUsedMods {
    /// Deduplicated managed names, first occurrence wins.
    pub mod_names: Vec<String>,
    /// Lines that are not `mod "name";`, kept verbatim for the warning report.
    pub unmanaged: Vec<String>,
    /// Names repeated in the file (case-insensitive).
    pub duplicates: Vec<String>,
    /// Lines that start with `mod` but do not match the grammar.
    pub corrupt_lines: Vec<String>,
    pub had_bom: bool,
    pub had_crlf: bool,
}

impl ParsedUsedMods {
    pub fn is_corrupt(&self) -> bool {
        !self.corrupt_lines.is_empty()
    }

    pub fn corrupt_message(&self) -> Option<String> {
        if self.corrupt_lines.is_empty() {
            None
        } else {
            Some(format!(
                "used_mods.txt contains {} malformed mod line(s): {}",
                self.corrupt_lines.len(),
                self.corrupt_lines.join(" | ")
            ))
        }
    }
}

pub fn used_mods_path(game_dir: &Path) -> PathBuf {
    game_dir.join(USED_MODS_FILE)
}

pub fn backup_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| USED_MODS_FILE.to_string());
    path.with_file_name(format!("{name}{BACKUP_SUFFIX}"))
}

/// Parses bytes from `used_mods.txt`. Invalid UTF-8 is a corrupt file; malformed
/// `mod` lines are recorded so the UI can refuse to overwrite without a restore.
pub fn parse_used_mods(bytes: &[u8]) -> Result<ParsedUsedMods, AppError> {
    let (bytes, had_bom) = match bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        Some(rest) => (rest, true),
        None => (bytes, false),
    };
    let text = std::str::from_utf8(bytes).map_err(|error| {
        AppError::new(ErrorCode::ConfigCorrupt, "used_mods.txt is not valid UTF-8")
            .with_details(error.to_string())
    })?;
    let had_crlf = text.contains("\r\n");
    let mut parsed = ParsedUsedMods {
        had_bom,
        had_crlf,
        ..ParsedUsedMods::default()
    };
    let mut seen = std::collections::HashSet::new();

    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(rest) = strip_mod_keyword(trimmed) {
            match parse_mod_statement(rest) {
                Some(name) => {
                    let key = name.to_lowercase();
                    if seen.insert(key) {
                        parsed.mod_names.push(name);
                    } else {
                        parsed.duplicates.push(name);
                    }
                }
                None => parsed.corrupt_lines.push(trimmed.to_string()),
            }
        } else {
            parsed.unmanaged.push(trimmed.to_string());
        }
    }
    Ok(parsed)
}

fn strip_mod_keyword(line: &str) -> Option<&str> {
    let bytes = line.as_bytes();
    if bytes.len() < 3 || !bytes[..3].eq_ignore_ascii_case(b"mod") {
        return None;
    }
    if bytes.len() == 3 {
        return Some("");
    }
    let next = bytes[3];
    if next.is_ascii_whitespace() || next == b'"' {
        Some(&line[3..])
    } else {
        None
    }
}

fn parse_mod_statement(rest: &str) -> Option<String> {
    let rest = rest.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    let name = &rest[..end];
    if name.is_empty() {
        return None;
    }
    let tail = rest[end + 1..].trim();
    if tail != ";" {
        return None;
    }
    Some(name.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadOrderFile {
    pub path: PathBuf,
    pub present: bool,
    pub parsed: ParsedUsedMods,
    pub corrupt_message: Option<String>,
    pub backup_available: bool,
    /// True when the file could not be read at all (not just absent).
    pub unreadable: Option<String>,
}

impl LoadOrderFile {
    pub fn is_corrupt(&self) -> bool {
        self.corrupt_message.is_some()
    }
}

/// Reads `used_mods.txt` without changing anything.
pub fn read_file(path: &Path) -> Result<LoadOrderFile, AppError> {
    let backup_available = backup_path(path).is_file();
    match fs::read(path) {
        Ok(bytes) => match parse_used_mods(&bytes) {
            Ok(parsed) => Ok(LoadOrderFile {
                path: path.to_path_buf(),
                present: true,
                corrupt_message: parsed.corrupt_message(),
                parsed,
                backup_available,
                unreadable: None,
            }),
            Err(error) => Ok(LoadOrderFile {
                path: path.to_path_buf(),
                present: true,
                parsed: ParsedUsedMods::default(),
                corrupt_message: Some(format!(
                    "{}: {}",
                    error.message,
                    error.details.unwrap_or_default()
                )),
                backup_available,
                unreadable: None,
            }),
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(LoadOrderFile {
            path: path.to_path_buf(),
            present: false,
            parsed: ParsedUsedMods::default(),
            corrupt_message: None,
            backup_available,
            unreadable: None,
        }),
        Err(error) => Err(AppError::io_path(
            "Could not read used_mods.txt",
            path,
            &error,
        )),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedName {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WritePlan {
    pub path: PathBuf,
    pub backup_path: Option<PathBuf>,
    pub content: Vec<u8>,
    pub written: usize,
    pub skipped: Vec<String>,
    pub unmanaged_directives: Vec<String>,
    pub would_drop_unmanaged: bool,
    pub existing_mod_count: usize,
    pub resulting_mod_count: usize,
    pub can_write: bool,
    pub blocked_reason: Option<String>,
    pub corrupt: bool,
    pub unreadable: bool,
    pub requires_empty_confirmation: bool,
    pub requires_unmanaged_confirmation: bool,
    pub hard_blocked: bool,
}

/// Builds the exact bytes that a write would produce and explains every reason
/// the write could be refused. Performs no mutation.
pub fn plan_write(
    path: &Path,
    resolved: &[PlannedName],
    unresolved: &[String],
    allow_empty: bool,
    confirm_unmanaged_loss: bool,
) -> Result<WritePlan, AppError> {
    let existing = read_file(path)?;
    let existing_mod_count = existing.parsed.mod_names.len();
    let unmanaged_directives = existing.parsed.unmanaged.clone();
    let would_drop_unmanaged = !unmanaged_directives.is_empty();

    let mut names = Vec::with_capacity(resolved.len());
    let mut seen = std::collections::HashSet::new();
    for planned in resolved {
        validate_pack_name(&planned.name)?;
        let key = planned.name.to_lowercase();
        if !seen.insert(key) {
            return Err(AppError::validation(format!(
                "The enabled set contains two mods named {:?}",
                planned.name
            )));
        }
        names.push(planned.name.clone());
    }

    let content = render(&names);
    let resulting_mod_count = names.len();
    let mut blocked_reason = None;
    if existing.unreadable.is_some() {
        blocked_reason =
            Some("used_mods.txt could not be read; refusing to overwrite it".to_string());
    } else if existing.corrupt_message.is_some() {
        blocked_reason =
            Some("used_mods.txt is corrupt; restore the backup before writing again".to_string());
    } else if resolved.is_empty() && !unresolved.is_empty() {
        blocked_reason = Some(
            "None of the enabled mods could be resolved to a discovered pack; refusing to write an empty file"
                .to_string(),
        );
    } else if resulting_mod_count == 0 && existing_mod_count > 0 && !allow_empty {
        blocked_reason = Some(
            "This would remove every mod from used_mods.txt; confirm the disable-all write first"
                .to_string(),
        );
    } else if would_drop_unmanaged && !confirm_unmanaged_loss {
        blocked_reason = Some(
            "used_mods.txt contains unmanaged directives that this write would remove; confirm their loss first"
                .to_string(),
        );
    }

    let can_write = blocked_reason.is_none();
    let requires_empty_confirmation =
        resulting_mod_count == 0 && existing_mod_count > 0 && !allow_empty;
    let requires_unmanaged_confirmation = would_drop_unmanaged && !confirm_unmanaged_loss;
    let hard_blocked = existing.unreadable.is_some()
        || existing.corrupt_message.is_some()
        || (resolved.is_empty() && !unresolved.is_empty());
    Ok(WritePlan {
        path: path.to_path_buf(),
        backup_path: existing.present.then(|| backup_path(path)),
        content,
        written: resulting_mod_count,
        skipped: unresolved.to_vec(),
        unmanaged_directives,
        would_drop_unmanaged,
        existing_mod_count,
        resulting_mod_count,
        can_write,
        blocked_reason,
        corrupt: existing.corrupt_message.is_some(),
        unreadable: existing.unreadable.is_some(),
        requires_empty_confirmation,
        requires_unmanaged_confirmation,
        hard_blocked,
    })
}

fn validate_pack_name(name: &str) -> Result<(), AppError> {
    if name.trim().is_empty() {
        return Err(AppError::validation("A mod has an empty pack file name"));
    }
    if name.contains('"') || name.contains('\n') || name.contains('\r') {
        return Err(AppError::validation(format!(
            "The pack file name {name:?} cannot be written to used_mods.txt"
        )));
    }
    Ok(())
}

fn render(names: &[String]) -> Vec<u8> {
    let mut text = String::new();
    for (index, name) in names.iter().enumerate() {
        if index > 0 {
            text.push('\n');
        }
        text.push_str("mod \"");
        text.push_str(name);
        text.push_str("\";");
    }
    text.into_bytes()
}

/// Executes a plan. Refuses when the plan says the write is unsafe.
pub fn write_plan(plan: &WritePlan) -> Result<Option<PathBuf>, AppError> {
    if !plan.can_write {
        let code = if plan.corrupt || plan.unreadable {
            ErrorCode::ConfigCorrupt
        } else {
            ErrorCode::Validation
        };
        return Err(AppError::new(
            code,
            plan.blocked_reason
                .clone()
                .unwrap_or_else(|| "The load-order write was refused".to_string()),
        ));
    }
    atomic_write_with_backup(&plan.path, &plan.content, plan.backup_path.as_deref())
        .map_err(|error| AppError::io_path("Could not write used_mods.txt", &plan.path, &error))
}

/// Restores the previous `used_mods.txt` from `.bak` atomically, leaving the
/// backup intact so a repeated restore remains possible.
pub fn restore_backup(path: &Path) -> Result<LoadOrderFile, AppError> {
    let backup = backup_path(path);
    let bytes = fs::read(&backup).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            AppError::not_found("There is no used_mods.txt.bak to restore")
        } else {
            AppError::io_path("Could not read used_mods.txt.bak", &backup, &error)
        }
    })?;
    let parsed = parse_used_mods(&bytes)?;
    if parsed.is_corrupt() {
        return Err(AppError::corrupt(
            "The used_mods.txt backup is also malformed; refusing to restore it",
        ));
    }
    atomic_write_no_backup(path, &bytes)
        .map_err(|error| AppError::io_path("Could not restore used_mods.txt", path, &error))?;
    read_file(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    fn names(values: &[(&str, &str)]) -> Vec<PlannedName> {
        values
            .iter()
            .map(|(id, name)| PlannedName {
                id: (*id).to_string(),
                name: (*name).to_string(),
            })
            .collect()
    }

    #[test]
    fn parses_bom_crlf_duplicates_unicode_and_unmanaged_lines() {
        let bytes = "\u{feff}mod \"a.pack\";\r\n\r\n add_working_directory \"x\";\r\nmod \"b ünï.pack\" ;\r\nMOD \"A.PACK\";\r\nmod \"missing;".as_bytes();
        let parsed = parse_used_mods(bytes).unwrap();
        assert!(parsed.had_bom);
        assert!(parsed.had_crlf);
        assert_eq!(parsed.mod_names, vec!["a.pack", "b ünï.pack"]);
        assert_eq!(parsed.duplicates, vec!["A.PACK"]);
        assert_eq!(parsed.unmanaged, vec!["add_working_directory \"x\";"]);
        assert_eq!(parsed.corrupt_lines, vec!["mod \"missing;"]);
        assert!(parsed.is_corrupt());
    }

    #[test]
    fn rejects_invalid_utf8() {
        let error = parse_used_mods(&[0xff, 0xfe]).unwrap_err();
        assert_eq!(error.code, ErrorCode::ConfigCorrupt);
    }

    #[test]
    fn write_round_trip_is_byte_stable_and_creates_backup() {
        let dir = TempDir::new("used-mods-roundtrip");
        let path = dir.path().join(USED_MODS_FILE);
        fs::write(&path, "mod \"old.pack\";\n").unwrap();

        let plan = plan_write(
            &path,
            &names(&[("1", "b.pack"), ("2", "a.pack")]),
            &[],
            false,
            false,
        )
        .unwrap();
        assert!(plan.can_write);
        assert_eq!(plan.content, b"mod \"b.pack\";\nmod \"a.pack\";");
        let backup = write_plan(&plan).unwrap();
        assert_eq!(backup, Some(backup_path(&path)));
        assert_eq!(fs::read(&path).unwrap(), plan.content);
        assert_eq!(
            fs::read(backup_path(&path)).unwrap(),
            b"mod \"old.pack\";\n"
        );

        let reread = read_file(&path).unwrap();
        assert_eq!(reread.parsed.mod_names, vec!["b.pack", "a.pack"]);
        assert!(!reread.is_corrupt());
    }

    #[test]
    fn refuses_empty_write_over_existing_mods() {
        let dir = TempDir::new("used-mods-empty");
        let path = dir.path().join(USED_MODS_FILE);
        fs::write(&path, "mod \"a.pack\";\n").unwrap();
        let plan = plan_write(&path, &[], &[], false, false).unwrap();
        assert!(!plan.can_write);
        assert!(plan.blocked_reason.unwrap().contains("every mod"));
        assert_eq!(plan.existing_mod_count, 1);
        assert_eq!(plan.resulting_mod_count, 0);
    }

    #[test]
    fn allow_empty_permits_disable_all() {
        let dir = TempDir::new("used-mods-empty-ok");
        let path = dir.path().join(USED_MODS_FILE);
        fs::write(&path, "mod \"a.pack\";\n").unwrap();
        let plan = plan_write(&path, &[], &[], true, false).unwrap();
        assert!(plan.can_write);
        write_plan(&plan).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"");
    }

    #[test]
    fn refuses_to_drop_unmanaged_directives_without_confirmation() {
        let dir = TempDir::new("used-mods-unmanaged");
        let path = dir.path().join(USED_MODS_FILE);
        fs::write(&path, "add_working_directory \"C:/x\";\nmod \"a.pack\";\n").unwrap();
        let plan = plan_write(&path, &names(&[("1", "a.pack")]), &[], false, false).unwrap();
        assert!(!plan.can_write);
        assert!(plan.would_drop_unmanaged);
        assert_eq!(plan.unmanaged_directives.len(), 1);

        let confirmed = plan_write(&path, &names(&[("1", "a.pack")]), &[], false, true).unwrap();
        assert!(confirmed.can_write);
        write_plan(&confirmed).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"mod \"a.pack\";");
    }

    #[test]
    fn unresolved_enabled_set_is_refused() {
        let dir = TempDir::new("used-mods-unresolved");
        let path = dir.path().join(USED_MODS_FILE);
        let plan = plan_write(&path, &[], &["gone".to_string()], false, false).unwrap();
        assert!(!plan.can_write);
        assert!(plan.blocked_reason.unwrap().contains("could be resolved"));
    }

    #[test]
    fn corrupt_file_is_refused_and_backup_can_be_restored() {
        let dir = TempDir::new("used-mods-corrupt");
        let path = dir.path().join(USED_MODS_FILE);
        fs::write(&path, "mod \"unterminated;\n").unwrap();
        fs::write(backup_path(&path), "mod \"good.pack\";\n").unwrap();

        let plan = plan_write(&path, &names(&[("1", "a.pack")]), &[], false, false).unwrap();
        assert!(!plan.can_write);
        assert!(plan.corrupt);
        let error = write_plan(&plan).unwrap_err();
        assert_eq!(error.code, ErrorCode::ConfigCorrupt);

        let restored = restore_backup(&path).unwrap();
        assert_eq!(restored.parsed.mod_names, vec!["good.pack"]);
        assert_eq!(fs::read(&path).unwrap(), b"mod \"good.pack\";\n");
        assert!(backup_path(&path).is_file());
    }

    #[test]
    fn rejects_quotes_in_pack_names() {
        let dir = TempDir::new("used-mods-quote");
        let path = dir.path().join(USED_MODS_FILE);
        let error =
            plan_write(&path, &names(&[("1", "bad\"name.pack")]), &[], false, false).unwrap_err();
        assert_eq!(error.code, ErrorCode::Validation);
    }

    #[test]
    fn missing_parent_is_an_io_error_and_leaves_nothing_behind() {
        let dir = TempDir::new("used-mods-parent");
        let path = dir.path().join("missing").join(USED_MODS_FILE);
        let plan = plan_write(&path, &names(&[("1", "a.pack")]), &[], false, false).unwrap();
        let error = write_plan(&plan).unwrap_err();
        assert_eq!(error.code, ErrorCode::Io);
        assert!(!path.exists());
    }
}
