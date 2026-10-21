use std::fs;
use std::path::Path;

use wh3mm_core::pack::synthetic_pack_bytes;
use wh3mm_core::paths::{
    detect_game, discover_libraries, discover_steam_roots, installed_dir_from_manifest,
    library_paths_from_vdf,
};
use wh3mm_core::test_support::TempDir;

fn write(path: &Path, contents: impl AsRef<[u8]>) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, contents).unwrap();
}

fn steam_root(dir: &TempDir, name: &str) -> std::path::PathBuf {
    let root = dir.path().join(name);
    fs::create_dir_all(root.join("steamapps")).unwrap();
    root
}

#[test]
fn discovers_two_libraries_and_reports_the_missing_one() {
    let dir = TempDir::new("detect-libraries");
    let root = steam_root(&dir, "Steam");
    let second = steam_root(&dir, "SteamLibrary");
    let missing = dir.path().join("MissingLibrary");
    write(
        &root.join("steamapps").join("libraryfolders.vdf"),
        format!(
            r#""libraryfolders"
{{
    "0" {{ "path" "{}" }}
    "1" {{ "path" "{}" }}
    "2" {{ "path" "{}" }}
}}"#,
            root.display(),
            second.display(),
            missing.display()
        ),
    );

    let roots = discover_steam_roots(&[root.clone(), dir.path().join("Nope")]);
    assert_eq!(roots, vec![root.clone()]);
    let (libraries, report) = discover_libraries(&roots);
    assert_eq!(libraries.len(), 2);
    assert_eq!(report.libraries.len(), 2);
    assert!(report.missing_libraries.iter().any(|path| path == &missing));
    assert!(report.problems.is_empty(), "{:?}", report.problems);
}

#[test]
fn detects_a_game_in_a_secondary_library_with_workshop_and_proton_prefix() {
    let dir = TempDir::new("detect-game");
    let root = steam_root(&dir, "Steam");
    let second = steam_root(&dir, "SteamLibrary");
    write(
        &root.join("steamapps").join("libraryfolders.vdf"),
        format!(
            r#""libraryfolders" {{ "0" {{ "path" "{}" }} "1" {{ "path" "{}" }} }}"#,
            root.display(),
            second.display()
        ),
    );

    let game = second
        .join("steamapps")
        .join("common")
        .join("WH3 Custom Install");
    write(
        &game.join("data").join("data.pack"),
        synthetic_pack_bytes(0, &[], 0),
    );
    write(&game.join("Warhammer3.exe"), b"exe");
    write(
        &second.join("steamapps").join("appmanifest_1142710.acf"),
        r#""AppState" { "appid" "1142710" "installdir" "WH3 Custom Install" "StateFlags" "4" }"#,
    );
    fs::create_dir_all(
        second
            .join("steamapps")
            .join("compatdata")
            .join("1142710")
            .join("pfx"),
    )
    .unwrap();

    let roots = discover_steam_roots(std::slice::from_ref(&root));
    let (libraries, _) = discover_libraries(&roots);
    let location = detect_game(&libraries).unwrap();
    assert_eq!(location.game_path, game);
    assert_eq!(location.data_path, game.join("data"));
    assert_eq!(
        location.workshop_path,
        second
            .join("steamapps")
            .join("workshop")
            .join("content")
            .join("1142710")
    );
    assert!(location.proton_prefix.is_some());
    assert_eq!(location.steam_root, root);
}

#[test]
fn falls_back_to_the_conventional_folder_when_the_manifest_is_missing() {
    let dir = TempDir::new("detect-fallback");
    let root = steam_root(&dir, "Steam");
    let game = root
        .join("steamapps")
        .join("common")
        .join("Total War WARHAMMER III");
    write(
        &game.join("data").join("data.pack"),
        synthetic_pack_bytes(0, &[], 0),
    );

    let roots = discover_steam_roots(&[root]);
    let (libraries, _) = discover_libraries(&roots);
    let location = detect_game(&libraries).unwrap();
    assert_eq!(location.game_path, game);
    assert_eq!(location.proton_prefix, None);
}

#[test]
fn vdf_fixture_parses_modern_and_legacy_paths() {
    let vdf = r#"
"libraryfolders"
{
    "0" { "path" "/steam" }
    "1" { "path" "/steam2" }
}
"#;
    let paths = library_paths_from_vdf(vdf, Path::new("/")).unwrap();
    assert_eq!(
        paths,
        vec![
            std::path::PathBuf::from("/steam"),
            std::path::PathBuf::from("/steam2")
        ]
    );

    let manifest = r#""AppState" { "installdir" "Total War WARHAMMER III" }"#;
    assert_eq!(
        installed_dir_from_manifest(manifest).unwrap().as_deref(),
        Some("Total War WARHAMMER III")
    );
}
