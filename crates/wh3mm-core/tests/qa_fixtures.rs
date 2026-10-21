//! Fixture-contract tests for the QA harness.
//!
//! These tests do not exercise product code. They prove that the committed
//! fixtures are exactly what `docs/QA_PLAN.md` claims they are: the valid packs
//! parse, every malformed pack is rejected for its documented reason, the text
//! fixtures keep their encodings, and the manifest lists every data fixture.
//!
//! Product behaviour is covered by the milestone suites
//! (`detection.rs`, `pack_parsing.rs`, `load_order.rs`, `profiles.rs`,
//! `conflicts.rs`). Keeping the checks separate means a broken fixture fails
//! here instead of masquerading as a product regression.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

const PFH5_HEADER_BYTES: usize = 28;
const FILENAME_HASH_MASK: u32 = 0x40;

struct ParsedPack {
    byte_mask: u32,
    dependencies: Vec<String>,
    files: Vec<ParsedFile>,
}

struct ParsedFile {
    name: String,
    compressed: bool,
}

fn fixtures_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn read_fixture(relative: &str) -> Vec<u8> {
    let path = fixtures_root().join(relative);
    fs::read(&path).unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
}

fn read_text_fixture(relative: &str) -> String {
    String::from_utf8(read_fixture(relative))
        .unwrap_or_else(|error| panic!("{relative} is not valid UTF-8: {error}"))
}

fn u32_at(buffer: &[u8], offset: usize) -> Result<u32, String> {
    let bytes = buffer
        .get(offset..offset + 4)
        .ok_or_else(|| format!("u32 at {offset} is truncated"))?;
    Ok(u32::from_le_bytes(
        bytes.try_into().expect("slice length checked"),
    ))
}

/// Independent PFH5 reader used to verify the fixture bytes.
fn parse_pack(buffer: &[u8]) -> Result<ParsedPack, String> {
    if buffer.len() < PFH5_HEADER_BYTES {
        return Err("header_truncated".into());
    }
    let magic = std::str::from_utf8(&buffer[0..4]).unwrap_or("<non-utf8>");
    if magic != "PFH5" {
        return Err(format!("bad_magic:{magic}"));
    }

    let byte_mask = u32_at(buffer, 4)?;
    let dependency_size = u32_at(buffer, 12)? as usize;
    let file_count = u32_at(buffer, 16)? as usize;
    let index_size = u32_at(buffer, 20)? as usize;
    let data_start = PFH5_HEADER_BYTES
        .checked_add(dependency_size)
        .and_then(|value| value.checked_add(index_size))
        .ok_or_else(|| "declared_regions_overflow".to_string())?;
    if data_start > buffer.len() {
        return Err("declared_regions_past_eof".into());
    }

    let dependency_index = &buffer[PFH5_HEADER_BYTES..PFH5_HEADER_BYTES + dependency_size];
    let dependencies = dependency_index
        .split(|byte| *byte == 0)
        .filter(|name| !name.is_empty())
        .map(|name| String::from_utf8_lossy(name).into_owned())
        .collect();

    let index = &buffer[PFH5_HEADER_BYTES + dependency_size..data_start];
    let has_hash = byte_mask & FILENAME_HASH_MASK != 0;
    let mut files = Vec::with_capacity(file_count.min(1024));
    let mut position = 0usize;
    let mut payload_end = data_start;
    for entry in 0..file_count {
        let size = u32_at(index, position).map_err(|_| format!("entry_{entry}_size_truncated"))?;
        position += 4;
        if has_hash {
            if position + 4 > index.len() {
                return Err(format!("entry_{entry}_hash_truncated"));
            }
            position += 4;
        }
        let compressed = *index
            .get(position)
            .ok_or_else(|| format!("entry_{entry}_flag_truncated"))?
            == 1;
        position += 1;
        let name_end = index[position..]
            .iter()
            .position(|byte| *byte == 0)
            .map(|offset| position + offset)
            .ok_or_else(|| format!("entry_{entry}_name_unterminated"))?;
        let name = String::from_utf8_lossy(&index[position..name_end]).into_owned();
        position = name_end + 1;
        payload_end = payload_end
            .checked_add(size as usize)
            .ok_or_else(|| format!("entry_{entry}_payload_overflow"))?;
        if payload_end > buffer.len() {
            return Err(format!("entry_{entry}_payload_past_eof"));
        }
        files.push(ParsedFile { name, compressed });
    }
    if position != index.len() {
        return Err("index_trailing_bytes".into());
    }
    if payload_end != buffer.len() {
        return Err("payload_length_mismatch".into());
    }

    Ok(ParsedPack {
        byte_mask,
        dependencies,
        files,
    })
}

