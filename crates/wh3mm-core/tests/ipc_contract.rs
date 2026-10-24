use wh3mm_core::error::{AppError, ErrorCode};
use wh3mm_core::ipc::AppInfo;

#[test]
fn app_info_serializes_camel_case_fields() {
    let info = AppInfo {
        name: "Yet Another Warhammer Mod Manager".into(),
        version: "0.1.0".into(),
        core_version: "0.1.0".into(),
        platform: "linux".into(),
        arch: "x86_64".into(),
    };

    let json = serde_json::to_value(&info).expect("AppInfo must serialize");

    assert_eq!(json["name"], "Yet Another Warhammer Mod Manager");
    assert_eq!(json["version"], "0.1.0");
    assert_eq!(json["coreVersion"], "0.1.0");
    assert_eq!(json["platform"], "linux");
    assert_eq!(json["arch"], "x86_64");
    assert!(
        json.get("core_version").is_none(),
        "snake_case keys must not leak onto the wire"
    );
}

#[test]
fn reset_defaults_report_uses_camel_case_on_the_wire() {
    use wh3mm_core::ipc::{ResetDefaultsReport, ResetLoadOrderReport, ResetLoadOrderStatus};

    let report = ResetDefaultsReport {
        load_order: ResetLoadOrderReport {
            status: ResetLoadOrderStatus::UnmanagedDirectives,
            message: Some("confirm first".into()),
            unmanaged_directives: vec!["custom_directive \"C:/tools\";".into()],
            requires_unmanaged_confirmation: true,
        },
    };

    let json = serde_json::to_value(&report).expect("ResetDefaultsReport must serialize");

    assert_eq!(json["loadOrder"]["status"], "unmanagedDirectives");
    assert_eq!(json["loadOrder"]["message"], "confirm first");
    assert_eq!(
        json["loadOrder"]["unmanagedDirectives"][0],
        "custom_directive \"C:/tools\";"
    );
    assert_eq!(json["loadOrder"]["requiresUnmanagedConfirmation"], true);
    assert!(
        json.get("load_order").is_none(),
        "snake_case keys must not leak onto the wire"
    );
}

#[test]
fn reset_load_order_status_is_camel_case_and_distinguishes_outcomes() {
    use wh3mm_core::ipc::ResetLoadOrderStatus;

    let cases = [
        (ResetLoadOrderStatus::Written, "written"),
        (ResetLoadOrderStatus::NoGamePath, "noGamePath"),
        (ResetLoadOrderStatus::Failed, "failed"),
        (
            ResetLoadOrderStatus::UnmanagedDirectives,
            "unmanagedDirectives",
        ),
    ];

    for (status, expected) in cases {
        let json = serde_json::to_value(status).expect("status must serialize");
        assert_eq!(json, expected);
    }
}

#[test]
fn app_error_wire_shape_is_stable() {
    let error = AppError::new(ErrorCode::GameNotFound, "Could not find WH3")
        .with_details("checked 3 Steam libraries")
        .retryable();

    let json = serde_json::to_value(&error).expect("AppError must serialize");

    assert_eq!(json["code"], "game_not_found");
    assert_eq!(json["message"], "Could not find WH3");
    assert_eq!(json["details"], "checked 3 Steam libraries");
    assert_eq!(json["retryable"], true);
}

#[test]
fn app_error_always_serializes_details_key() {
    let error = AppError::new(ErrorCode::Internal, "boom");
    let json = serde_json::to_value(&error).expect("AppError must serialize");

    assert!(json.get("details").is_some(), "details must be present");
    assert!(json["details"].is_null());
    assert_eq!(json["retryable"], false);
}

#[test]
fn error_codes_use_snake_case_on_the_wire() {
    let cases = [
        (ErrorCode::Io, "io"),
        (ErrorCode::ConfigCorrupt, "config_corrupt"),
        (ErrorCode::SteamNotFound, "steam_not_found"),
        (ErrorCode::SteamNotRunning, "steam_not_running"),
        (
            ErrorCode::ProcessDetectionFailed,
            "process_detection_failed",
        ),
        (ErrorCode::PackParseFailed, "pack_parse_failed"),
        (ErrorCode::NotFound, "not_found"),
        (ErrorCode::Validation, "validation"),
        (ErrorCode::Internal, "internal"),
        (ErrorCode::ProtonNotConfigured, "proton_not_configured"),
        (ErrorCode::CompatDataMissing, "compat_data_missing"),
        (ErrorCode::ProtonNotInstalled, "proton_not_installed"),
        (ErrorCode::ProtonRuntimeMissing, "proton_runtime_missing"),
        (ErrorCode::LaunchFailed, "launch_failed"),
        (ErrorCode::LoadOrderOverridden, "load_order_overridden"),
    ];

    for (code, expected) in cases {
        let json = serde_json::to_value(code).expect("ErrorCode must serialize");
        assert_eq!(json, expected);
    }
}

