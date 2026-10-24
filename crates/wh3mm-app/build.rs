fn main() {
    #[cfg(any(windows, target_os = "linux"))]
    {
        tauri_build::build();
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    {
        println!("cargo:rerun-if-changed=tauri.conf.json");
        println!("cargo:rerun-if-changed=capabilities/default.json");
    }
}
