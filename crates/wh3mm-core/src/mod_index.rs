//! Mod discovery for the WH3 data folder and the Steam Workshop content folder.

use crate::clock::system_time_to_iso8601;
use crate::pack::{read_pack_header, PackType};
use crate::paths::{lexical_absolute, GameLocation};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

/// The fallback vanilla pack list when `data/manifest.txt` cannot be read.
/// WH3 ships these three; any other pack in `data` is treated as a local mod.
const FALLBACK_VANILLA_PACKS: &[&str] = &["data.pack", "db.pack", "data_script.pack"];

/// A duplicate pack name found during deduplication.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicatePackName {
    pub name: String,
    pub kept_id: String,
    pub dropped_ids: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct IndexReport {
    pub local_candidates: usize,
    pub workshop_candidates: usize,
    pub duplicates: Vec<DuplicatePackName>,
    pub problems: Vec<String>,
}

/// A mod discovered on disk, before user tags and profile state are applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredMod {
    pub id: String,
    pub path: PathBuf,
    pub name: String,
    pub human_name: String,
    pub is_workshop: bool,
    pub workshop_id: Option<String>,
    pub thumbnail_path: Option<PathBuf>,
    pub updated_at: Option<String>,
    pub dependencies: Vec<String>,
    pub pack_error: Option<String>,
    pub is_movie: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Clone)]
struct Candidate {
    path: PathBuf,
    priority: u8,
    is_workshop: bool,
    workshop_id: Option<String>,
    thumbnail: Option<PathBuf>,
}

/// Scans the configured game location and returns a deterministic, deduplicated
/// mod list plus diagnostics. A malformed pack is included with `pack_error`.
pub fn scan(location: &GameLocation) -> (Vec<DiscoveredMod>, IndexReport) {
    let mut report = IndexReport::default();
    let vanilla = vanilla_pack_names(&location.data_path);
    let mut candidates = Vec::new();

    let data_dir = &location.data_path;
    candidates.extend(collect_local(data_dir, 1, &vanilla, &mut report));
    let modding_dir = data_dir.join("modding");
    if modding_dir.is_dir() {
        candidates.extend(collect_local(&modding_dir, 0, &vanilla, &mut report));
    }

    if !location.workshop_path.as_os_str().is_empty() && location.workshop_path.is_dir() {
        candidates.extend(collect_workshop(&location.workshop_path, &mut report));
    }

    candidates.sort_by(|left, right| {
        left.priority
            .cmp(&right.priority)
            .then_with(|| file_name_lower(&left.path).cmp(&file_name_lower(&right.path)))
            .then_with(|| path_sort_key(&left.path).cmp(&path_sort_key(&right.path)))
    });

    let mut kept: Vec<Candidate> = Vec::new();
    let mut by_name: HashMap<String, usize> = HashMap::new();
    for candidate in candidates {
        let name = file_name_lower(&candidate.path);
        if let Some(index) = by_name.get(&name).copied() {
            let id = stable_mod_id(&candidate.path);
            let kept_id = stable_mod_id(&kept[index].path);
            if let Some(duplicate) = report
                .duplicates
                .iter_mut()
                .find(|duplicate| duplicate.name.eq_ignore_ascii_case(&name))
            {
                duplicate.dropped_ids.push(id);
            } else {
                report.duplicates.push(DuplicatePackName {
                    name,
                    kept_id,
                    dropped_ids: vec![id],
                });
            }
        } else {
            by_name.insert(name, kept.len());
            kept.push(candidate);
        }
    }

    let mut mods = kept
        .into_iter()
        .map(|candidate| discover_mod(candidate, &mut report))
        .collect::<Vec<_>>();
    mods.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    (mods, report)
}

fn collect_local(
    dir: &Path,
    priority: u8,
    vanilla: &HashSet<String>,
    report: &mut IndexReport,
) -> Vec<Candidate> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut candidates = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() && !file_type.is_symlink() {
            continue;
        }
        if !is_pack(&path) {
            continue;
        }
        let name = file_name_lower(&path);
        if name == crate::launch::MANAGED_SKIP_INTRO_PACK {
            continue;
        }
        if vanilla.contains(&name) {
            continue;
        }
        report.local_candidates += 1;
        candidates.push(Candidate {
            thumbnail: local_thumbnail(&path),
            path,
            priority,
            is_workshop: false,
            workshop_id: None,
        });
    }
    candidates
}

