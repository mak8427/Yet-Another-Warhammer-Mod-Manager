use wh3mm_core::error::{AppError, ErrorCode};
use wh3mm_core::ipc::AppInfo;

#[test]
fn app_info_serializes_camel_case_fields() {
    let info = AppInfo {
        name: "WH3 Mod Manager".into(),
        version: "0.1.0".into(),
        core_version: "0.1.0".into(),
        platform: "linux".into(),
        arch: "x86_64".into(),
    };

    let json = serde_json::to_value(&info).expect("AppInfo must serialize");

    assert_eq!(json["name"], "WH3 Mod Manager");
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
    let report = wh3mm_core::ipc::ResetDefaultsReport {
        load_order_written: false,
        load_order_outcome: wh3mm_core::ipc::ResetLoadOrderOutcome::NoGamePath,
        load_order_blocked_reason: None,
    };

    let json = serde_json::to_value(&report).expect("ResetDefaultsReport must serialize");

    assert_eq!(json["loadOrderWritten"], false);
    assert_eq!(json["loadOrderOutcome"], "no_game_path");
    assert_eq!(json["loadOrderBlockedReason"], serde_json::Value::Null);
    assert!(
        json.get("load_order_written").is_none(),
        "snake_case keys must not leak onto the wire"
    );
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
        (ErrorCode::PackParseFailed, "pack_parse_failed"),
        (ErrorCode::NotFound, "not_found"),
        (ErrorCode::Validation, "validation"),
        (ErrorCode::Internal, "internal"),
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
        author: None,
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
        unmanaged_directives: vec!["add_working_directory \"x\";".into()],
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
    assert_eq!(
        json["unmanagedDirectives"][0],
        "add_working_directory \"x\";"
    );
}
