//! Tauri 2 shell.
//!
//! The shell is compiled only on Windows so Linux CI can run the full domain
//! test suite without WebKitGTK. `commands` stays platform-neutral so command
//! logic remains unit-testable everywhere.

pub mod commands;

#[cfg(windows)]
pub fn run() -> tauri::Result<()> {
    use tauri::Manager as _;

    tauri::Builder::default()
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let manager = commands::Manager::new(config_dir)?;
            app.manage(manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::detect_game,
            commands::set_game_path,
            commands::list_mods,
            commands::set_mod_enabled,
            commands::set_mods_enabled,
            commands::set_load_order,
            commands::list_profiles,
            commands::save_profile,
            commands::duplicate_profile,
            commands::delete_profile,
            commands::apply_profile,
            commands::list_tags,
            commands::create_tag,
            commands::delete_tag,
            commands::set_mod_tags,
            commands::get_ui_preferences,
            commands::update_ui_preferences,
            commands::read_load_order,
            commands::preview_load_order,
            commands::write_load_order,
            commands::restore_load_order,
        ])
        .run(tauri::generate_context!())
}

#[cfg(not(windows))]
pub fn run() -> Result<(), String> {
    Err("the Tauri desktop shell is Windows-only until M5 packaging".to_string())
}