fn collect_workshop(content_dir: &Path, report: &mut IndexReport) -> Vec<Candidate> {
    let Ok(entries) = fs::read_dir(content_dir) else {
        return Vec::new();
    };
    let mut candidates = Vec::new();
    for entry in entries.flatten() {
        let folder = entry.path();
        if !folder.is_dir() {
            continue;
        }
        let workshop_id = entry.file_name().to_string_lossy().into_owned();
        let mut pack_paths = Vec::new();
        let mut image_paths = Vec::new();
        if let Ok(files) = fs::read_dir(&folder) {
            for file in files.flatten() {
                let path = file.path();
                if !file.file_type().map(|kind| kind.is_file()).unwrap_or(false) {
                    continue;
                }
                if is_pack(&path) {
                    pack_paths.push(path);
                } else if is_image(&path) {
                    image_paths.push(path);
                }
            }
        }
        pack_paths.sort_by_key(|path| path_sort_key(path));
        image_paths.sort_by_key(|path| path_sort_key(path));
        let pack_count = pack_paths.len();
        let Some(pack) = pack_paths.into_iter().next() else {
            report
                .problems
                .push(format!("Workshop item {workshop_id} has no .pack file"));
            continue;
        };
        if pack_count > 1 {
            report.problems.push(format!(
                "Workshop item {workshop_id} has multiple .pack files; using {}",
                pack.display()
            ));
        }
        report.workshop_candidates += 1;
        candidates.push(Candidate {
            path: pack,
            priority: 2,
            is_workshop: true,
            workshop_id: Some(workshop_id),
            thumbnail: image_paths.into_iter().next(),
        });
    }
    candidates
}

fn discover_mod(candidate: Candidate, report: &mut IndexReport) -> DiscoveredMod {
    let path = candidate.path;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.clone());
    let metadata = fs::metadata(&path).ok();
    let size_bytes = metadata
        .as_ref()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let updated_at = metadata
        .as_ref()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(system_time_to_iso8601);
    let (dependencies, pack_error, is_movie) = match read_pack_header(&path) {
        Ok(header) => (
            header.dependencies,
            None,
            header.pack_type == PackType::Movie,
        ),
        Err(error) => {
            report.problems.push(format!(
                "Could not parse {}: {}",
                path.display(),
                error.message
            ));
            (Vec::new(), Some(error.message), false)
        }
    };

    DiscoveredMod {
        id: stable_mod_id(&path),
        path,
        name,
        human_name: stem,
        is_workshop: candidate.is_workshop,
        workshop_id: candidate.workshop_id,
        thumbnail_path: candidate.thumbnail,
        updated_at,
        dependencies,
        pack_error,
        is_movie,
        size_bytes,
    }
}

fn vanilla_pack_names(data_dir: &Path) -> HashSet<String> {
    let mut names = HashSet::new();
    if let Ok(manifest) = fs::read_to_string(data_dir.join("manifest.txt")) {
        for line in manifest.lines() {
            if let Some(first) = line.split_whitespace().next() {
                if first.to_ascii_lowercase().ends_with(".pack") {
                    names.insert(first.to_ascii_lowercase());
                }
            }
        }
    }
    if names.is_empty() {
        names.extend(FALLBACK_VANILLA_PACKS.iter().map(|name| name.to_string()));
    }
    names
}

