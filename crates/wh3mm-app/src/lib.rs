//! Tauri 2 shell.
//!
//! The shell is compiled on Windows and Linux. `commands` stays
//! platform-neutral so command logic remains unit-testable everywhere; the
//! core crate never depends on Tauri or a WebView.

pub mod commands;

#[cfg(any(windows, target_os = "linux"))]
mod window_state;

#[cfg(any(windows, target_os = "linux"))]
pub fn run() -> tauri::Result<()> {
    use tauri::Manager as _;

    tauri::Builder::default()
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let manager = commands::Manager::new(config_dir)?;
            app.manage(manager);
            app.manage(window_state::Tracker::default());
            window_state::restore(app);
            Ok(())
        })
        .on_window_event(window_state::handle_event)
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
            commands::reset_to_defaults,
            commands::read_load_order,
            commands::preview_load_order,
            commands::write_load_order,
            commands::restore_load_order,
            commands::get_conflicts,
            commands::list_workshop_items,
            commands::workshop_action,
            commands::get_launch_options,
            commands::set_launch_options,
            commands::launch_game,
        ])
        .run(tauri::generate_context!())
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn run() -> Result<(), String> {
    Err("the Tauri desktop shell is supported on Windows and Linux".to_string())
}
