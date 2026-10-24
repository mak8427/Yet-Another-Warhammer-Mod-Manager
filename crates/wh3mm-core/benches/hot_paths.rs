//! Release-mode Criterion benchmarks for the paths users feel (WAR-7).
//!
//! Fixtures are the deterministic 100/500/2000 trees from
//! `scripts/perf/generate-suite.mjs`, the same bytes QA and the legacy A/B use.
//! Run the whole suite with `scripts/perf/bench.sh`, or manually:
//!
//! ```bash
//! node scripts/perf/generate-suite.mjs
//! cargo bench -p wh3mm-core --bench hot_paths --locked
//! ```
//!
//! `WH3MM_PERF_FIXTURE=/path/to/perf-fixture` overrides the generated tree.
//! A missing tree is a hard error: measuring an empty directory would be a lie.

use std::collections::HashSet;
use std::env;
use std::fs;
use std::hint::black_box;
use std::path::{Path, PathBuf};

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use wh3mm_core::config;
use wh3mm_core::load_order::{self, PlannedName};
use wh3mm_core::mod_index;
use wh3mm_core::pack::{self, parse_pack_header, PFH5_HEADER_LEN};
use wh3mm_core::paths::GameLocation;
use wh3mm_core::session::{Session, SessionOptions};
use wh3mm_core::test_support::TempDir;

const SIZES: &[usize] = &[100, 500, 2000];

fn fixture_root() -> PathBuf {
    env::var_os("WH3MM_PERF_FIXTURE")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../perf-fixture"))
}

/// Returns the game root and the location the scanner expects for one fixture size.
fn fixture(count: usize) -> (PathBuf, GameLocation) {
    let root = fixture_root().join(format!("wh3-{count}"));
    if !root.join("data").is_dir() {
        panic!(
            "missing fixture {}; run `node scripts/perf/generate-suite.mjs` first",
            root.display()
        );
    }
    let workshop = root.join("content").join("1142710");
    let location = mod_index::fixture_location(&root, Some(workshop));
    (root, location)
}

fn vanilla_names(data_dir: &Path) -> HashSet<String> {
    fs::read_to_string(data_dir.join("manifest.txt"))
        .unwrap_or_default()
        .lines()
        .filter_map(|line| line.split_whitespace().next())
        .filter(|name| name.to_ascii_lowercase().ends_with(".pack"))
        .map(|name| name.to_ascii_lowercase())
        .collect()
}

/// Every candidate pack the scanner would open, minus the vanilla manifest entries.
fn mod_pack_paths(location: &GameLocation) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let vanilla = vanilla_names(&location.data_path);
    if let Ok(entries) = fs::read_dir(&location.data_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            if path.extension().is_some_and(|ext| ext == "pack") && !vanilla.contains(&name) {
                paths.push(path);
            }
        }
    }
    if let Ok(items) = fs::read_dir(&location.workshop_path) {
        for item in items.flatten() {
            if let Ok(files) = fs::read_dir(item.path()) {
                for file in files.flatten() {
                    let path = file.path();
                    if path.extension().is_some_and(|ext| ext == "pack") {
                        paths.push(path);
                    }
                }
            }
        }
    }
    paths.sort();
    paths
}

fn bench_pack_header(c: &mut Criterion) {
    let (_, location) = fixture(500);
    let packs = mod_pack_paths(&location);
    assert!(!packs.is_empty(), "fixture has no packs");

    let valid = packs
        .iter()
        .find(|path| pack::read_pack_header(path).is_ok())
        .expect("fixture has at least one valid pack")
        .clone();
    let bytes = fs::read(&valid).expect("read valid pack");
    let dependency_size = u32::from_le_bytes(bytes[12..16].try_into().expect("4 bytes")) as usize;
    let header = &bytes[..PFH5_HEADER_LEN];
    let dependencies = bytes
        .get(PFH5_HEADER_LEN..PFH5_HEADER_LEN + dependency_size)
        .unwrap_or(&[]);

    let mut group = c.benchmark_group("pack_header");
    group.bench_function("parse_pure", |b| {
        b.iter(|| {
            parse_pack_header(
                black_box(header),
                black_box(dependencies),
                black_box(bytes.len() as u64),
                None,
                black_box("perf_mod".to_string()),
            )
            .unwrap()
        })
    });
    group.bench_function("read_file", |b| {
        b.iter(|| pack::read_pack_header(black_box(&valid)).unwrap())
    });
    group.throughput(Throughput::Elements(packs.len() as u64));
    group.bench_function("batch_500", |b| {
        b.iter(|| {
            let mut parsed = 0usize;
            for path in &packs {
                if pack::read_pack_header(black_box(path)).is_ok() {
                    parsed += 1;
                }
            }
            parsed
        })
    });
    group.finish();
}

