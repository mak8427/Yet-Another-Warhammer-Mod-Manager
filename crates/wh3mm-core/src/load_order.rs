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
    /// Deduplicated `add_working_directory` paths, first occurrence wins.
    pub working_directories: Vec<String>,
    /// Lines that are not managed `mod`/`add_working_directory` statements,
    /// kept verbatim for the warning report.
    pub unmanaged: Vec<String>,
    /// Names repeated in the file (case-insensitive).
    pub duplicates: Vec<String>,
    /// Lines that start with a managed keyword but do not match the grammar.
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
                "used_mods.txt contains {} malformed managed line(s): {}",
                self.corrupt_lines.len(),
                self.corrupt_lines.join(" | ")
            ))
        }
    }
}

pub fn used_mods_path(game_dir: &Path) -> PathBuf {
    game_dir.join(USED_MODS_FILE)
}

/// Formats a search directory for the Windows game, including under Proton.
/// A bare Unix absolute path is rooted on the current Windows drive; Proton exposes the
/// Unix filesystem through its default Z: drive instead.
pub(crate) fn game_working_directory(directory: &Path) -> String {
    let directory = directory.to_string_lossy().into_owned();
    if cfg!(target_os = "linux") && directory.starts_with('/') {
        format!("Z:{directory}")
    } else {
        directory
    }
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
    let mut seen_directories = std::collections::HashSet::new();

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
        } else if let Some(rest) = strip_working_directory_keyword(trimmed) {
            match parse_working_directory_statement(rest) {
                Some(directory) => {
                    let key = directory.to_lowercase();
                    if seen_directories.insert(key) {
                        parsed.working_directories.push(directory);
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
    parse_quoted_statement(rest)
}

const WORKING_DIRECTORY_KEYWORD: &str = "add_working_directory";

fn strip_working_directory_keyword(line: &str) -> Option<&str> {
    let bytes = line.as_bytes();
    if bytes.len() < WORKING_DIRECTORY_KEYWORD.len()
        || !bytes[..WORKING_DIRECTORY_KEYWORD.len()]
            .eq_ignore_ascii_case(WORKING_DIRECTORY_KEYWORD.as_bytes())
    {
        return None;
    }
    let rest = &line[WORKING_DIRECTORY_KEYWORD.len()..];
    if rest.is_empty() {
        return Some("");
    }
    let next = rest.as_bytes()[0];
    if next.is_ascii_whitespace() || next == b'"' {
        Some(rest)
    } else {
        None
    }
}

fn parse_working_directory_statement(rest: &str) -> Option<String> {
    parse_quoted_statement(rest)
}

fn parse_quoted_statement(rest: &str) -> Option<String> {
    let rest = rest.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    let value = &rest[..end];
    if value.is_empty() {
        return None;
    }
    let tail = rest[end + 1..].trim();
    if tail != ";" {
        return None;
    }
    Some(value.to_string())
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
///
/// A read failure (sharing violation, permissions, a directory in place of the
/// file) is reported through [`LoadOrderFile::unreadable`] instead of failing:
/// startup must stay alive so the user can fix the file, and writes are blocked
/// from that flag by [`plan_write`].
pub fn read_file(path: &Path) -> LoadOrderFile {
    let backup_available = backup_path(path).is_file();
    match fs::read(path) {
        Ok(bytes) => match parse_used_mods(&bytes) {
            Ok(parsed) => LoadOrderFile {
                path: path.to_path_buf(),
                present: true,
                corrupt_message: parsed.corrupt_message(),
                parsed,
                backup_available,
                unreadable: None,
            },
            Err(error) => LoadOrderFile {
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
            },
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => LoadOrderFile {
            path: path.to_path_buf(),
            present: false,
            parsed: ParsedUsedMods::default(),
            corrupt_message: None,
            backup_available,
            unreadable: None,
        },
        Err(error) => LoadOrderFile {
            path: path.to_path_buf(),
            present: true,
            parsed: ParsedUsedMods::default(),
            corrupt_message: None,
            backup_available,
            unreadable: Some(format!(
                "Could not read {}: {error}",
                path.to_string_lossy()
            )),
        },
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedName {
    pub id: String,
    pub name: String,
    /// Directory the game must search for this pack. `None` means the game's
    /// normal `data` directory, which needs no `add_working_directory` line.
    pub directory: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WritePlan {
    pub path: PathBuf,
    pub backup_path: Option<PathBuf>,
    pub content: Vec<u8>,
    pub working_directories: Vec<String>,
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
    let existing = read_file(path);
    let existing_mod_count = existing.parsed.mod_names.len();
    let unmanaged_directives = existing.parsed.unmanaged.clone();
    let would_drop_unmanaged = !unmanaged_directives.is_empty();

    let mut names = Vec::with_capacity(resolved.len());
    let mut working_directories = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut seen_directories = std::collections::HashSet::new();
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
        if let Some(directory) = &planned.directory {
            let directory = game_working_directory(directory);
            validate_working_directory(&directory)?;
            if seen_directories.insert(directory.to_lowercase()) {
                working_directories.push(directory);
            }
        }
    }

    let content = render(&working_directories, &names);
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
        working_directories,
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

fn validate_working_directory(directory: &str) -> Result<(), AppError> {
    if directory.trim().is_empty() {
        return Err(AppError::validation(
            "A mod working directory cannot be empty",
        ));
    }
    if directory.contains('"') || directory.contains('\n') || directory.contains('\r') {
        return Err(AppError::validation(format!(
            "The working directory {directory:?} cannot be written to used_mods.txt"
        )));
    }
    Ok(())
}

fn render(working_directories: &[String], names: &[String]) -> Vec<u8> {
    let mut lines = Vec::with_capacity(working_directories.len() + names.len());
    for directory in working_directories {
        lines.push(format!("add_working_directory \"{directory}\";"));
    }
    for name in names {
        lines.push(format!("mod \"{name}\";"));
    }
    lines.join("\n").into_bytes()
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
    Ok(read_file(path))
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
                directory: None,
            })
            .collect()
    }

    #[test]
    fn parses_bom_crlf_duplicates_unicode_and_unmanaged_lines() {
        let bytes = "\u{feff}mod \"a.pack\";\r\n\r\n add_working_directory \"x\";\r\nsome_directive \"y\";\r\nmod \"b ünï.pack\" ;\r\nMOD \"A.PACK\";\r\nmod \"missing;".as_bytes();
        let parsed = parse_used_mods(bytes).unwrap();
        assert!(parsed.had_bom);
        assert!(parsed.had_crlf);
        assert_eq!(parsed.mod_names, vec!["a.pack", "b ünï.pack"]);
        assert_eq!(parsed.working_directories, vec!["x"]);
        assert_eq!(parsed.duplicates, vec!["A.PACK"]);
        assert_eq!(parsed.unmanaged, vec!["some_directive \"y\";"]);
        assert_eq!(parsed.corrupt_lines, vec!["mod \"missing;"]);
        assert!(parsed.is_corrupt());
    }

    #[test]
    fn parses_and_deduplicates_working_directories() {
        let parsed = parse_used_mods(
            b"add_working_directory \"C:/mods/a\";\nADD_WORKING_DIRECTORY \"C:/MODS/A\";\nmod \"a.pack\";",
        )
        .unwrap();

        assert_eq!(parsed.working_directories, vec!["C:/mods/a"]);
        assert!(parsed.unmanaged.is_empty());
        assert!(!parsed.is_corrupt());
    }

    #[test]
    fn malformed_working_directory_is_a_managed_corrupt_line() {
        let parsed = parse_used_mods(b"add_working_directory \"unterminated").unwrap();

        assert!(parsed.is_corrupt());
        assert_eq!(
            parsed.corrupt_lines,
            vec!["add_working_directory \"unterminated"]
        );
    }

    #[test]
    fn rejects_invalid_utf8() {
        let error = parse_used_mods(&[0xff, 0xfe]).unwrap_err();
        assert_eq!(error.code, ErrorCode::ConfigCorrupt);
    }

    #[test]
    fn windows_and_relative_working_directories_are_preserved() {
        for directory in [
            "C:/Steam/workshop/123",
            r"D:\Steam\workshop\123",
            "Z:/mnt/mods",
            "../mods",
        ] {
            assert_eq!(game_working_directory(Path::new(directory)), directory);
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn unix_workshop_paths_are_written_for_proton_with_order_and_backup_preserved() {
        let dir = TempDir::new("used-mods-proton");
        let path = dir.path().join(USED_MODS_FILE);
        let original =
            "add_working_directory \"/mnt/Steam Library/mods ü/123\";\nmod \"old.pack\";"
                .as_bytes();
        fs::write(&path, original).unwrap();
        let mut resolved = names(&[("1", "b.pack"), ("2", "a.pack")]);
        for planned in &mut resolved {
            planned.directory = Some(PathBuf::from("/mnt/Steam Library/mods ü/123"));
        }

        let plan = plan_write(&path, &resolved, &[], false, false).unwrap();
        let expected = "add_working_directory \"Z:/mnt/Steam Library/mods ü/123\";\nmod \"b.pack\";\nmod \"a.pack\";";
        assert!(plan.can_write);
        assert_eq!(plan.content, expected.as_bytes());
        assert_eq!(
            plan.working_directories,
            vec!["Z:/mnt/Steam Library/mods ü/123"]
        );
        write_plan(&plan).unwrap();
        assert_eq!(fs::read(backup_path(&path)).unwrap(), original);
        assert_eq!(fs::read(&path).unwrap(), expected.as_bytes());
    }

    #[test]
    fn write_round_trip_is_byte_stable_and_creates_backup() {
        let dir = TempDir::new("used-mods-roundtrip");
        let path = dir.path().join(USED_MODS_FILE);
        fs::write(&path, "mod \"old.pack\";\n").unwrap();

        let mut resolved = names(&[("1", "b.pack"), ("2", "a.pack")]);
        resolved[0].directory = Some(PathBuf::from("C:/mods"));
        let plan = plan_write(&path, &resolved, &[], false, false).unwrap();
        assert!(plan.can_write);
        assert_eq!(
            plan.content,
            b"add_working_directory \"C:/mods\";\nmod \"b.pack\";\nmod \"a.pack\";"
        );
        assert_eq!(plan.working_directories, vec!["C:/mods"]);
        let backup = write_plan(&plan).unwrap();
        assert_eq!(backup, Some(backup_path(&path)));
        assert_eq!(fs::read(&path).unwrap(), plan.content);
        assert_eq!(
            fs::read(backup_path(&path)).unwrap(),
            b"mod \"old.pack\";\n"
        );

        let reread = read_file(&path);
        assert_eq!(reread.parsed.mod_names, vec!["b.pack", "a.pack"]);
        assert_eq!(reread.parsed.working_directories, vec!["C:/mods"]);
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
        fs::write(&path, "some_directive \"C:/x\";\nmod \"a.pack\";\n").unwrap();
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
    fn unreadable_file_is_reported_and_blocks_every_write() {
        let dir = TempDir::new("used-mods-unreadable");
        let path = dir.path().join(USED_MODS_FILE);
        // A directory at the file's path makes `fs::read` fail deterministically
        // on every platform, without relying on chmod or file locks.
        fs::create_dir(&path).unwrap();
        fs::write(backup_path(&path), "mod \"good.pack\";\n").unwrap();

        let file = read_file(&path);
        assert!(file.present);
        assert!(!file.is_corrupt());
        assert!(file.unreadable.is_some());
        assert!(file.backup_available);

        let plan = plan_write(&path, &names(&[("1", "a.pack")]), &[], false, false).unwrap();
        assert!(!plan.can_write);
        assert!(plan.unreadable);
        assert!(plan.hard_blocked);
        assert!(plan
            .blocked_reason
            .as_deref()
            .unwrap_or_default()
            .contains("could not be read"));
        let error = write_plan(&plan).unwrap_err();
        assert_eq!(error.code, ErrorCode::ConfigCorrupt);
        assert!(path.is_dir());
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
