## What changed

<!-- Concrete files/behaviour. One paragraph. -->

## Why

<!-- The problem and the task/milestone this serves. -->

## Verification

- [ ] `cargo fmt --all --check`
- [ ] `cargo clippy --workspace --all-targets --locked -- -D warnings`
- [ ] `cargo test --workspace --locked`
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Windows shell check (required if the Tauri layer changed)

## Review evidence

<!-- GitHub reviews are not used: all agents share the broker identity.
     Copy the Paperclip task ids from the execution policy. A bare name is not
     evidence. See docs/RELEASE.md, "Merge provenance". -->

- QA review: `WAR-___` — approved (decision/comment id: `___`)
- Tech-lead approval: `WAR-___` — approved (decision/comment id: `___`)
- Author is not the approver; performance sign-off (if applicable): `WAR-___`

## CI provenance

<!-- Required checks must be completed/success on this exact head SHA. A
     cancelled, failed, or skipped required check is not a pass. -->

- Head SHA: `________`
- `Linux quality gates`: success — <run URL>
- `Capability parity`: success — <run URL>

## Task

<!-- Link the Paperclip task, e.g. WAR-4. State any ADR added or changed. -->