fn bench_mod_index(c: &mut Criterion) {
    let mut group = c.benchmark_group("mod_index");
    for &count in SIZES {
        let (_, location) = fixture(count);
        group.throughput(Throughput::Elements(count as u64));
        group.bench_with_input(BenchmarkId::new("scan", count), &location, |b, location| {
            b.iter(|| mod_index::scan(black_box(location)))
        });
    }
    group.finish();
}

fn bench_used_mods(c: &mut Criterion) {
    let dir = TempDir::new("bench-used-mods");
    let path = dir.path().join(load_order::USED_MODS_FILE);
    let names: Vec<PlannedName> = (0..500)
        .map(|index| PlannedName {
            id: format!("mod-{index}"),
            name: format!("perf_mod_{index:04}.pack"),
            directory: None,
        })
        .collect();
    let initial = names
        .iter()
        .map(|name| format!("mod \"{}\";", name.name))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&path, &initial).expect("seed used_mods.txt");
    let bytes = initial.into_bytes();

    let mut group = c.benchmark_group("used_mods");
    group.bench_function("parse_500", |b| {
        b.iter(|| load_order::parse_used_mods(black_box(&bytes)).unwrap())
    });
    group.bench_function("plan_500", |b| {
        b.iter(|| {
            load_order::plan_write(black_box(&path), black_box(&names), &[], false, false).unwrap()
        })
    });
    group.bench_function("write_500", |b| {
        b.iter(|| {
            let plan =
                load_order::plan_write(black_box(&path), black_box(&names), &[], false, false)
                    .unwrap();
            load_order::write_plan(&plan).unwrap()
        })
    });
    // A restore needs a `.bak`; the first write above created one, and later
    // restores leave it in place by design.
    let plan = load_order::plan_write(&path, &names, &[], false, false).unwrap();
    load_order::write_plan(&plan).unwrap();
    group.bench_function("restore_500", |b| {
        b.iter(|| load_order::restore_backup(black_box(&path)).unwrap())
    });
    group.finish();
}

fn bench_session(c: &mut Criterion) {
    let (root, _) = fixture(500);
    let config_dir = TempDir::new("bench-session");
    let config_path = config_dir.path().join(config::CONFIG_FILE);
    let options = || SessionOptions {
        config_path: config_path.clone(),
        steam_root_candidates: Some(Vec::new()),
        manual_game_path: Some(root.clone()),
        log_timings: false,
    };
    // Seed the config once so the benchmark measures a normal start, not first-run creation.
    let mut session = Session::initialize(options()).expect("seed session");

    let mut group = c.benchmark_group("session");
    group.bench_function("startup_500", |b| {
        b.iter(|| Session::initialize(options()).unwrap())
    });

    let all_ids: Vec<String> = session
        .mods
        .iter()
        .map(|module| module.id.clone())
        .collect();
    let all = session
        .save_profile(None, "Perf All", all_ids)
        .expect("create profile");
    let all_id = all.id.clone();
    group.bench_function("profile_switch_500", |b| {
        b.iter(|| session.apply_profile(&all_id).unwrap())
    });
    group.bench_function("profile_restore_config_500", |b| {
        b.iter(|| config::load_or_create(black_box(&config_path)).unwrap())
    });
    group.finish();
}

criterion_group!(
    benches,
    bench_pack_header,
    bench_mod_index,
    bench_used_mods,
    bench_session
);
criterion_main!(benches);
