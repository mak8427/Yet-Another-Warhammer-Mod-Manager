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
