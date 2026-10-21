# M4 evidence — WAR-10 and the WAR-79 v1.0 blockers

Head: `feat/ui-direction-screens` after the M4 visual pass. Screenshot set:
`docs/screenshots/WAR-10/` (29 PNGs, both required viewports; capture method in
that directory's README).

## Verification commands

| Gate | Command | Result |
|---|---|---|
| Types | `pnpm typecheck` | pass |
| Lint | `pnpm lint` | pass |
| Frontend tests | `pnpm test` | 9 files / 64 tests pass |
| Build | `pnpm build` | pass |
| Rust format | `cargo fmt --all --check` | pass |
| Rust lint | `cargo clippy --workspace --all-targets --locked -- -D warnings` | pass |
| Rust tests | `cargo test --workspace --locked` | pass |
| Screenshot capture | `pnpm build && node scripts/qa/screenshots-m4.mjs` | 29 PNGs + measurements |

## Density and virtualization

- D-01: `frontend/src/styles/tokens.test.ts` asserts 32/40/48 and comfortable.
- D-02: capture run measured 29 / 23 / 19 fully visible rows at 1920×1080.
- D-03: capture run measured 19 / 15 / 13 fully visible rows at 1366×768.
- D-04: `ModList.test.tsx` — `keeps the first visible row and selection when
  density changes` (compact scrollTop 320 → roomy scrollTop 480, same row).
- D-05: `config.rs` — `roomy_density_round_trips` and
  `unknown_density_falls_back_to_comfortable`.
- G-11: `ModList.test.tsx` — `bounds the mounted rows for 20,000 mods`
  (≤30 mounted rows at a 320px list viewport, overscan included). Capture run
  mounted 44–50 rows for 23–29 visible rows at 1920×1080.

## Global and screen evidence

- G-01/G-02/G-14: `tokens.test.ts` (single token source, contrast pairs,
  no gradients/glow/external assets).
- G-03/G-05/G-12/G-13: focus, state-shape, reduced-motion and forced-colors
  rules in `theme.css`; screenshots show text/icon state channels.
- G-07/G-08: capture run asserts no horizontal page scroll at 1920×1080,
  1366×768 and 1024×720 for Mods, Profiles, Conflicts, Workshop and Settings.
- G-09/T-01: long name, long author, long pack path and unicode row in the mod
  list; inspector shows the full pack path and author.
- G-10: `.mod-list-scroll` owns scrolling; the inspector scrolls separately.
- G-16/S11-02: empty states are text + one action and ≤200px tall.
- S01/S02/S03/S04/S05/S06/S07/S08/S09/S10/S11: screenshot pairs in
  `docs/screenshots/WAR-10/`; S02 additionally has compact/roomy and selection +
  inspector captures.
- Screenshot evidence also covers loading with the rail present (no horizontal
  jump), Steam-unavailable Workshop (single inline recovery, no contradictory
  empty state), duplicate/missing conflict rows (no `Wins Missing` label), and
  the load-order dialog (Cancel autofocus; dangerous write action when
  unmanaged directives would be dropped).

## WAR-79 blockers

| Item | Code | Test |
|---|---|---|
| SET-4 reset settings and load order | `Session::reset_to_defaults`, `reset_to_defaults` IPC, Settings confirmation | `reset_to_defaults_keeps_profiles_and_tags_and_writes_an_empty_order`, `reset_to_defaults_without_a_game_still_persists_the_config`, `reset_to_defaults_reports_a_corrupt_used_mods_file_without_claiming_success`, `reset_to_defaults_reports_a_corrupt_manual_order_even_when_auto_detection_finds_nothing`, `reset_to_defaults_refuses_a_mixed_corrupt_and_unmanaged_file_without_asking`, `reset_to_defaults_reports_an_unreadable_used_mods_file_without_claiming_success`, `reset_to_defaults_asks_before_dropping_unmanaged_directives`, `reset_to_defaults_clears_the_manual_override_and_redetects_immediately`, `reset_defaults_report_uses_camel_case_on_the_wire`, `resets settings and the load order after confirmation`, `asks before dropping unmanaged directives during reset`, `shows a failure instead of a success toast when the reset cannot write the order` |
| ML-3 deterministic sort | `store.ts` id tie-break in every non-drag mode | `sorts deterministically with an id tie-break in every non-drag mode` |
| CF-4 duplicate pack names | Conflicts screen duplicate rows | `renders duplicate pack names and shows none for a clean report` |
| PRF-2 profile apply restores order | Existing `Session::apply_profile` | `applying_a_profile_restores_the_saved_order_exactly` |
| DET-1 Steam root discovery | `paths.rs` injectable Steam-root candidates | `windows_steam_candidates_keep_order_and_dedupe`, `unix_steam_candidates_keep_native_order_and_dedupe` |

## Open items for QA

- X-03 (full keyboard-only run at 1024×720): shortcuts are unit-tested
  (`Ctrl+1..5`, `Ctrl+F`, `Ctrl+A`, `Escape`, `Alt+Arrow`, reorder announcement);
  the end-to-end pointer-free trace is still QA's call.
- T-02 (200% Windows text scale) and Windows font rendering need the Windows
  reference machine; captures are Linux Chromium.
- Folder-picker behaviour in Settings/First run predates M4 and is unchanged.
