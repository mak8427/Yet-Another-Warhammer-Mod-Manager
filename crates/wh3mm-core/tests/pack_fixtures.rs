//! Integration contract between the QA fixture set and the real PFH5 header
//! parser. `qa_fixtures.rs` proves what the bytes are; this file proves what the
//! product does with them.
//!
//! Scope note: `read_pack_header` reads the 28-byte header and the dependency
//! table only. Defects inside the packed-file index (declared file count vs
//! entries, unterminated name) are neither read nor validated here; they belong
//! to the conflict/file-index reader (M3). That distinction is asserted below so
//! it cannot drift silently.

use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use wh3mm_core::error::ErrorCode;
use wh3mm_core::pack::{read_pack_header, PackType};

fn fixtures_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn pack_path(name: &str) -> PathBuf {
    fixtures_root().join("packs").join(name)
}

fn parse(name: &str) -> wh3mm_core::error::AppError {
    read_pack_header(&pack_path(name)).expect_err(&format!("{name} must be rejected"))
}

#[test]
fn parses_every_valid_fixture_through_the_product_parser() {
    let minimal = read_pack_header(&pack_path("valid_minimal.pack")).expect("valid_minimal");
    assert_eq!(minimal.format, "PFH5");
    assert_eq!(minimal.version, 5);
    assert_eq!(minimal.header_len, 28);
    assert_eq!(minimal.pack_type, PackType::Data);
    assert_eq!(minimal.file_count, 1);
    assert!(minimal.dependencies.is_empty());
    assert_eq!(minimal.pack_name, "valid_minimal");

    let multi = read_pack_header(&pack_path("valid_multi.pack")).expect("valid_multi");
    assert_eq!(multi.file_count, 3);
    assert_eq!(multi.pack_type, PackType::Data);

    let unicode = read_pack_header(&pack_path("valid_unicode.pack")).expect("valid_unicode");
    assert_eq!(unicode.file_count, 4);

    let with_deps = read_pack_header(&pack_path("valid_with_deps.pack")).expect("valid_with_deps");
    assert_eq!(
        with_deps.dependencies,
        vec![
            "data.pack".to_string(),
            "wh_main_placeholder.pack".to_string()
        ]
    );

    let movie = read_pack_header(&pack_path("valid_movie.pack")).expect("valid_movie");
    assert_eq!(movie.pack_type, PackType::Movie);

    let hashed = read_pack_header(&pack_path("valid_hashed.pack")).expect("valid_hashed");
    assert_ne!(
        hashed.byte_mask & 0x40,
        0,
        "hash bit must survive the parse"
    );
    assert_eq!(hashed.file_count, 2);
}

#[test]
fn rejects_every_header_level_defect_with_a_typed_error() {
    for name in [
        "malformed_bad_magic.pack",
        "malformed_truncated_header.pack",
        "malformed_oversized_dependency_header.pack",
        "malformed_oversized_file_index.pack",
        "malformed_empty.pack",
    ] {
        let error = parse(name);
        assert_eq!(
            error.code,
            ErrorCode::PackParseFailed,
            "{name} must map to pack_parse_failed, got {:?}",
            error
        );
    }
}

#[test]
fn index_level_defects_are_not_misreported_by_the_header_parser() {
    // These two fixtures are genuinely broken, but the damage is inside the
    // packed-file index. The header-only parser must not panic; it currently
    // accepts them. When the M3 file-index reader lands it must reject both.
    for name in [
        "malformed_count_mismatch.pack",
        "malformed_unterminated_name.pack",
    ] {
        let result = catch_unwind(AssertUnwindSafe(|| read_pack_header(&pack_path(name))));
        assert!(result.is_ok(), "{name} must not panic the header parser");
        assert!(
            result.expect("checked above").is_ok(),
            "{name}: documented header-only limitation changed; update this test and QA_PLAN R4"
        );
    }
}

#[test]
fn no_fixture_panics_the_header_parser() {
    let packs = fs::read_dir(fixtures_root().join("packs")).expect("packs fixture dir");
    let mut checked = 0usize;
    for entry in packs {
        let path = entry.expect("fixture entry").path();
        if path.extension().and_then(|value| value.to_str()) != Some("pack") {
            continue;
        }
        let result = catch_unwind(AssertUnwindSafe(|| read_pack_header(&path)));
        assert!(
            result.is_ok(),
            "{} panicked the header parser",
            path.display()
        );
        checked += 1;
    }
    assert!(
        checked >= 13,
        "expected the full pack fixture set, saw {checked}"
    );
}

#[test]
fn malformed_pack_in_a_scan_is_reported_and_does_not_hide_valid_packs() {
    use wh3mm_core::mod_index::{fixture_location, scan};

    let dir = wh3mm_core::test_support::TempDir::new("qa-scan-malformed");
    let data = dir.path().join("data");
    fs::create_dir_all(&data).expect("data dir");
    fs::copy(pack_path("valid_minimal.pack"), data.join("good.pack")).expect("copy good pack");
    fs::copy(pack_path("malformed_bad_magic.pack"), data.join("bad.pack")).expect("copy bad pack");

    let location = fixture_location(dir.path(), None);
    let (mods, report) = scan(&location);

    assert_eq!(
        mods.len(),
        2,
        "a malformed pack must not remove healthy packs"
    );
    let good = mods
        .iter()
        .find(|module| module.name == "good.pack")
        .expect("good mod");
    let bad = mods
        .iter()
        .find(|module| module.name == "bad.pack")
        .expect("bad mod");
    assert!(good.pack_error.is_none());
    assert!(
        bad.pack_error.is_some(),
        "malformed pack must carry a typed error"
    );
    assert!(
        report
            .problems
            .iter()
            .any(|problem| problem.contains("bad.pack")),
        "scan must report the malformed pack: {:?}",
        report.problems
    );
}