fn parse_valid_pack(relative: &str) -> ParsedPack {
    let buffer = read_fixture(relative);
    parse_pack(&buffer).unwrap_or_else(|reason| panic!("{relative} must parse, got {reason}"))
}

fn assert_rejected(relative: &str, expected_reason: &str) {
    let buffer = read_fixture(relative);
    match parse_pack(&buffer) {
        Ok(_) => panic!("{relative} must be rejected, but it parsed"),
        Err(reason) => assert!(
            reason.starts_with(expected_reason),
            "{relative}: expected rejection {expected_reason}, got {reason}"
        ),
    }
}

fn walk_files(directory: &Path, prefix: &str, files: &mut BTreeSet<String>) {
    for entry in fs::read_dir(directory).expect("fixtures directory must be readable") {
        let entry = entry.expect("fixture directory entry");
        let name = entry.file_name().to_string_lossy().into_owned();
        let relative = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        let file_type = entry.file_type().expect("fixture file type");
        if file_type.is_dir() {
            walk_files(&entry.path(), &relative, files);
        } else {
            files.insert(relative);
        }
    }
}

#[test]
fn valid_pack_fixtures_are_structurally_sound() {
    let minimal = parse_valid_pack("packs/valid_minimal.pack");
    assert_eq!(minimal.files.len(), 1);
    assert_eq!(minimal.files[0].name, "db\\qa\\minimal.txt");
    assert!(minimal.dependencies.is_empty());

    let multi = parse_valid_pack("packs/valid_multi.pack");
    assert_eq!(multi.files.len(), 3);
    assert!(multi.files[1].compressed, "middle entry must be compressed");
    assert!(
        !multi.files[0].compressed,
        "first entry must be uncompressed"
    );

    let unicode = parse_valid_pack("packs/valid_unicode.pack");
    assert_eq!(unicode.files.len(), 4);
    assert!(
        unicode
            .files
            .iter()
            .all(|file| !file.name.is_ascii() && file.name.len() > "db\\qa\\".len()),
        "unicode fixture must use non-ASCII internal names"
    );

    let with_deps = parse_valid_pack("packs/valid_with_deps.pack");
    assert_eq!(
        with_deps.dependencies,
        vec![
            "data.pack".to_string(),
            "wh_main_placeholder.pack".to_string()
        ]
    );

    let movie = parse_valid_pack("packs/valid_movie.pack");
    assert_eq!(movie.byte_mask, 4, "movie packs use byte mask 4");

    let hashed = parse_valid_pack("packs/valid_hashed.pack");
    assert_ne!(hashed.byte_mask & FILENAME_HASH_MASK, 0);
    assert_eq!(hashed.files.len(), 2);
}

#[test]
fn malformed_pack_fixtures_each_fail_for_a_documented_reason() {
    assert_rejected("packs/malformed_bad_magic.pack", "bad_magic");
    assert_rejected("packs/malformed_truncated_header.pack", "header_truncated");
    assert_rejected(
        "packs/malformed_oversized_dependency_header.pack",
        "declared_regions_past_eof",
    );
    assert_rejected(
        "packs/malformed_oversized_file_index.pack",
        "declared_regions_past_eof",
    );
    assert_rejected(
        "packs/malformed_count_mismatch.pack",
        "entry_1_size_truncated",
    );
    assert_rejected(
        "packs/malformed_unterminated_name.pack",
        "entry_0_name_unterminated",
    );
    assert_rejected("packs/malformed_empty.pack", "header_truncated");
}

