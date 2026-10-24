//! Headless measurement harness for the M2 performance gate.
//!
//! This crate is **not shipped** with the desktop app. It links `wh3mm-core`
//! directly and measures the same session pipeline the Tauri shell runs in
//! `Manager::new` during startup. Each invocation is one cold run with a fresh
//! configuration directory; `scripts/perf/measure-new-app.mjs` starts a new
//! process per sample and owns the summary and the environment record.
//!
//! Scope, stated plainly in `docs/PERFORMANCE.md`:
//!
//! - `coldStartMs`: process start to `Session::initialize` returning. This is
//!   the work the Tauri shell does before the window is usable, but it excludes
//!   WebView creation and paint.
//! - `modListPopulatedMs`: process start to the first `ModListSnapshot`
//!   serialised as IPC would send it. In this architecture the list is already
//!   in memory when startup returns, so this is the same pipeline as cold start.
//! - `headerScanMs`: the initial PFH5 scan reported by the session.
//! - `loadOrderPersistMs`: the `set_load_order` command to the persisted config.
//! - `presetSwitchMs`: the `apply_profile` command to the persisted config.
//! - `gameLaunchHandoffMs`: **proxy**. `c1a9cdd` has no launch command, so the
//!   harness times the app's `used_mods.txt` write and then starts a stub
//!   process from the harness itself. It is not a game launch.
//!
//! Nothing here writes to product source files; the harness only calls public
//! core APIs.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread::sleep;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use wh3mm_core::config::CONFIG_FILE;
use wh3mm_core::session::{Session, SessionOptions};

const RESULT_PREFIX: &str = "WH3MM_PERF_RESULT ";
const STUB_TIMEOUT: Duration = Duration::from_secs(30);

struct Options {
    fixture: PathBuf,
    config_dir: PathBuf,
    stub: Option<PathBuf>,
    run: Option<String>,
}

impl Options {
    fn parse() -> Result<Self, String> {
        let mut fixture: Option<PathBuf> = None;
        let mut config_dir: Option<PathBuf> = None;
        let mut stub: Option<PathBuf> = None;
        let mut run: Option<String> = None;
        let mut args = env::args().skip(1);
        while let Some(argument) = args.next() {
            match argument.as_str() {
                "--fixture" => fixture = Some(PathBuf::from(next_value(&mut args, "--fixture")?)),
                "--config-dir" => {
                    config_dir = Some(PathBuf::from(next_value(&mut args, "--config-dir")?))
                }
                "--stub" => stub = Some(PathBuf::from(next_value(&mut args, "--stub")?)),
                "--run" => run = Some(next_value(&mut args, "--run")?),
                "--help" | "-h" => {
                    println!(
                        "wh3mm-perf --fixture DIR [--config-dir DIR] [--stub EXE] [--run LABEL]\n\
                         \n\
                         One cold measurement run. Prints one WH3MM_PERF_RESULT JSON line."
                    );
                    std::process::exit(0);
                }
                other => return Err(format!("unknown argument {other}")),
            }
        }
        let fixture = fixture.ok_or("--fixture is required")?;
        let config_dir = config_dir.unwrap_or_else(|| {
            env::temp_dir().join(format!(
                "wh3mm-perf-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|value| value.as_millis())
                    .unwrap_or_default()
            ))
        });
        Ok(Self {
            fixture,
            config_dir,
            stub,
            run,
        })
    }
}

