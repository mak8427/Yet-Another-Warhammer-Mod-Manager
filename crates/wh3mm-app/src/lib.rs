//! Tauri 2 shell.
//!
//! The shell is compiled only on Windows so Linux CI can run the full domain
//! test suite without WebKitGTK. `commands` stays platform-neutral so command
//! logic remains unit-testable everywhere.

pub mod commands;

#[cfg(windows)]
pub fn run() -> tauri::Result<()> {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::app_info])
        .run(tauri::generate_context!())
}

#[cfg(not(windows))]
pub fn run() -> Result<(), String> {
    Err("the Tauri desktop shell is Windows-only in M0".to_string())
}
