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

## Task

<!-- Link the Paperclip task, e.g. WAR-4. State any ADR added or changed. -->