#[test]
fn mod_list_snapshot_uses_the_m1_m2_wire_shape() {
    use wh3mm_core::ipc::{
        GameLocation, LoadOrderReadReport, LocationSource, ModListSnapshot, ModSummary,
        UiPreferences,
    };
    use wh3mm_core::timing::Timings;

    let module = ModSummary {
        id: "C:/game/data/mod.pack".into(),
        name: "mod.pack".into(),
        human_name: "mod".into(),
        is_workshop: false,
        workshop_id: None,
        is_enabled: true,
        load_order: 0,
        tags: vec!["tag".into()],
        updated_at: Some("2026-10-20T12:00:00Z".into()),
        thumbnail_path: None,
        dependencies: vec!["data.pack".into()],
        pack_error: None,
        is_movie: false,
        size_bytes: 42,
    };
    let snapshot = ModListSnapshot {
        mods: vec![module],
        enabled_count: 1,
        active_profile_id: "profile".into(),
        load_order: LoadOrderReadReport {
            path: "C:/game/used_mods.txt".into(),
            present: true,
            corrupt: false,
            message: None,
            unreadable: None,
            mod_names: vec!["mod.pack".into()],
            resolved_mod_ids: vec!["C:/game/data/mod.pack".into()],
            missing_names: vec![],
            duplicates: vec![],
            unmanaged_directives: vec![],
            backup_available: false,
        },
        timings: Timings::default(),
        warnings: vec![],
    };

    let json = serde_json::to_value(snapshot).unwrap();
    assert_eq!(json["enabledCount"], 1);
    assert_eq!(json["activeProfileId"], "profile");
    assert_eq!(json["mods"][0]["humanName"], "mod");
    assert_eq!(json["mods"][0]["thumbnailPath"], serde_json::Value::Null);
    assert_eq!(json["mods"][0]["sizeBytes"], 42);
    assert!(json.get("mods").is_some());
    assert_eq!(
        json["loadOrder"]["resolvedModIds"][0],
        "C:/game/data/mod.pack"
    );
    assert_eq!(json["timings"]["startupMs"], 0);

    let location = GameLocation {
        game_path: "C:/game".into(),
        data_path: "C:/game/data".into(),
        workshop_path: "C:/workshop".into(),
        steam_root: "C:/steam".into(),
        proton_prefix: None,
        source: LocationSource::Manual,
    };
    let json = serde_json::to_value(location).unwrap();
    assert_eq!(json["source"], "manual");
    assert!(json["protonPrefix"].is_null());

    let preferences = UiPreferences::default();
    let json = serde_json::to_value(preferences).unwrap();
    assert_eq!(json["density"], "comfortable");
    assert_eq!(json["lastScrollTop"], 0);
}

#[test]
fn write_report_exposes_confirmation_requirements() {
    use wh3mm_core::ipc::LoadOrderWriteReport;

    let report = LoadOrderWriteReport {
        path: "used_mods.txt".into(),
        backup_path: None,
        written: 0,
        skipped: vec!["missing.pack".into()],
        unmanaged_directives: vec!["custom_directive \"x\";".into()],
        would_drop_unmanaged: true,
        existing_mod_count: 3,
        resulting_mod_count: 0,
        can_write: false,
        blocked_reason: Some("confirm first".into()),
        requires_empty_confirmation: true,
        requires_unmanaged_confirmation: true,
        hard_blocked: false,
    };
    let json = serde_json::to_value(report).unwrap();
    assert_eq!(json["requiresEmptyConfirmation"], true);
    assert_eq!(json["requiresUnmanagedConfirmation"], true);
    assert_eq!(json["hardBlocked"], false);
    assert_eq!(json["unmanagedDirectives"][0], "custom_directive \"x\";");
}

#[test]
fn launch_method_wire_values_include_proton() {
    use wh3mm_core::launch::LaunchMethod;

    let cases = [
        (LaunchMethod::Steam, "steam"),
        (LaunchMethod::Proton, "proton"),
        (LaunchMethod::Direct, "direct"),
    ];

    for (method, expected) in cases {
        let json = serde_json::to_value(method).expect("LaunchMethod must serialize");
        assert_eq!(json, expected);
    }
}

#[test]
fn every_error_code_is_documented() {
    const TROUBLESHOOTING: &str = include_str!("../../../docs/INSTALLATION.md");
    let codes = [
        "io",
        "config_corrupt",
        "game_not_found",
        "steam_not_found",
        "steam_not_running",
        "process_detection_failed",
        "pack_parse_failed",
        "not_found",
        "validation",
        "internal",
        "proton_not_configured",
        "compat_data_missing",
        "proton_not_installed",
        "proton_runtime_missing",
        "launch_failed",
        "load_order_overridden",
    ];

    for code in codes {
        assert!(
            TROUBLESHOOTING.contains(&format!("`{code}`")),
            "{code} is missing from docs/INSTALLATION.md"
        );
    }
}