fn local_thumbnail(pack_path: &Path) -> Option<PathBuf> {
    let stem = pack_path.file_stem()?;
    for extension in ["png", "jpg", "jpeg", "webp"] {
        let candidate = pack_path.with_file_name(format!("{}.{extension}", stem.to_string_lossy()));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn is_pack(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("pack"))
}

fn is_image(path: &Path) -> bool {
    path.extension().is_some_and(|extension| {
        matches!(
            extension.to_string_lossy().to_ascii_lowercase().as_str(),
            "png" | "jpg" | "jpeg" | "webp"
        )
    })
}

fn file_name_lower(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn path_sort_key(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Opaque mod identity derived from the lexical absolute path. Case-folded on
/// Windows, case-preserving elsewhere; separators normalized to `/`.
pub fn stable_mod_id(path: &Path) -> String {
    let absolute = lexical_absolute(path);
    let text = absolute.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    {
        text.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        text
    }
}

/// Returns a timestamp string for a file, used by tests and future scanners.
pub fn file_timestamp(path: &Path) -> Option<String> {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(system_time_to_iso8601)
}

/// Convenient for tests that construct a location without Steam.
pub fn fixture_location(game_path: &Path, workshop_path: Option<PathBuf>) -> GameLocation {
    GameLocation {
        game_path: lexical_absolute(game_path),
        data_path: lexical_absolute(game_path).join("data"),
        workshop_path: workshop_path
            .map(|path| lexical_absolute(&path))
            .unwrap_or_default(),
        steam_root: PathBuf::new(),
        proton_prefix: None,
        source: crate::ipc::LocationSource::Manual,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pack::synthetic_pack_bytes;
    use crate::test_support::TempDir;

    fn write(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn scans_local_and_workshop_mods_with_thumbnails() {
        let dir = TempDir::new("index-basic");
        let game = dir.path().join("game");
        let data = game.join("data");
        fs::create_dir_all(&data).unwrap();
        write(&data.join("manifest.txt"), b"data.pack\nboot.pack\n");
        write(
            &data.join("z_ünïcode.pack"),
            &synthetic_pack_bytes(0, &["data.pack"], 0),
        );
        write(&data.join("z_ünïcode.png"), b"png");
        write(&data.join("data.pack"), &synthetic_pack_bytes(0, &[], 0));

        let workshop = dir.path().join("workshop").join("1142710");
        write(
            &workshop.join("123456").join("workshop_mod.pack"),
            &synthetic_pack_bytes(0, &[], 0),
        );
        write(&workshop.join("123456").join("thumb.jpg"), b"jpg");
        write(&workshop.join("999").join("broken.pack"), b"not a pack");

        let location = fixture_location(&game, Some(workshop));
        let (mods, report) = scan(&location);

        assert_eq!(mods.len(), 3, "vanilla data.pack must be filtered");
        let unicode = mods.iter().find(|m| m.name == "z_ünïcode.pack").unwrap();
        assert_eq!(unicode.human_name, "z_ünïcode");
        assert_eq!(unicode.dependencies, vec!["data.pack"]);
        assert!(unicode.thumbnail_path.is_some());
        assert!(unicode.id.contains("z_ünïcode.pack"));
        assert!(!unicode.is_workshop);

        let workshop_mod = mods.iter().find(|m| m.name == "workshop_mod.pack").unwrap();
        assert!(workshop_mod.is_workshop);
        assert_eq!(workshop_mod.workshop_id.as_deref(), Some("123456"));
        assert!(workshop_mod.thumbnail_path.is_some());

        let broken = mods.iter().find(|m| m.name == "broken.pack").unwrap();
        assert!(broken.pack_error.is_some());
        assert_eq!(report.local_candidates, 1);
        assert_eq!(report.workshop_candidates, 2);
    }

    #[test]
    fn deduplicates_pack_names_with_data_winning_over_workshop() {
        let dir = TempDir::new("index-dupe");
        let game = dir.path().join("game");
        let data = game.join("data");
        fs::create_dir_all(&data).unwrap();
        write(&data.join("same.pack"), &synthetic_pack_bytes(0, &[], 0));
        let workshop = dir.path().join("workshop").join("1142710");
        write(
            &workshop.join("42").join("SAME.PACK"),
            &synthetic_pack_bytes(0, &[], 0),
        );

        let (mods, report) = scan(&fixture_location(&game, Some(workshop)));
        assert_eq!(mods.len(), 1);
        assert!(!mods[0].is_workshop);
        assert_eq!(report.duplicates.len(), 1);
        assert_eq!(report.duplicates[0].name, "same.pack");
        assert_eq!(report.duplicates[0].dropped_ids.len(), 1);
    }

    #[test]
    fn stable_ids_are_separator_normalized_and_absolute() {
        let dir = TempDir::new("index-id");
        let path = dir.path().join("mod.pack");
        fs::write(&path, synthetic_pack_bytes(0, &[], 0)).unwrap();
        let id = stable_mod_id(Path::new("relative/../mod.pack"));
        assert!(id.ends_with("mod.pack"));
        assert!(!id.contains('\\'));
        assert_eq!(stable_mod_id(&path), stable_mod_id(&path));
    }
}
