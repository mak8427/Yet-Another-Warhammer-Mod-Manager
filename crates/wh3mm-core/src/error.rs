use serde::{Deserialize, Serialize};

/// Stable machine-readable error codes shared with the TypeScript client.
///
/// Adding a variant is a contract change: mirror it in `frontend/src/lib/ipc.ts`
/// and update ADR-002.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// Filesystem or other I/O failure.
    Io,
    /// Persisted state exists but could not be parsed or validated.
    ConfigCorrupt,
    /// No Total War: Warhammer III installation could be located.
    GameNotFound,
    /// Steam could not be located or read.
    SteamNotFound,
    /// Whether the game process is running could not be determined.
    ProcessDetectionFailed,
    /// A `.pack` file is malformed or unreadable.
    PackParseFailed,
    /// A requested entity (mod, profile, tag) does not exist.
    NotFound,
    /// Caller-supplied data failed validation.
    Validation,
    /// Unexpected internal failure; details are for logs, not UI copy.
    Internal,
}

/// Error envelope returned by every fallible Tauri command.
///
/// Serialized field names are camelCase so the TypeScript mirror is mechanical.
/// `details` is always present (possibly `null`) to keep the wire shape stable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("[{code:?}] {message}")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub details: Option<String>,
    pub retryable: bool,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
            retryable: false,
        }
    }

    /// Marks the operation as safe to retry without user intervention.
    pub fn retryable(mut self) -> Self {
        self.retryable = true;
        self
    }

    /// Attaches diagnostic context that must not be shown as the primary UI message.
    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }

    /// Wraps a filesystem failure with the path that failed.
    pub fn io_path(
        context: impl AsRef<str>,
        path: &std::path::Path,
        error: &std::io::Error,
    ) -> Self {
        Self::new(ErrorCode::Io, context.as_ref())
            .with_details(format!("{}: {error}", path.display()))
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Validation, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }

    pub fn corrupt(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::ConfigCorrupt, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }

    /// The standard failure for a command that needs a detected game folder.
    pub fn game_not_found() -> Self {
        Self::new(
            ErrorCode::GameNotFound,
            "Could not find a Total War: Warhammer III installation",
        )
    }

    /// Reports that the running-game probe failed, so launch must not proceed.
    pub fn process_detection_failed(details: impl Into<String>) -> Self {
        Self::new(
            ErrorCode::ProcessDetectionFailed,
            "Could not check whether Total War: Warhammer III is running; confirm the game is closed, then try again",
        )
        .with_details(details)
        .retryable()
    }
}
