use wh3mm_core::ipc::AppInfo;

/// Returns identity and build information for the running application.
///
/// This is the M0 round-trip proof: the React shell invokes `app_info` and
/// renders the result. On Windows the `tauri::command` attribute turns this
/// into an IPC handler; elsewhere it stays a plain function for tests.
#[cfg_attr(windows, tauri::command)]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "WH3 Mod Manager".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        core_version: wh3mm_core::VERSION.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_reports_both_crate_versions() {
        let info = app_info();

        assert_eq!(info.name, "WH3 Mod Manager");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(info.core_version, wh3mm_core::VERSION);
        assert!(!info.platform.is_empty());
        assert!(!info.arch.is_empty());
    }
}
