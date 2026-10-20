fn main() {
    #[cfg(windows)]
    {
        tauri_build::build();
    }

    #[cfg(not(windows))]
    {
        println!("cargo:rerun-if-changed=tauri.conf.json");
        println!("cargo:rerun-if-changed=capabilities/default.json");
    }
}
