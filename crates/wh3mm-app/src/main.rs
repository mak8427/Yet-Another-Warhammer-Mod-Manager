fn main() {
    #[cfg(windows)]
    {
        if let Err(error) = wh3mm_app_lib::run() {
            eprintln!("wh3mm: failed to start the Tauri application: {error}");
            std::process::exit(1);
        }
    }

    #[cfg(not(windows))]
    {
        eprintln!(
            "wh3mm: the Tauri desktop shell is Windows-only in M0; use `cargo test` for headless work."
        );
    }
}
