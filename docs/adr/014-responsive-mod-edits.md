# ADR-014 — Responsive mod edits and conflict scan isolation

- Status: proposed
- Date: 2026-10-24
- Amends: ADR-001 (session locking), ADR-002 (command execution)

## Context

Checkboxes and load-order changes previously waited for configuration persistence
before updating the renderer. Rapid actions could also return snapshots out of order.
Conflict analysis read pack indexes while holding the same session mutex needed by
mod edits, so a background scan could delay an unrelated checkbox save.

## Decision

The frontend applies mod enablement and order changes immediately and serializes
their existing IPC commands. After each response, remaining optimistic edits are
reapplied to the last confirmed snapshot. A failed save reports the existing typed
error and rolls back that edit; later queued commands still run. Global busy state
continues to protect profile switches, load-order writes and launching until saves
finish. Profile and conflict refreshes run when the edit queue drains.

Conflict analysis captures an owned snapshot of discovery metadata, enabled order
and location under the session lock. Pack-index reads and report computation use
that snapshot after the lock is released. An edit during a scan schedules another
refresh so the conflict report eventually reflects the latest order.

## Consequences

The IPC payloads, command names, configuration format and atomic backup contract
remain unchanged. The working list can temporarily differ from persisted state
while a save is pending. Conflict results can temporarily describe an earlier
order, and concurrent scans require an owned copy of discovery metadata.

Regression tests cover rapid toggles, repeated moves, failed saves, reset during a
save and conflict refresh requests during an older scan. A captured conflict scan
is also verified against a subsequent order change. The 500-mod component benchmark
and its scope are documented in docs/PERF.md.
