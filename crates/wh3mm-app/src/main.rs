fn main() {
    #[cfg(any(windows, target_os = "linux"))]
    {
        if let Err(error) = wh3mm_app_lib::run() {
            eprintln!("wh3mm: failed to start the Tauri application: {error}");
            std::process::exit(1);
        }
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    {
        eprintln!(
            "wh3mm: the Tauri desktop shell is supported on Windows and Linux; use `cargo test` for headless work."
        );
    }
}
