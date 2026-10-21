//! UTC timestamps in the ISO-8601 shape used by the IPC contract.

use std::time::SystemTime;
use time::OffsetDateTime;

/// Formats the current instant as `YYYY-MM-DDTHH:MM:SSZ`.
pub fn now_iso8601() -> String {
    format_system_time(SystemTime::now())
}

/// Formats a filesystem timestamp, returning `None` when the platform cannot
/// represent it (for example a pre-epoch mtime on an unsupported filesystem).
pub fn system_time_to_iso8601(value: SystemTime) -> Option<String> {
    let datetime = OffsetDateTime::from(value);
    Some(format_datetime(datetime))
}

fn format_system_time(value: SystemTime) -> String {
    format_datetime(OffsetDateTime::from(value))
}

fn format_datetime(value: OffsetDateTime) -> String {
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        value.year(),
        u8::from(value.month()),
        value.day(),
        value.hour(),
        value.minute(),
        value.second()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn formats_epoch_and_known_instant() {
        let epoch = SystemTime::UNIX_EPOCH;
        assert_eq!(
            system_time_to_iso8601(epoch).as_deref(),
            Some("1970-01-01T00:00:00Z")
        );

        let later = epoch + Duration::from_secs(1_700_000_000);
        assert_eq!(
            system_time_to_iso8601(later).as_deref(),
            Some("2023-11-14T22:13:20Z")
        );
    }
}