#[test]
fn used_mods_fixtures_keep_their_encodings_and_defects() {
    let valid = read_text_fixture("load_order/used_mods_valid.txt");
    assert!(valid.ends_with('\n'), "valid fixture must end with LF");
    assert!(valid.contains("mod \"mod with spaces.pack\";"));
    assert!(valid.contains("mod \"mod_ñandú.pack\";"));

    let crlf = read_text_fixture("load_order/used_mods_crlf.txt");
    assert!(crlf.contains("\r\n"));
    assert!(!crlf.replace("\r\n", "").contains('\n'));

    let bom = read_text_fixture("load_order/used_mods_bom.txt");
    assert!(bom.starts_with('\u{feff}'), "BOM fixture must keep its BOM");

    assert!(read_fixture("load_order/used_mods_empty.txt").is_empty());

    let corrupt = read_text_fixture("load_order/used_mods_corrupt.txt");
    assert!(corrupt.contains("mod \"unterminated.pack;"));
    assert!(corrupt.contains("mod mod_without_quotes.pack;"));

    let duplicates = read_text_fixture("load_order/used_mods_duplicates.txt");
    assert!(
        duplicates.matches("mod_a.pack").count() + duplicates.matches("Mod_A.pack").count() >= 2
    );
    assert!(duplicates.contains("MOD_A.PACK"));

    let directives = read_text_fixture("load_order/used_mods_unknown_directive.txt");
    assert_eq!(directives.matches("add_working_directory").count(), 2);

    let no_newline = read_text_fixture("load_order/used_mods_no_final_newline.txt");
    assert!(!no_newline.ends_with('\n'));
}

#[test]
fn steam_metadata_fixtures_cover_the_wh3_app_id() {
    let libraries = read_text_fixture("steam/libraryfolders.vdf");
    assert_eq!(libraries.matches("\"path\"").count(), 3);
    assert!(libraries.contains("1142710"));
    assert!(
        libraries.contains("UnpluggedLibrary"),
        "one library path is missing on purpose"
    );

    let flatpak = read_text_fixture("steam/libraryfolders_flatpak.vdf");
    assert!(flatpak.contains(".var/app/com.valvesoftware.Steam"));

    let malformed = read_text_fixture("steam/libraryfolders_malformed.vdf");
    assert_ne!(
        malformed.matches('{').count(),
        malformed.matches('}').count(),
        "malformed VDF must be unbalanced"
    );

    let app_manifest = read_text_fixture("steam/appmanifest_1142710.acf");
    assert!(app_manifest.contains("\"appid\"\t\t\"1142710\""));
    assert!(app_manifest.contains("Total War: WARHAMMER III"));

    let workshop = read_text_fixture("steam/appworkshop_1142710.acf");
    assert_eq!(workshop.matches("\"WorkshopItemsInstalled\"").count(), 1);
    assert_eq!(workshop.matches("\"WorkshopItemDetails\"").count(), 1);
    assert_eq!(workshop.matches("\"2858184271\"").count(), 2);

    let empty_workshop = read_text_fixture("steam/appworkshop_1142710_empty.acf");
    assert!(empty_workshop.contains("\"WorkshopItemsInstalled\""));
    assert!(!empty_workshop.contains("\"2858184271\""));
}

