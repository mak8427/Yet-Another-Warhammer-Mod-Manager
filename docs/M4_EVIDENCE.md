# M4 evidence — WAR-10 and the WAR-79 v1.0 blockers

Head: `feat/ui-direction-screens` after the M4 visual pass. Screenshot set:
`docs/screenshots/WAR-10/` (29 PNGs, both required viewports; capture method in
that directory's README).

## Verification commands

| Gate | Command | Result |
|---|---|---|
| Types | `pnpm typecheck` | pass |
| Lint | `pnpm lint` | pass |
| Frontend tests | `pnpm test` | 9 files / 70 tests pass |
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
| SET-4 reset settings and load order | `Session::reset_to_defaults`, `reset_to_defaults` IPC, Settings confirmation | `reset_to_defaults_keeps_profiles_and_tags_and_writes_an_empty_order`, `reset_to_defaults_without_a_game_still_persists_the_config`, `reset_defaults_report_uses_camel_case_on_the_wire`, `resets settings and the load order after confirmation` |
| ML-3 deterministic sort | `store.ts` id tie-break in every non-drag mode | `sorts deterministically with an id tie-break in every non-drag mode` |
| CF-4 duplicate pack names | Conflicts screen duplicate rows | `renders duplicate pack names and shows none for a clean report` |
| PRF-2 profile apply restores order | Existing `Session::apply_profile` | `applying_a_profile_restores_the_saved_order_exactly` |
| DET-1 Steam root discovery | `paths.rs` injectable Steam-root candidates | `windows_steam_candidates_keep_order_and_dedupe`, `unix_steam_candidates_keep_native_order_and_dedupe` |

## QA follow-up (WAR-10 changes requested at `29a45e6`)

| Defect | Fix | Test |
|---|---|---|
| F6 forward cycle stuck at <1280 with the closed overlay inspector | `focusRegion` skips regions whose computed visibility is hidden, skips the closed overlay inspector, and focuses the first visible control in the next region (at 1024 the toolbar title is media-hidden). F6 also works while the search input has focus, so the cycle cannot trap. `Ctrl+F` from another screen switches to Mods and focuses the search after mount | `App.test.tsx` — `cycles F6 ... >=1280`, `skips the closed overlay inspector and hidden toolbar content below 1280px`, `focuses search from another screen with Ctrl+F`; production-build CDP trace at 1024×720/1366×768 |
| `reset_to_defaults` reported "no game path" for a blocked write | `ResetDefaultsReport` now carries `loadOrderOutcome` (`written` / `no_game_path` / `blocked`) and `loadOrderBlockedReason`; the store renders the real reason and a warning notice | `session_flow.rs` — `reset_to_defaults_reports_a_blocked_load_order_and_leaves_the_file_untouched`; `store.test.ts` — `reports the real load-order reason when a reset is blocked` |
| Reset left `game.source = manual` until restart | a reset that clears the override refreshes the location from auto-detection and the store re-runs `detect_game` | `session_flow.rs` — `reset_to_defaults_returns_the_location_to_auto_detection`; `store.test.ts` — `re-detects the game after a reset ...` |
| Workshop did not use the mod-list virtualization contract at 500 rows | `WorkshopScreen` windows 40px rows with the shared `virtualRange` helper and spacer rows | `WorkshopScreen.test.tsx` — `mounts only the virtual window at 500 subscriptions` |
| App allowed a 960×640 window although the contract is 1024×720 | `tauri.conf.json` minimum is 1024×720 | capture run at 1024×720 |
| UI acceptance checklist was 0/120 | 115 items checked with per-item evidence; 5 open items have named owners | `docs/UI_ACCEPTANCE.md` |

Keyboard trace on the production build (`pnpm build`, headless Chromium CDP
`Input.dispatchKeyEvent`):

- 1024×720, focus a mod row: `F6` → rail → search input → Name sort button →
  rail; `Shift+F6` from the row → search input. The closed overlay inspector is
  never focused.
- 1366×768, focus a mod row: `F6` → inspector → rail (the wide inspector is a
  persistent column).
- 1024×720: `Ctrl+5` opens Settings, then `Ctrl+F` switches to Mods and focuses
  `#mod-search`.

## Grayscale pass (X-04)

Command:

```sh
cd docs/screenshots/WAR-10
magick shell__mods__1366x768__comfortable.png -colorspace Gray /tmp/grayscale-shell.png
magick conflicts__report__1366x768__comfortable.png -colorspace Gray /tmp/grayscale-conflicts.png
magick workshop__subscribed__1366x768__comfortable.png -colorspace Gray /tmp/grayscale-workshop.png
magick mods__selected-inspector__1366x768__comfortable.png -colorspace Gray /tmp/grayscale-selected.png
```

Result: enabled/disabled rows, the selected row, conflict diamonds, missing/
disabled triangles, and Workshop `Update pending` triangles remain
distinguishable through shape and text in grayscale.

## Open items for QA

- X-03 (full keyboard-only run at 1024×720): automation covers the individual
  actions (`Ctrl+1..5`, `Ctrl+F` from any screen, F6 both sides of 1280,
  `Ctrl+A`, `Escape`, `Alt+Arrow`, reorder announcement); the end-to-end
  pointer-free trace is still QA's call.
- T-02 (200% Windows text scale) and Windows font rendering need the Windows
  reference machine; captures are Linux Chromium.
- S07-03 / S08-02 (native folder picker) and S08-04 (corrupt-config
  Restore/Reset dialog) are open scope items owned by Katerina Zarina; they need
  a Tauri dialog/config-recovery contract before they can ship.
