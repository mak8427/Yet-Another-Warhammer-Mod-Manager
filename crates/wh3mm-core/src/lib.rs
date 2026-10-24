//! Pure domain logic shared by the Tauri shell and headless tests.
//!
//! This crate must never depend on Tauri, WebView, or any platform UI crate so
//! that the full domain surface stays testable on Linux CI.

pub mod atomic;
pub mod clock;
pub mod config;
pub mod conflicts;
pub mod error;
pub(crate) mod host_process;
pub mod ipc;
pub mod launch;
pub(crate) mod launch_guard;
pub mod load_order;
pub mod mod_index;
pub mod pack;
pub mod paths;
pub(crate) mod proton_launch;
pub mod session;
pub mod test_support;
pub mod timing;
pub mod window;
pub mod workshop;

/// Semantic version of the core crate, reported through the IPC contract.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
