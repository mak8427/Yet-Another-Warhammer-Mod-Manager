//! Bounded protection for the mod list during the launch handoff.
//!
//! The manager writes `used_mods.txt` through a separate explicit operation.
//! Launch must not silently hand the game a different order, so the launch path
//! snapshots the file, starts the game, and watches the file for a short window.
//! If another process rewrites it, the launch is aborted.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

use crate::atomic::atomic_write;
use crate::error::{AppError, ErrorCode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LoadOrderGuard {
    pub window: Duration,
    pub poll: Duration,
}

impl Default for LoadOrderGuard {
    fn default() -> Self {
        Self {
            window: Duration::from_secs(3),
            poll: Duration::from_millis(50),
        }
    }
}

impl LoadOrderGuard {
    pub(crate) fn snapshot(&self, path: &Path) -> Result<Option<Vec<u8>>, AppError> {
        match fs::read(path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(AppError::io_path(
                "Could not read used_mods.txt during launch",
                path,
                &error,
            )),
        }
    }

    pub(crate) fn restore_snapshot(
        &self,
        path: &Path,
        baseline: &Option<Vec<u8>>,
    ) -> Result<(), AppError> {
        match baseline {
            Some(bytes) => atomic_write(path, bytes).map_err(|error| {
                AppError::io_path("Could not restore used_mods.txt", path, &error)
            }),
            None => match fs::remove_file(path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
                Err(error) => Err(AppError::io_path(
                    "Could not remove the rewritten used_mods.txt",
                    path,
                    &error,
                )),
            },
        }
    }

    pub(crate) fn wait_unchanged(
        &self,
        path: &Path,
        baseline: &Option<Vec<u8>>,
    ) -> Result<(), AppError> {
        let started = Instant::now();
        loop {
            let current = match self.snapshot(path) {
                Ok(current) => current,
                Err(error) if error.code == ErrorCode::Io && started.elapsed() < self.window => {
                    let remaining = self.window.saturating_sub(started.elapsed());
                    thread::sleep(self.poll.min(remaining));
                    continue;
                }
                Err(error) => return Err(error),
            };
            if current != *baseline {
                let before = baseline.as_ref().map_or(0, Vec::len);
                let after = current.as_ref().map_or(0, Vec::len);
                return Err(AppError::new(
                    ErrorCode::LoadOrderOverridden,
                    "used_mods.txt changed during launch; the launch was stopped",
                )
                .with_details(format!(
                    "{}: {before} bytes before, {after} bytes after the launch guard started",
                    path.display()
                )));
            }
            if started.elapsed() >= self.window {
                return Ok(());
            }
            let remaining = self.window.saturating_sub(started.elapsed());
            thread::sleep(self.poll.min(remaining));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use crate::test_support::TempDir;
    use std::fs;
    use std::thread;
    use std::time::Instant;

    fn guard(window_ms: u64) -> LoadOrderGuard {
        LoadOrderGuard {
            window: Duration::from_millis(window_ms),
            poll: Duration::from_millis(5),
        }
    }

    #[test]
    fn default_window_is_three_seconds() {
        let guard = LoadOrderGuard::default();

        assert_eq!(guard.window, Duration::from_secs(3));
        assert_eq!(guard.poll, Duration::from_millis(50));
    }

    #[test]
    fn allows_an_unchanged_used_mods_file() {
        let dir = TempDir::new("guard-unchanged");
        let path = dir.path().join("used_mods.txt");
        fs::write(&path, "a.pack\n").unwrap();
        let guard = guard(60);
        let baseline = guard.snapshot(&path).unwrap();

        guard.wait_unchanged(&path, &baseline).unwrap();
    }

    #[test]
    fn detects_a_rewrite_during_the_window() {
        let dir = TempDir::new("guard-rewrite");
        let path = dir.path().join("used_mods.txt");
        fs::write(&path, "a.pack\n").unwrap();
        let guard = guard(250);
        let baseline = guard.snapshot(&path).unwrap();
        let writer_path = path.clone();
        let writer = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            fs::write(writer_path, "b.pack\n").unwrap();
        });

        let error = guard.wait_unchanged(&path, &baseline).unwrap_err();
        writer.join().unwrap();

        assert_eq!(error.code, ErrorCode::LoadOrderOverridden);
        assert!(error.message.contains("changed during launch"));
    }

    #[test]
    fn detects_file_creation_when_it_was_absent() {
        let dir = TempDir::new("guard-created");
        let path = dir.path().join("used_mods.txt");
        let guard = guard(250);
        let baseline = guard.snapshot(&path).unwrap();
        assert!(baseline.is_none());
        let writer_path = path.clone();
        let writer = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            fs::write(writer_path, "new.pack\n").unwrap();
        });

        let error = guard.wait_unchanged(&path, &baseline).unwrap_err();
        writer.join().unwrap();

        assert_eq!(error.code, ErrorCode::LoadOrderOverridden);
    }

    #[test]
    fn returns_io_when_the_file_becomes_unreadable() {
        let dir = TempDir::new("guard-unreadable");
        let guard = guard(20);

        let error = guard
            .wait_unchanged(dir.path(), &None)
            .expect_err("a directory is not a readable file");

        assert_eq!(error.code, ErrorCode::Io);
    }

    #[test]
    fn restores_the_snapshot_bytes() {
        let dir = TempDir::new("guard-restore");
        let path = dir.path().join("used_mods.txt");
        fs::write(&path, "original.pack\n").unwrap();
        let guard = guard(10);
        let baseline = guard.snapshot(&path).unwrap();
        fs::write(&path, "changed.pack\n").unwrap();

        guard.restore_snapshot(&path, &baseline).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "original.pack\n");
    }

    #[test]
    fn removes_a_file_created_when_baseline_was_absent() {
        let dir = TempDir::new("guard-restore-absent");
        let path = dir.path().join("used_mods.txt");
        let guard = guard(10);
        let baseline = guard.snapshot(&path).unwrap();
        fs::write(&path, "created.pack\n").unwrap();

        guard.restore_snapshot(&path, &baseline).unwrap();

        assert!(!path.exists());
    }

    #[test]
    fn uses_a_bounded_window() {
        let dir = TempDir::new("guard-bounded");
        let path = dir.path().join("used_mods.txt");
        fs::write(&path, "a.pack\n").unwrap();
        let guard = guard(80);
        let baseline = guard.snapshot(&path).unwrap();
        let started = Instant::now();

        guard.wait_unchanged(&path, &baseline).unwrap();

        assert!(started.elapsed() < Duration::from_millis(500));
    }
}