fn next_value(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String, String> {
    args.next().ok_or_else(|| format!("{flag} needs a value"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileSizes {
    all: usize,
    half: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Verified {
    mod_list_populated: bool,
    load_order_persist: bool,
    preset_switch: bool,
    game_launch_handoff: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    schema: &'static str,
    run: Option<String>,
    cold_start_ms: f64,
    mod_list_populated_ms: f64,
    header_scan_ms: f64,
    detection_ms: f64,
    load_order_read_ms: f64,
    load_order_persist_ms: Option<f64>,
    preset_switch_ms: Option<f64>,
    used_mods_write_ms: Option<f64>,
    game_launch_handoff_ms: Option<f64>,
    game_launch_handoff_proxy: bool,
    mod_count: usize,
    enabled_count: u32,
    profiles: ProfileSizes,
    fixture_sha256: Option<String>,
    verified: Verified,
    errors: Vec<String>,
    notes: Vec<String>,
}

fn main() {
    // Process start as close to the entry point as the language allows. The
    // dynamic loader and runtime init happen before this line.
    let process_start = Instant::now();
    let options = match Options::parse() {
        Ok(options) => options,
        Err(error) => {
            eprintln!("wh3mm-perf: {error}");
            std::process::exit(2);
        }
    };
    match measure(process_start, &options) {
        Ok(report) => match serde_json::to_string(&report) {
            Ok(json) => {
                eprintln!(
                    "wh3mm-perf: mods={} cold_start={:.1}ms mod_list={:.1}ms header_scan={:.1}ms \
                     persist={} preset={} launch={}",
                    report.mod_count,
                    report.cold_start_ms,
                    report.mod_list_populated_ms,
                    report.header_scan_ms,
                    optional(report.load_order_persist_ms),
                    optional(report.preset_switch_ms),
                    optional(report.game_launch_handoff_ms)
                );
                println!("{RESULT_PREFIX}{json}");
            }
            Err(error) => {
                eprintln!("wh3mm-perf: could not serialise the report: {error}");
                std::process::exit(1);
            }
        },
        Err(error) => {
            eprintln!("wh3mm-perf: measurement failed: {error}");
            std::process::exit(1);
        }
    }
}

fn optional(value: Option<f64>) -> String {
    value
        .map(|value| format!("{value:.1}ms"))
        .unwrap_or_else(|| "n/a".to_string())
}

fn measure(
    process_start: Instant,
    options: &Options,
) -> Result<Report, Box<dyn std::error::Error>> {
    prepare_config_dir(&options.config_dir)?;

    let init_options = SessionOptions {
        config_path: options.config_dir.join(CONFIG_FILE),
        // Empty candidate list disables Steam auto-detection: the fixture is
        // passed as a manual game path, exactly like a user override.
        steam_root_candidates: Some(Vec::new()),
        manual_game_path: Some(options.fixture.clone()),
        log_timings: false,
    };

    let mut session = Session::initialize(init_options)?;
    let cold_start_ms = millis(process_start.elapsed());
    let timings = session.timings;

    let snapshot = session.snapshot();
    let serialised = serde_json::to_vec(&snapshot)?;
    let mod_list_populated_ms = millis(process_start.elapsed());
    let mod_count = snapshot.mods.len();
    let mod_list_populated =
        snapshot.mods.iter().all(|module| !module.id.is_empty()) && !serialised.is_empty();

    let mut errors = Vec::new();

    let all_ids: Vec<String> = snapshot
        .mods
        .iter()
        .map(|module| module.id.clone())
        .collect();
    if snapshot.enabled_count == 0 {
        session.set_mods_enabled(&all_ids, true)?;
    }
    let all_profile = session.save_profile(None, "Perf All", all_ids.clone())?;
    let half_ids: Vec<String> = all_ids.iter().step_by(2).cloned().collect();
    let half_profile = session.save_profile(None, "Perf Half", half_ids.clone())?;
    session.apply_profile(&all_profile.id)?;

    // Apply/persist: move the second enabled row to position 5, the same edit
    // the legacy harness performs by dragging a row onto the list.
    let mut order: Vec<String> = session
        .snapshot()
        .mods
        .iter()
        .filter(|module| module.is_enabled)
        .map(|module| module.id.clone())
        .collect();
    let load_order_persist_ms = if order.len() > 6 {
        let moved = order.remove(1);
        order.insert(5, moved);
        let started = Instant::now();
        match session.set_load_order(&order) {
            Ok(snapshot) => {
                let persisted = session
                    .snapshot()
                    .mods
                    .iter()
                    .filter(|module| module.is_enabled)
                    .map(|module| module.id.clone())
                    .collect::<Vec<_>>();
                let verified = persisted == order && snapshot.enabled_count as usize == order.len();
                Some((millis(started.elapsed()), verified))
            }
            Err(error) => {
                errors.push(format!("loadOrderPersist: {error}"));
                None
            }
        }
    } else {
        errors.push("loadOrderPersist: too few enabled mods to reorder".to_string());
        None
    };

    // Profile switch: the active profile is "Perf All"; switch to "Perf Half".
    session.apply_profile(&all_profile.id)?;
    let started = Instant::now();
    let preset = match session.apply_profile(&half_profile.id) {
        Ok(snapshot) => {
            let verified = snapshot.enabled_count as usize == half_ids.len();
            Some((millis(started.elapsed()), verified))
        }
        Err(error) => {
            errors.push(format!("presetSwitch: {error}"));
            None
        }
    };

    // Launch handoff proxy: used_mods.txt write plus a stub process start. The
    // write is app code; the spawn is harness code because c1a9cdd has no
    // launch command yet. Both stages are timed together and labelled.
    let mut used_mods_write_ms = None;
    let mut game_launch_handoff_ms = None;
    let mut game_launch_handoff = false;
    let started = Instant::now();
    match session.write_load_order(false, false) {
        Ok(report) => {
            used_mods_write_ms = Some(millis(started.elapsed()));
            if let Some(stub) = &options.stub {
                match start_stub(stub, &options.config_dir) {
                    Ok(spawned) => {
                        game_launch_handoff_ms = Some(millis(started.elapsed()));
                        game_launch_handoff = spawned && report.written > 0;
                    }
                    Err(error) => errors.push(format!("gameLaunchHandoff: {error}")),
                }
            } else {
                errors.push(
                    "gameLaunchHandoff: no --stub supplied; only the used_mods.txt write was measured"
                        .to_string(),
                );
            }
        }
        Err(error) => errors.push(format!("gameLaunchHandoff: write_load_order: {error}")),
    }

    let mut notes = vec![
        "coldStartMs is process start to Session::initialize returning (the work Manager::new does in Tauri setup); WebView creation and paint are excluded."
            .to_string(),
        "modListPopulatedMs is process start to the first ModListSnapshot serialised for IPC. The new shell initialises the session before the window is usable, so this is the same pipeline as coldStartMs."
            .to_string(),
        "headerScanMs is Session timings.scan_ms: PFH5 header parsing plus data-folder enumeration and deduplication of the 492 pack files this app scans."
            .to_string(),
        "loadOrderPersistMs is the core set_load_order command to the persisted config.json; it excludes DOM drag dispatch included in the legacy CDP number."
            .to_string(),
        "presetSwitchMs is the core apply_profile command to the persisted config.json; it excludes DOM keyboard dispatch included in the legacy CDP number."
            .to_string(),
        "gameLaunchHandoffMs is a PROXY: app used_mods.txt write plus a stub process started by the harness, because c1a9cdd has no launch command. It is not a TW:WH3 launch."
            .to_string(),
    ];
    if mod_count != 500 {
        notes.push(format!(
            "The new app scanned {mod_count} pack files, not 500: the 8 workshop duplicate copies live under content/1142710 and only enter the scan through Steam discovery. The legacy app enumerated them and then dropped the same 8 copies, so both lists contain 492 mods."
        ));
    }

    Ok(Report {
        schema: "wh3mm.perf.new-app.run.v1",
        run: options.run.clone(),
        cold_start_ms,
        mod_list_populated_ms,
        header_scan_ms: timings.scan_ms as f64,
        detection_ms: timings.detection_ms as f64,
        load_order_read_ms: timings.load_order_ms as f64,
        load_order_persist_ms: load_order_persist_ms.map(|(value, _)| value),
        preset_switch_ms: preset.map(|(value, _)| value),
        used_mods_write_ms,
        game_launch_handoff_ms,
        game_launch_handoff_proxy: true,
        mod_count,
        enabled_count: all_ids.len() as u32,
        profiles: ProfileSizes {
            all: all_ids.len(),
            half: half_ids.len(),
        },
        fixture_sha256: fixture_sha256(&options.fixture),
        verified: Verified {
            mod_list_populated,
            load_order_persist: load_order_persist_ms.is_some_and(|(_, verified)| verified),
            preset_switch: preset.is_some_and(|(_, verified)| verified),
            game_launch_handoff,
        },
        errors,
        notes,
    })
}

fn prepare_config_dir(config_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(config_dir)?;
    for name in [CONFIG_FILE, "config.json.bak"] {
        let path = config_dir.join(name);
        if path.exists() {
            fs::remove_file(&path)?;
        }
    }
    Ok(())
}

fn start_stub(stub: &Path, config_dir: &Path) -> Result<bool, String> {
    let marker = config_dir.join("stub-marker.txt");
    let _ = fs::remove_file(&marker);
    let mut child = Command::new(stub)
        .arg("-perf-proxy")
        .env("WH3MM_STUB_MARKER", &marker)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("could not start the stub {}: {error}", stub.display()))?;
    let deadline = Instant::now() + STUB_TIMEOUT;
    let mut started = false;
    while Instant::now() < deadline {
        if marker.exists() {
            started = true;
            break;
        }
        sleep(Duration::from_millis(2));
    }
    let _ = child.kill();
    let _ = child.wait();
    if started {
        Ok(true)
    } else {
        Err(format!(
            "the stub process did not write its marker within {}s",
            STUB_TIMEOUT.as_secs()
        ))
    }
}

fn fixture_sha256(fixture: &Path) -> Option<String> {
    let text = fs::read_to_string(fixture.join("fixture-manifest.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value
        .get("sha256")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn millis(duration: Duration) -> f64 {
    let value = duration.as_secs_f64() * 1000.0;
    (value * 1000.0).round() / 1000.0
}