#[test]
fn export_profile_report_uses_camel_case_fields() {
    use wh3mm_core::ipc::ExportProfileReport;

    let report = ExportProfileReport {
        path: "C:/Users/me/Downloads/Campaign.wh3mm-profile.json".into(),
        profile_name: "Campaign".into(),
        exported_mods: 12,
        skipped_mods: 2,
        replaced_existing: true,
    };

    let json = serde_json::to_value(report).unwrap();

    assert_eq!(json["profileName"], "Campaign");
    assert_eq!(json["exportedMods"], 12);
    assert_eq!(json["skippedMods"], 2);
    assert_eq!(json["replacedExisting"], true);
    assert!(json.get("profile_name").is_none());
    assert!(json.get("skipped_mods").is_none());
}

#[test]
fn import_profile_outcome_is_tagged_and_camel_case() {
    use wh3mm_core::ipc::{ImportProfileOutcome, MissingShareMod, Profile};

    let imported = ImportProfileOutcome::Imported {
        profile: Profile {
            id: "profile-1".into(),
            name: "Campaign".into(),
            enabled_mod_ids: vec!["mod-a".into()],
            created_at: "2026-10-20T12:00:00Z".into(),
            updated_at: "2026-10-20T12:00:00Z".into(),
        },
        renamed_from: Some("Campaign".into()),
        total_mods: 1,
    };
    let json = serde_json::to_value(&imported).unwrap();
    assert_eq!(json["status"], "imported");
    assert_eq!(json["renamedFrom"], "Campaign");
    assert_eq!(json["totalMods"], 1);
    assert_eq!(json["profile"]["enabledModIds"][0], "mod-a");
    assert!(json.get("renamed_from").is_none());

    let missing = ImportProfileOutcome::MissingMods {
        profile_name: "Campaign".into(),
        total_mods: 2,
        missing: vec![MissingShareMod {
            pack: "absent.pack".into(),
            name: Some("Absent".into()),
            workshop_id: Some("2921395471".into()),
            url: Some("https://steamcommunity.com/sharedfiles/filedetails/?id=2921395471".into()),
        }],
    };
    let json = serde_json::to_value(&missing).unwrap();
    assert_eq!(json["status"], "missingMods");
    assert_eq!(json["profileName"], "Campaign");
    assert_eq!(json["missing"][0]["pack"], "absent.pack");
    assert_eq!(json["missing"][0]["workshopId"], "2921395471");
    assert_eq!(
        json["missing"][0]["url"],
        "https://steamcommunity.com/sharedfiles/filedetails/?id=2921395471"
    );
    assert!(json["missing"][0].get("workshop_id").is_none());
}

#[test]
fn profile_share_file_never_contains_local_mod_ids_or_paths() {
    use std::path::PathBuf;
    use wh3mm_core::ipc::Profile;
    use wh3mm_core::mod_index::DiscoveredMod;
    use wh3mm_core::profile_share;

    let module = |name: &str, workshop_id: Option<&str>| DiscoveredMod {
        id: format!("C:/game/data/{name}"),
        path: PathBuf::from(format!("C:/game/data/{name}")),
        name: name.to_string(),
        human_name: name.trim_end_matches(".pack").to_string(),
        is_workshop: workshop_id.is_some(),
        workshop_id: workshop_id.map(str::to_string),
        thumbnail_path: None,
        updated_at: None,
        dependencies: Vec::new(),
        pack_error: None,
        is_movie: false,
        size_bytes: 1,
    };
    let mods = vec![
        module("local.pack", None),
        module("shared.pack", Some("42")),
    ];
    let profile = Profile {
        id: "profile-1".into(),
        name: "Campaign".into(),
        enabled_mod_ids: vec![mods[0].id.clone(), mods[1].id.clone()],
        created_at: "2026-10-20T12:00:00Z".into(),
        updated_at: "2026-10-20T12:00:00Z".into(),
    };

    let built = profile_share::build(&profile, &mods, "1.0.0");
    let text = String::from_utf8(profile_share::encode(&built.document).unwrap()).unwrap();

    assert!(!text.contains("enabledModIds"));
    assert!(!text.contains("C:/game"));
    assert!(!text.contains("authorization"));
    assert!(text.contains("\"pack\": \"local.pack\""));
    assert!(text.contains("https://steamcommunity.com/sharedfiles/filedetails/?id=42"));

    let decoded = profile_share::decode(text.as_bytes()).unwrap();
    assert_eq!(decoded.profile.mods[0].pack, "local.pack");
    assert_eq!(decoded.profile.mods[1].workshop_id.as_deref(), Some("42"));

    let resolved = profile_share::resolve(&decoded, &mods);
    assert_eq!(resolved.ids, profile.enabled_mod_ids);
    assert!(resolved.missing.is_empty());
}
