use wh3mm_core::error::{AppError, ErrorCode};
use wh3mm_core::ipc::{AppInfo, LoadOrderWriteFacts, LoadOrderWriteReport, LoadOrderWriteRequest};

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

fn write_facts(
    existing_managed_lines: usize,
    planned_managed_lines: usize,
    unmanaged_directives: &[&str],
) -> LoadOrderWriteFacts {
    LoadOrderWriteFacts {
        existing_managed_lines,
        planned_managed_lines,
        unmanaged_directives: unmanaged_directives
            .iter()
            .map(|directive| (*directive).to_string())
            .collect(),
    }
}

#[test]
fn load_order_write_request_uses_camel_case_flags() {
    let request = LoadOrderWriteRequest {
        allow_empty: false,
        confirm_unmanaged_loss: true,
    };

    let json = serde_json::to_value(request).expect("LoadOrderWriteRequest must serialize");

    assert_eq!(
        json,
        serde_json::json!({ "allowEmpty": false, "confirmUnmanagedLoss": true })
    );
    assert!(json.get("allow_empty").is_none());
    assert!(json.get("confirm_unmanaged_loss").is_none());
}

#[test]
fn load_order_write_report_uses_contract_field_names() {
    let report = LoadOrderWriteReport {
        path: "C:/game/used_mods.txt".into(),
        backup_path: Some("C:/game/used_mods.txt.bak".into()),
        written: 2,
        skipped: vec!["missing.pack".into()],
        unmanaged_directives: vec!["add_working_directory \"C:/mods\";".into()],
    };

    let json = serde_json::to_value(&report).expect("LoadOrderWriteReport must serialize");

    assert_eq!(json["path"], "C:/game/used_mods.txt");
    assert_eq!(json["backupPath"], "C:/game/used_mods.txt.bak");
    assert_eq!(json["written"], 2);
    assert_eq!(json["skipped"][0], "missing.pack");
    assert_eq!(
        json["unmanagedDirectives"][0],
        "add_working_directory \"C:/mods\";"
    );
    assert!(json.get("unmanaged_directives").is_none());
}

#[test]
fn preview_report_serializes_a_missing_backup_as_null() {
    let report = LoadOrderWriteReport {
        path: "C:/game/used_mods.txt".into(),
        backup_path: None,
        written: 0,
        skipped: Vec::new(),
        unmanaged_directives: Vec::new(),
    };

    let json = serde_json::to_value(&report).expect("LoadOrderWriteReport must serialize");

    assert!(
        json.get("backupPath").is_some(),
        "backupPath must be present"
    );
    assert!(json["backupPath"].is_null());
}

#[test]
fn write_refuses_to_drop_unmanaged_directives_without_confirmation() {
    let request = LoadOrderWriteRequest {
        allow_empty: true,
        confirm_unmanaged_loss: false,
    };

    let error = request
        .validate(&write_facts(2, 2, &["add_working_directory \"C:/mods\";"]))
        .expect_err("unconfirmed unmanaged loss must be refused");

    assert_eq!(error.code, ErrorCode::Validation);
    assert_eq!(
        error.message,
        "Writing the load order would drop unmanaged directives."
    );
    assert!(
        error
            .details
            .as_deref()
            .unwrap_or_default()
            .contains("add_working_directory"),
        "details must name the directive that would be dropped"
    );
    assert!(!error.retryable);
}

#[test]
fn write_allows_unmanaged_loss_when_confirmed() {
    let request = LoadOrderWriteRequest {
        allow_empty: false,
        confirm_unmanaged_loss: true,
    };

    request
        .validate(&write_facts(2, 2, &["add_working_directory \"C:/mods\";"]))
        .expect("confirmed unmanaged loss must be allowed");
}

#[test]
fn write_refuses_to_empty_a_non_empty_load_order_without_permission() {
    let request = LoadOrderWriteRequest {
        allow_empty: false,
        confirm_unmanaged_loss: true,
    };

    let error = request
        .validate(&write_facts(3, 0, &[]))
        .expect_err("emptying a non-empty list must be refused");

    assert_eq!(error.code, ErrorCode::Validation);
    assert_eq!(error.message, "Writing would empty a non-empty load order.");
    assert!(
        error
            .details
            .as_deref()
            .unwrap_or_default()
            .contains("3 managed mod line(s)"),
        "details must state the existing line count"
    );
    assert!(!error.retryable);
}

#[test]
fn write_allows_an_empty_result_when_allow_empty_is_set() {
    let request = LoadOrderWriteRequest {
        allow_empty: true,
        confirm_unmanaged_loss: false,
    };

    request
        .validate(&write_facts(3, 0, &[]))
        .expect("explicit write-empty permission must be allowed");
}

#[test]
fn write_allows_an_empty_result_when_the_existing_file_has_no_managed_lines() {
    let request = LoadOrderWriteRequest {
        allow_empty: false,
        confirm_unmanaged_loss: false,
    };

    request
        .validate(&write_facts(0, 0, &[]))
        .expect("an already-empty list does not need write-empty permission");
}

#[test]
fn write_allows_a_non_destructive_write_without_flags() {
    let request = LoadOrderWriteRequest {
        allow_empty: false,
        confirm_unmanaged_loss: false,
    };

    request
        .validate(&write_facts(1, 2, &[]))
        .expect("a normal write must not require destructive permissions");
}
