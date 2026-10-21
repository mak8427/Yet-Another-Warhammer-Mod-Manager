//! Same-directory atomic file replacement shared by config and load-order writes.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_path_for(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp_name = format!(".{file_name}.tmp-{}-{counter}", std::process::id());
    path.with_file_name(temp_name)
}

/// Writes `bytes` to `path` through a flushed temp file and a same-directory
/// rename. The destination is replaced only after the new content is durable.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_temp_then_rename(path, bytes, true)
}

/// Writes `bytes` to `path` and copies the previous destination to `backup`
/// (when it exists) before the rename. The backup itself is written atomically.
pub fn atomic_write_with_backup(
    path: &Path,
    bytes: &[u8],
    backup: Option<&Path>,
) -> io::Result<Option<PathBuf>> {
    let mut backup_written = None;
    if let Some(backup_path) = backup {
        if path.exists() {
            let previous = fs::read(path)?;
            atomic_write_no_backup(backup_path, &previous)?;
            backup_written = Some(backup_path.to_path_buf());
        }
    }
    write_temp_then_rename(path, bytes, true)?;
    Ok(backup_written)
}

/// Atomic replacement without creating a backup. Used for backups themselves
/// and for explicit backup restores.
pub fn atomic_write_no_backup(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_temp_then_rename(path, bytes, false)
}

fn write_temp_then_rename(path: &Path, bytes: &[u8], sync_parent: bool) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("path has no parent directory: {}", path.display()),
        )
    })?;
    if !parent.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("parent directory does not exist: {}", parent.display()),
        ));
    }

    let temp_path = temp_path_for(path);
    let result = (|| -> io::Result<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp_path)?;
        file.write_all(bytes)?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp_path, path)?;
        if sync_parent {
            sync_directory(parent)?;
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}