#[test]
fn config_fixtures_cover_valid_future_unknown_and_corrupt_states() {
    let valid: serde_json::Value =
        serde_json::from_str(&read_text_fixture("config/config_valid.json"))
            .expect("valid config JSON");
    assert_eq!(valid["schemaVersion"], 1);
    assert_eq!(valid["profiles"][0]["name"], "Default");
    assert_eq!(
        valid["profiles"][0]["enabledModIds"]
            .as_array()
            .map(Vec::len),
        Some(2)
    );

    let future: serde_json::Value =
        serde_json::from_str(&read_text_fixture("config/config_future_version.json"))
            .expect("future config JSON");
    assert_eq!(future["schemaVersion"], 2);

    let unknown: serde_json::Value =
        serde_json::from_str(&read_text_fixture("config/config_unknown_fields.json"))
            .expect("unknown-field config JSON");
    assert!(unknown.get("experimental").is_some());
    assert_eq!(unknown["profiles"][1]["id"], "not-a-uuid");

    assert!(
        serde_json::from_str::<serde_json::Value>(&read_text_fixture("config/config_corrupt.json"))
            .is_err(),
        "corrupt config must not parse"
    );
    assert!(
        serde_json::from_str::<serde_json::Value>(&read_text_fixture(
            "config/config_truncated.json"
        ))
        .is_err(),
        "truncated config must not parse"
    );
}

#[test]
fn scale_index_has_500_unique_mods_across_both_sources() {
    let index: serde_json::Value =
        serde_json::from_str(&read_text_fixture("scale/index-500.json")).expect("scale index JSON");
    assert_eq!(index["schema"], "wh3mm.qa.scale-index.v1");
    assert_eq!(index["count"], 500);
    let mods = index["mods"].as_array().expect("mods array");
    assert_eq!(mods.len(), 500);

    let ids: BTreeSet<&str> = mods
        .iter()
        .map(|entry| entry["id"].as_str().expect("mod id"))
        .collect();
    assert_eq!(ids.len(), 500, "scale index ids must be unique");

    let workshop = mods
        .iter()
        .filter(|entry| entry["isWorkshop"] == true)
        .count();
    assert_eq!(workshop, 167, "every third entry is a Workshop mod");
    let malformed = mods
        .iter()
        .filter(|entry| entry["variant"] == "malformed")
        .count();
    assert!(
        malformed >= 28,
        "scale index must include malformed variants"
    );
    let unicode = mods
        .iter()
        .filter(|entry| entry["variant"] == "unicode")
        .count();
    assert!(unicode >= 80, "scale index must include unicode names");
    let disabled = mods
        .iter()
        .filter(|entry| entry["isEnabled"] == false)
        .count();
    assert_eq!(disabled, 125, "every fourth entry is disabled");
}

#[test]
fn fixture_manifest_covers_every_data_fixture() {
    let manifest: serde_json::Value =
        serde_json::from_str(&read_text_fixture("manifest.json")).expect("fixture manifest JSON");
    assert_eq!(manifest["schema"], "wh3mm.qa.fixtures.v1");
    let listed: BTreeSet<String> = manifest["files"]
        .as_object()
        .expect("manifest files object")
        .keys()
        .cloned()
        .collect();

    let mut on_disk = BTreeSet::new();
    walk_files(&fixtures_root(), "", &mut on_disk);
    on_disk.remove("manifest.json");
    on_disk.remove("README.md");

    assert_eq!(
        listed, on_disk,
        "manifest.json and the fixtures directory drifted; run `node scripts/qa/generate-fixtures.mjs --write`"
    );

    let intentionally_empty = [
        "load_order/used_mods_empty.txt",
        "packs/malformed_empty.pack",
    ];
    let mut total_bytes = 0u64;
    for relative in &listed {
        let path = fixtures_root().join(relative);
        let size = fs::metadata(&path)
            .unwrap_or_else(|error| panic!("manifest lists missing {}: {error}", path.display()))
            .len();
        assert!(
            size > 0 || intentionally_empty.contains(&relative.as_str()),
            "{relative} must not be empty"
        );
        total_bytes += size;
    }
    assert!(
        total_bytes < 512 * 1024,
        "committed fixtures must stay small (currently {total_bytes} bytes)"
    );
}
