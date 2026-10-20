//! Pure domain logic shared by the Tauri shell and headless tests.
//!
//! This crate must never depend on Tauri, WebView, or any platform UI crate so
//! that the full domain surface stays testable on Linux CI.

pub mod error;
pub mod ipc;

/// Semantic version of the core crate, reported through the IPC contract.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
