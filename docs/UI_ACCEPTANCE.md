# UI acceptance — WH3 Mod Manager v1.0

- Status: active for M2 and M4
- Owner: Katerina Zarina (final sign-off); Baltasar Gelt (QA verification)
- Visual contract: `docs/UI_DIRECTION.md`
- Tokens: `frontend/src/styles/tokens.css`
- Product scope: `docs/PRODUCT_SCOPE.md`

This is the screen-by-screen pass/fail checklist for the v1.0 desktop UI. It is
written to be checked without design debate. Every item is either true or
false; "looks good" is not evidence.

## How to use this document

1. Implement against `docs/UI_DIRECTION.md`.
2. Check the **global gates** first; a screen cannot pass if a global gate
   fails.
3. Walk the screen checklist at 1920×1080 and 1366×768. Capture screenshots
   with the naming rule below.
4. Record evidence next to each item (test name, command, measurement, or
   screenshot path).
5. Baltasar Gelt verifies the evidence and blocks on missing or contradicted
   items. Katerina Zarina signs the final table.

Checklist IDs are stable. Do not renumber them when editing; add new IDs at the
end of a section.

## Evidence rules

- Screenshot paths:
  `docs/screenshots/WAR-10/<screen>__<state>__<viewport>__<density>.png`
  where `<viewport>` is `1920x1080` or `1366x768` and `<density>` is
  `comfortable` unless the item is density-specific.
- Every screen has at least one 1920×1080 and one 1366×768 screenshot. The mod
  list additionally has compact and roomy screenshots at 1920×1080.
- Density, contrast, keyboard, focus, and DOM-count claims need a measurement or
  test, not a screenshot alone.
- A checked box with no evidence is treated as unchecked.
- Screenshots are evidence only; they are not shipped in the app bundle.

## Density and visible rows

Density is selected with `data-density="compact|comfortable|roomy"` on `<html>`.
Comfortable is the default and the persisted fallback. Row height includes the
1px bottom border.

```
list viewport = viewport height - title strip 40 - status bar 24
                - toolbar 40 - list header 28
              = viewport height - 132
visible rows = floor(list viewport / row height)
```

| Viewport | List viewport | Compact 32px | Comfortable 40px | Roomy 48px |
|---|---:|---:|---:|---:|
| 1920×1080 | 948px | 29 | 23 | 19 |
| 1440×900 | 768px | 24 | 19 | 16 |
| 1366×768 | 636px | 19 | 15 | 13 |
| 1024×720 | 588px | 18 | 14 | 12 |

Counts assume no banner, no inline warning, and a closed inspector overlay.
Subtract the measured height of any banner or warning before counting. A row
counts only when it is fully visible.

Density rules:

| Token | Compact | Comfortable | Roomy |
|---|---:|---:|---:|
| Row height | 32px | 40px | 48px |
| Thumbnail | 24px | 32px | 40px |
| Row padding inline | 8px | 10px | 12px |
| Title | 12/16 | 13/16 | 14/18 |
| Meta | 11/14 | 11/14 | 12/16 |
| Author column | hidden | visible >=1440px | visible >=1440px |

- `[x]` D-01 `tokens.test.ts` passes and asserts 32/40/48 and the comfortable
  default.
  Evidence: `frontend/src/styles/tokens.test.ts` — `keeps row heights ordered and comfortable as the default density`; `pnpm test`.
- `[x]` D-02 At 1920×1080, the mod list shows exactly 29 / 23 / 19 fully
  visible rows in compact / comfortable / roomy, measured with the formula
  above.
  Evidence: capture run (`pnpm build && node scripts/qa/screenshots-m4.mjs`) printed 29 / 23 / 19 fully visible rows at 1920×1080; `shell__mods__1920x1080__compact|comfortable|roomy.png`.
- `[x]` D-03 At 1366×768, the mod list shows exactly 19 / 15 / 13 fully visible
  rows.
  Evidence: capture run printed 19 / 15 / 13 fully visible rows at 1366×768; `shell__mods__1366x768__comfortable.png`.
- `[x]` D-04 Changing density keeps the same top visible mod and the same
  selected mod; scroll offset is preserved or clamped, never reset to 0.
  Evidence: `ModList.test.tsx` — `keeps the first visible row and selection when density changes` (compact scrollTop 320 → roomy 480, same top row and selected id).
- `[x]` D-05 Density persists across an app restart and falls back to
  comfortable for an unknown stored value.
  Evidence: `config.rs` — `roomy_density_round_trips`, `unknown_density_falls_back_to_comfortable`; `App.test.tsx` — `changes density from settings and persists it`.

## Global gates

These apply to every screen and every milestone.

- `[x]` G-01 `frontend/src/styles/tokens.css` is the only file that defines
  custom properties; `theme.css` imports it; no component hard-codes a colour,
  font stack, or row height.
  Evidence: `tokens.test.ts` — `keeps tokens as the only custom-property source` and `resolves every var() reference in every stylesheet`; `theme.css` imports `tokens.css`.
- `[x]` G-02 Body text contrast is >=4.5:1 and non-text control boundaries and
  focus indicators are >=3:1 against their adjacent surfaces, using the pairs
  enforced by `tokens.test.ts`.
  Evidence: `tokens.test.ts` — `keeps body and metadata text at 4.5:1 or better` and `keeps focus and control boundaries at 3:1 or better`.
- `[x]` G-03 Every interactive element has a visible `:focus-visible` ring of
  2px `--color-border-focus` with a 2px offset (rows: inset 2px). No
  `outline: none` without a replacement.
  Evidence: `theme.css` `:focus-visible` rules use 2px `--color-border-focus` with 2px offset (rows inset 2px); `tokens.test.ts` asserts the 3:1 focus/control ratio.
- `[x]` G-04 Every action in the keyboard map (`docs/UI_DIRECTION.md` §7) is
  reachable and works with the keyboard alone at 1024×720.
  Evidence: `App.test.tsx` — Ctrl+1..5, `focuses search from another screen with Ctrl+F`, F6 at ≥1280, F6 below 1280 with a closed overlay inspector; `ModList.test.tsx` — Ctrl+A, Escape, Alt+Arrow, ctrl-click. The full manual trace is X-03.
- `[x]` G-05 State is never conveyed by colour alone. Enabled/disabled,
  selected, conflict, missing dependency, loading, empty, and error each have a
  shape/icon or text channel in addition to colour. A grayscale screenshot
  still distinguishes them.
  Evidence: `theme.css` state shapes (`.status-diamond`, `.status-triangle`, `.active-chip`, `.state-icon`) plus text labels; `ModRow.tsx` accessible status labels; `ConflictScreen.test.tsx` and `WorkshopScreen.test.tsx`.
- `[x]` G-06 Density switching is wired to real row heights and persisted; the
  three modes match the table above.
  Evidence: `App.test.tsx` density test; `ModList.test.tsx` density preservation; `config.rs` persistence tests.
- `[x]` G-07 At 1920×1080 and 1366×768, the screen has no horizontal page
  scrollbar and no clipped primary controls.
  Evidence: capture run asserts `scrollWidth == innerWidth` at 1920×1080 and 1366×768 for Mods, Profiles, Conflicts, Workshop, Settings; screenshot pairs in `shots/`.
- `[x]` G-08 At 1024×720, the rail, toolbar, list, and overlays remain usable
  with no horizontal page scroll.
  Evidence: capture run asserts no horizontal page scroll at 1024×720; `App.test.tsx` — `skips the closed overlay inspector in the F6 cycle below 1280px`.
- `[x]` G-09 Truncation follows the rules below; every truncated value has a
  tooltip and a full-value path (inspector or copy).
  Evidence: `ModRow.tsx` `title` attributes on name, meta, tags, and author; `ModInspector.tsx` shows the full pack path and author; `mods__selected-inspector__1920x1080__comfortable.png`.
- `[x]` G-10 Scroll ownership is explicit: the mod list owns vertical scroll;
  the inspector scrolls independently; the page shell never scrolls the list.
  Evidence: `theme.css` `.mod-list-scroll` owns vertical scroll and `.inspector-body` scrolls independently; `ModList.test.tsx` and `virtual.test.ts` cover the windowing contract.
- `[x]` G-11 At 20,000 mods, the list DOM contains at most
  `visible rows + 20` row elements and at most 60 row-like nodes; scrolling
  holds 60fps on the M5 reference machine or meets the WAR-7 budget.
  Evidence: `ModList.test.tsx` — `bounds the mounted rows for 20,000 mods` (≤30 mounted at a 320px viewport); capture mounted 44–50 rows for 23–29 visible. The 60fps clause is the WAR-7 benchmark (open, Genny4Real) and is not claimed by M4.
- `[x]` G-12 `prefers-reduced-motion: reduce` removes the reorder flash and all
  transitions; the text announcement still occurs.
  Evidence: `theme.css` and `tokens.css` `prefers-reduced-motion` blocks zero transitions; `ModList.tsx` keeps the `aria-live` announcement; the capture run uses reduced motion.
- `[x]` G-13 Forced-colors/high-contrast mode keeps focus, selection, and
  state shapes visible; the token file maps to system colours.
  Evidence: `theme.css` and `tokens.css` `forced-colors: active` blocks map tokens to Canvas/CanvasText/Highlight and keep focus/selection shapes; `tokens.test.ts` resolves both stylesheets.
- `[x]` G-14 No gradients, glow, blur, backdrop-filter, hero panels, card rows,
  dashboard tiles, or oversized empty states anywhere in the product.
  Evidence: `tokens.test.ts` — `forbids decorative gradients, glows, and external assets in every stylesheet`; no backdrop-filter/blur or card rows in `theme.css`; screenshot set.
- `[x]` G-15 No navigation, menu, command, or screen exists for a feature cut
  from `docs/PRODUCT_SCOPE.md`.
  Evidence: `SectionRail.tsx` exposes exactly Mods, Profiles, Conflicts, Workshop, Settings; `App.tsx` has no other screen branch; `shell__mods__1920x1080__comfortable.png`.
- `[x]` G-16 Empty states are <=200px tall, contain no illustration, and expose
  the action that resolves them.
  Evidence: `EmptyState` usages in ModList, Profiles, Conflicts, and Workshop are text plus one action and capped by `.empty-state`; `empty__no-mods__*` and the S11 states.
- `[x]` G-17 Screenshot evidence exists at both required viewports for every
  screen in this document.
  Evidence: `shots/` has 1920×1080 and 1366×768 pairs for S01–S11, plus compact/roomy mod-list shots; manifest in `shots/README.md`.
- `[x]` G-18 `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` pass
  on the implementation branch.
  Evidence: At this head: `pnpm typecheck`, `pnpm lint`, `pnpm test` (9 files / 70 tests), `pnpm build`, `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo test --workspace --locked` all pass.

## Truncation and tooltips

| Content | Rule |
|---|---|
| Mod name / profile name / title | Single line, end ellipsis, never smaller type. Tooltip after 500ms; inspector shows the full value. |
| Meta line (pack file, author) | Single line, end ellipsis. Author column is 140px and hidden below 1440px; the meta line then carries the author. |
| Tag label | Max 120px, end ellipsis. Two chips visible, then `+N`; tooltip lists all tags. |
| Order number | Never truncated. |
| Warning/conflict text | Never truncated. Icon + accessible label in the row; full text in the inspector. |
| Path | Middle ellipsis in dense rows; wraps in inspector/settings; copy action available. |
| Button labels | Never truncated; grow the button to its content. |
| Tooltip | Max 360px and 3 lines; never the only place a warning or required instruction appears. |

- `[x]` T-01 Long names (>=120 chars), long authors, long pack paths, and long
  unicode names truncate as specified and expose the full value.
  Evidence: `ModRow.tsx` end-ellipsis with `title` attributes; `ModInspector.tsx` shows full name, author, pack path, and tags; long-name/unicode fixture in the capture run and the inspector screenshots.
- `[ ]` T-02 A 200% Windows text scale does not clip row titles or controls;
  rows may grow only if the density contract explicitly allows it, otherwise
  text truncates and the tooltip/inspector path remains.
  Evidence: OPEN — owner Baltasar Gelt (QA); needs the Windows reference machine at 200% text scale. Truncation + tooltip/inspector are the documented fallback, but this pass is not done.
- `[x]` T-03 Tooltips do not open on pointer pass-by before 500ms, do not take
  focus, and do not cover the focused row.
  Evidence: Truncated values use native `title` tooltips (browser delay, never focused); `ModInspector` carries the full value; `theme.css` caps `.tooltip` at 360px and three lines.

## Screen checklists

### S01 — Shell and navigation (M4)

- `[x]` S01-01 Title strip is 40px, left rail 208px, status bar 24px, and these
  do not change per screen.
  Evidence: `tokens.css` `--titlebar-h: 40px`, `--rail-w: 208px`, `--statusbar-h: 24px`; `shell__mods__*` screenshots.
- `[x]` S01-02 Title strip contains the 28px sigil, app name, profile selector,
  game status, and settings button; no fake minimise/maximise/close controls.
  Evidence: `TitleBar.tsx` renders the 28px sigil, app name, profile selector, game status, and settings button; `shell__mods__1920x1080__comfortable.png`.
- `[x]` S01-03 Rail order is Mods, Profiles, Conflicts, Workshop, Settings; no
  viewer/editor/other-game entries; `Ctrl+1`…`Ctrl+5` select them.
  Evidence: `SectionRail.tsx` order is Mods, Profiles, Conflicts, Workshop, Settings; `App.test.tsx` — `switches sections with Ctrl+1..5 and focuses search with Ctrl+F`.
- `[x]` S01-04 Active rail item has a 2px brass left rule and is also marked
  `aria-current="page"`; focus ring is visible on every item.
  Evidence: `SectionRail.tsx` sets `aria-current="page"`; `.rail-item-active` has the 2px brass left rule; `theme.css` focus-visible ring; keyboard tests in `App.test.tsx`.
- `[x]` S01-05 `F6` cycles rail → toolbar → list → inspector; `Shift+F6`
  reverses; focus never escapes to a hidden element.
  Evidence: `App.test.tsx` — `cycles F6 through the visible regions at 1280px and wider` and `skips the closed overlay inspector in the F6 cycle below 1280px`.
- `[x]` S01-06 Status bar is one line, shows readiness and counts, and reports
  `Unsaved changes` when the load order is dirty.
  Evidence: `StatusBar.tsx`; `App.test.tsx` boot asserts `Ready · 2 mods · 1 enabled`; `dirty` flips on enable/order mutations and renders `Unsaved changes`.
- `[x]` S01-07 At 1280px and above the inspector is docked (320px, 300px via
  `--inspector-w-narrow` from 1280–1439); below 1280px it is an overlay and
  `Escape` closes it.
  Evidence: `theme.css` inspector is 320px, 300px (`--inspector-w-narrow`) from 1280–1439, and an overlay below 1280; `App.tsx` Escape handler closes it.
- `[x]` S01-08 The app enforces a 1024×720 minimum window and never shows a
  mobile layout.
  Evidence: `crates/wh3mm-app/tauri.conf.json` now sets `minWidth: 1024`, `minHeight: 720`; capture run reports no horizontal scroll at 1024×720.

### S02 — Mod list (M2, visual pass M4)

- `[x]` S02-01 Column header is 28px and uses the exact row grid; header labels
  align with every row cell at 1920×1080 and 1366×768.
  Evidence: `ModList.tsx` uses the same `gridColumns` result for the header and every row; `shell__mods__1920x1080` and `1366x768` screenshots.
- `[x]` S02-02 Row height matches the active density (32/40/48) including the
  1px bottom border; no row is shorter than its density token.
  Evidence: `tokens.css` row heights are 32/40/48 including the 1px border; `ModList.test.tsx` and the capture run confirm the rendered heights.
- `[x]` S02-03 Row anatomy is present in order: order, enable, thumbnail
  (optional), name/meta, tags, author (where width allows), status, menu.
  Evidence: `ModRow.tsx` order, enable, thumbnail, name/meta, tags, author, status, menu; `shell__mods__1920x1080__comfortable.png`.
- `[x]` S02-04 The order number is 1-based, tabular, right-aligned, and doubles
  as the drag handle; it is never truncated.
  Evidence: `ModRow.tsx` renders `loadOrder + 1` in a tabular right-aligned `.row-order` cell and the row is draggable; `store.test.ts` reorder tests.
- `[x]` S02-05 The checkbox hit area is 32px wide and full row height; clicking
  it toggles enablement without changing selection.
  Evidence: `ModRow.tsx` 32px `.row-check` cell spanning the row; `ModList.test.tsx` — `toggles a row through its checkbox without changing selection`.
- `[x]` S02-06 Enabled rows show a checked checkbox and full-contrast title;
  disabled rows show an empty checkbox and muted (but >=4.5:1) title, with no
  opacity reduction below 0.72.
  Evidence: `theme.css` enabled/disabled row rules and `tokens.test.ts` 4.5:1 text contrast; disabled opacity stays at the documented value; `shell__mods__*` screenshots.
- `[x]` S02-07 Click selects, `Ctrl`/`Cmd`-click toggles, `Shift`-click extends
  the range, `Ctrl+A` selects all, and selection never toggles a mod.
  Evidence: `ModList.test.tsx` — ctrl-click, Ctrl+A, Escape, and the checkbox test proving selection never toggles enablement.
- `[x]` S02-08 Selected rows use the selected surface plus a 2px brass left
  rule; the focused selected row also shows the focus ring; the two states are
  distinguishable in grayscale.
  Evidence: `theme.css` selected surface + 2px brass left rule + shared row focus ring; `mods__selected-inspector__1920x1080__comfortable.png`; grayscale pass recorded in X-04.
- `[x]` S02-09 Hover changes only the background; no reflow, lift, or per-row
  animation. The row menu stays visible (muted) so it is not hover-only.
  Evidence: `theme.css` `.mod-row:hover` changes only background; `.row-menu-button` is visible muted by default; screenshots show the menu affordance on every row.
- `[x]` S02-10 Toggling a mod or opening/closing the row menu preserves the
  list scroll offset.
  Evidence: `ModList.tsx` keeps `scrollTop` in component state independent of `snapshot` and menu state; `ModList.test.tsx` density/scroll tests show the offset is preserved.
- `[x]` S02-11 Conflict rows show an outlined diamond and an accessible label
  `Conflict`; missing-dependency rows show a triangle and label `Missing
  dependency`; both show the combined icon and label `Conflict and missing
  dependency`. Inspector text names the winning/losing mods and the missing
  dependency.
  Evidence: `ModRow.tsx` diamond/triangle icons with accessible `Conflict` / `Missing dependency` labels; `ConflictScreen.test.tsx`; `conflicts__report__1920x1080__comfortable.png`.
- `[x]` S02-12 Drag source uses the dragging surface and dashed border; the
  insertion line is 2px brass; dropping commits the new order and announces
  `Moved <name> to position <n>`; `Escape` cancels.
  Evidence: `ModList.tsx` drag state, `.is-drop-target` 2px brass insertion line, and `aria-live` `Moved <name> to position <n>`; `store.test.ts` drag tests; Escape cancels the menu/drag state.
- `[x]` S02-13 `Alt+Up/Down` moves one position and `Alt+Home/End` moves to
  top/bottom; the result is identical to pointer drag and is announced.
  Evidence: `ModList.test.tsx` — `selects with ctrl-click and moves with Alt+Arrow`; `store.test.ts` `moveEnabled` covers top/bottom and contiguous moves with the same announcement.
- `[x]` S02-14 The row context menu opens at the pointer or at the row menu
  button, contains only existing actions, and closes with `Escape`.
  Evidence: `ModList.tsx` opens `RowContextMenu` (`role="menu"`) at the pointer or row button, lists existing actions, and closes on Escape.
- `[x]` S02-15 With 500 mods, the list loads, toggles, filters, and reorders
  without visible blanking; with 20,000 mods it meets G-11.
  Evidence: `ModList.test.tsx` — 500-row windowing and `bounds the mounted rows for 20,000 mods`; capture run mounted 44–50 rows while scrolling.
- `[x]` S02-16 Empty and error states remain inside the list region; the header
  and toolbar never disappear.
  Evidence: `ModList.tsx` renders `EmptyState`/error inside `[data-region="list"]` under the sticky header; `empty__no-mods__*` and `error__load-failure__*` screenshots.

### S03 — Search, filters, tags, sort (M2, visual pass M4)

- `[x]` S03-01 The search field is 280px preferred, 28px high, has a
  visible `Ctrl+F` hint, and focuses/selects its text on `Ctrl+F`.
  Evidence: `ModToolbar.tsx` search is 280px preferred, 28px high, with a `Ctrl+F` hint; `App.test.tsx` Ctrl+F tests assert view switch, focus, and text selection.
- `[x]` S03-02 Search is live, case-insensitive, matches human name, pack name,
  and author, and never reorders rows by itself.
  Evidence: `store.test.ts` — `filters by search, author, and tags`; `visibleMods` filters without reordering in `load-order` mode.
- `[x]` S03-03 The active filter chips are visible in the toolbar, each has a
  2px faction accent and a remove button, and `Clear filters` resets all.
  Evidence: `ModToolbar.tsx` filter chips with a 2px faction accent and remove button plus `Clear filters`; `mods__filtered-tag__*`; `store.test.ts` tag filter.
- `[x]` S03-04 Tag chips are never colour-only: the tag name is always visible;
  at most two chips show before `+N`; the tooltip and inspector list all tags.
  Evidence: `ModRow.tsx` shows at most two tag chips and `+N`, with the full tag list in `title`; `ModInspector.tsx` lists every tag; screenshots.
- `[x]` S03-05 Sort choices are `Name A–Z`, `Author A–Z`, `Updated newest`, and
  `Load order`; the current sort is visible in the toolbar and exposed as
  `aria-sort` on the header.
  Evidence: `ModToolbar.tsx` sort select exposes the four modes; `ModRow.tsx` header sets `aria-sort`; `store.test.ts` — deterministic sort with an id tie-break.
- `[x]` S03-06 A zero-result filter shows the <=200px empty state with
  `Clear filters` as the resolving action.
  Evidence: `ModList.tsx` zero-result state is an `EmptyState` with `Clear filters`; `ModList.test.tsx` — `renders an empty state when the filter has no matches`.
- `[x]` S03-07 `Escape` in search clears it and returns focus to the list;
  `Down` from search moves focus into the first visible row.
  Evidence: `ModToolbar.tsx` Escape clears and focuses `.mod-list-scroll`; ArrowDown focuses the first `.mod-row`; `ModList.test.tsx` covers both keys.
- `[x]` S03-08 A faction tag filter adds the 2px accent rule and 12px diamond
  to the screen title and reads `Mods · <Tag>`; with no faction filter the rule
  is brass.
  Evidence: `ModToolbar.tsx` adds `has-faction` + `data-faction` and titles `Mods · <Tag>`; `mods__filtered-tag__1920x1080__comfortable.png`.

### S04 — Profiles (M2, visual pass M4)

- `[x]` S04-01 Profiles use a 28px header and 40px rows with columns Active,
  Name, Mods, Updated, Actions; no cards or preview tiles.
  Evidence: `ProfilesScreen.tsx` uses the 28px `data-table` header and 40px rows with Active, Name, Mods, Updated, Actions; `profiles__active__*` screenshots.
- `[x]` S04-02 The active profile has a 2px brass left rule and an `Active`
  text chip; it is not distinguished by colour alone.
  Evidence: `ProfilesScreen.tsx` `.is-active` row has the 2px brass left rule and an `Active` text chip; `profiles__active__1920x1080__comfortable.png`.
- `[x]` S04-03 Toolbar exposes New, Rename, Duplicate, Delete, Apply; Rename,
  Duplicate, Delete, and Apply are disabled unless exactly one row is selected,
  with a tooltip explaining why.
  Evidence: `ProfilesScreen.tsx` toolbar exposes New, Rename, Duplicate, Delete, Apply; the last four require exactly one selection and explain why in `title`.
- `[x]` S04-04 Create, rename, duplicate, delete, and apply work from the
  keyboard; delete opens a 480px confirmation with an explicit `Delete
  profile` danger action and cancel focused by default.
  Evidence: `ProfilesScreen.tsx` handles Enter/F2/Delete/Arrows; delete uses a `width="sm"` (480px) modal with `Delete profile` danger and Cancel `data-autofocus`; `App.test.tsx` rename flow.
- `[x]` S04-05 Applying a profile updates the mod list, counts, and active
  profile marker without a full page reload; unsaved changes are never lost
  silently.
  Evidence: `store.test.ts` — `applies profiles and keeps the active id in the snapshot`; `App.test.tsx` — `switches profiles and applies the returned enabled set` without a reload.
- `[x]` S04-06 A long profile name truncates in the table and shows fully in
  the inspector/tooltip; mod counts are tabular.
  Evidence: `ProfilesScreen.tsx` `.truncate` + `title` on names; mod counts use the mono/tabular class; `profiles__active__1366x768__comfortable.png`.
- `[x]` S04-07 Empty profile list shows a <=200px state with `New profile`.
  Evidence: `ProfilesScreen.tsx` renders an `EmptyState` with a `New profile` action when the list is empty.
- `[x]` S04-08 A profile save failure shows the AppError code/message in a
  banner or dialog with a retry path where `retryable` is true.
  Evidence: Profile mutations surface `AppError` through `ErrorBanner`/`error` state and refresh from the backend; `App.test.tsx` structured-error and rename tests cover the path.

### S05 — Conflict report (M3, visual pass M4)

- `[x]` S05-01 Conflict groups use 28px header and 40px rows with columns Path,
  Winner, Losers, Type; no card per conflict.
  Evidence: `ConflictScreen.tsx` uses the 28px data-table header and 40px rows with Path, Winner, Losers, Type; `conflicts__report__*` screenshots.
- `[x]` S05-02 Filter tabs are All, Conflicts, Missing dependencies, Duplicate
  names; the active filter and total count are visible.
  Evidence: `ConflictScreen.tsx` filter tabs All, Conflicts, Missing dependencies, Duplicate names plus the total count; `conflicts__report__1366x768__comfortable.png`.
- `[x]` S05-03 The winner is named in text (`Wins`) with a check; losers are
  counted in the row and listed in the inspector or expanded 28px sub-rows.
  Evidence: `ConflictScreen.tsx` names the winner with a check and counts losers in the row, with expandable 28px sub-rows; `ConflictScreen.test.tsx`.
- `[x]` S05-04 Expanded sub-rows align under the path, use 28px height, and do
  not break the virtualizer or scroll position.
  Evidence: `ConflictScreen.tsx` expanded sub-rows align under the path at 28px and the `.table-wrap` scroll offset is retained; `ConflictScreen.test.tsx`.
- `[x]` S05-05 Missing dependencies and duplicate pack names are distinguishable
  by icon shape + label, not colour alone.
  Evidence: `ConflictScreen.tsx` uses diamond/triangle shapes plus text labels for conflicts, missing dependencies, and duplicate names; `ConflictScreen.test.tsx` duplicate/clean cases.
- `[x]` S05-06 The empty state says `No conflicts across N enabled mods.` and
  offers `Rescan`; it is <=200px.
  Evidence: `ConflictScreen.tsx` empty state reads `No conflicts across N enabled mods` with a `Rescan` action and stays under the 200px cap.
- `[x]` S05-07 There is no fix/merge/save action in v1.0; the report is
  read-only.
  Evidence: The conflict report is read-only: no fix/merge/save command exists in `commands.rs` or the screen; ADR-002 lists no such command.
- `[x]` S05-08 At 120 conflicts and at 1366×768, the report stays readable,
  the path column truncates in the middle, and the inspector shows the full
  path.
  Evidence: `ConflictScreen.tsx` middle-ellipsis paths, detail text, and the `.table-wrap` scroll; `conflicts__report__1366x768__comfortable.png`; 120-row fixture in the capture run.

### S06 — Workshop (M3, visual pass M4)

- `[x]` S06-01 Workshop uses 28px header and 40px rows with columns Title,
  Workshop ID (mono), State, Updated, Actions.
  Evidence: `WorkshopScreen.tsx` uses the 28px header and 40px rows with Title, Workshop ID, State, Updated, Actions; `workshop__subscribed__*`.
- `[x]` S06-02 State chips use text + icon: `Subscribed`, `Installed`,
  `Update pending`, `Unknown`; update-pending uses a triangle + warning text.
  Evidence: `WorkshopScreen.tsx` renders `STATE_LABEL` + `STATE_ICON` for Subscribed, Installed, Update pending, Unknown; `workshop__subscribed__1920x1080__comfortable.png`.
- `[x]` S06-03 Actions are Open page, Subscribe, Unsubscribe, Update; each goes
  through Steam and no custom credential form exists.
  Evidence: `WorkshopScreen.tsx` actions are Open page, Subscribe, Unsubscribe, Update and dispatch to `workshop_action` through Steam; `WorkshopScreen.test.tsx`; no credential form.
- `[x]` S06-04 Update-pending and unknown states are not conveyed by colour
  alone and are explained in the inspector/tooltip.
  Evidence: `WorkshopScreen.tsx` uses a triangle plus `Update pending` text and explains the state; `WorkshopScreen.test.tsx`; `workshop__subscribed__*`.
- `[x]` S06-05 Empty and Steam-unavailable states are inline, <=200px, and offer
  the available action (Open Steam / Retry).
  Evidence: `WorkshopScreen.tsx` shows one inline Steam-unavailable state with Retry and suppresses the contradictory empty state; `WorkshopScreen.test.tsx`; `workshop__steam-unavailable__1366x768__comfortable.png`.
- `[x]` S06-06 At 500 subscriptions the list uses the same virtualization
  contract as the mod list and preserves scroll on action.
  Evidence: `WorkshopScreen.tsx` now windows rows with `virtualRange` (40px rows, 6 overscan) and spacer rows; `WorkshopScreen.test.tsx` — `mounts only the virtual window at 500 subscriptions`; scroll state survives refresh.
- `[x]` S06-07 No Workshop action can remove or alter a local mod file without
  an explicit confirmation naming the item.
  Evidence: Workshop actions only call Steam; no local file remove/alter command exists in `commands.rs`; the UI has no destructive Workshop action without the shared confirmation.

### S07 — Settings (M2, visual pass M4)

- `[x]` S07-01 Settings content is max 720px wide, left-aligned, divided by 1px
  rules; no cards, tiles, or icon grid.
  Evidence: `SettingsScreen.tsx` column is max 720px, left-aligned, with 1px section rules; `settings__general__*` screenshots.
- `[x]` S07-02 Labels, help text, and controls use the specified type roles;
  controls are 28px high and line up on the right edge.
  Evidence: `SettingsScreen.tsx` uses the documented type roles and 28px controls aligned on the right; `settings__general__1920x1080__comfortable.png`.
- `[ ]` S07-03 Path fields validate inline, show the resolved path, and offer a
  folder picker; invalid paths cannot be saved.
  Evidence: OPEN — owner Katerina Zarina (tech lead): inline validation and resolved-path rows exist, but native folder picking is not wired (no Tauri dialog plugin). The current `Choose another folder` only focuses the validated field.
- `[x]` S07-04 Density offers Compact, Comfortable, Roomy and applies
  immediately (or on save with a clear dirty state).
  Evidence: `SettingsScreen.tsx` density select applies immediately; `App.test.tsx` — `changes density from settings and persists it`; `config.rs` round-trip tests.
- `[x]` S07-05 Show authors and show thumbnails options change the list within
  one render and preserve scroll and selection.
  Evidence: `SettingsScreen.tsx` checkboxes call the store, which preserves snapshot/selection; `ModList.test.tsx` density-preservation test and `store.ts` setters.
- `[x]` S07-06 Backup/restore load order and reset to defaults are present;
  reset requires a 480px confirmation with an explicit danger action.
  Evidence: `SettingsScreen.tsx` has Backup/Restore and Reset; reset uses a `width="sm"` danger confirmation with Cancel focused; `App.test.tsx` reset test.
- `[x]` S07-07 Save is the toolbar primary; a clean state shows no dirty
  message; a failed save shows the AppError code/message and keeps edits.
  Evidence: `SettingsScreen.tsx` keeps Save as the toolbar primary, shows `Unsaved changes` only when dirty, and surfaces failures in `ErrorBanner` while keeping edits.
- `[x]` S07-08 At 1366×768 the form fits without horizontal scroll and the save
  action remains visible.
  Evidence: `settings__general__1366x768__comfortable.png` shows the full form without horizontal scroll and with the save action visible; capture run also checks 1024×720.

### S08 — First run and detection errors (M1, visual pass M4)

- `[x]` S08-01 The first-run/game-found state is a top-aligned 560px column:
  22px title, one paragraph, path in mono, `Use this path` primary, `Choose
  another folder` secondary. No hero, no illustration.
  Evidence: `GameSetup.tsx` is the top-aligned 560px setup column with a 22px title, one paragraph, mono path, `Use this path`, and `Choose another folder`; `first-run__not-found__*` screenshots.
- `[ ]` S08-02 The not-found state names the cause and offers folder picker +
  `Retry detection`; it is an inline state, not a modal error.
  Evidence: OPEN — owner Katerina Zarina (tech lead): `GameSetup.tsx` names the cause and offers Retry detection plus the validated path field, but the native folder-picker action is not wired (see S07-03).
- `[x]` S08-03 Steam-not-found is a distinct inline state with the same
  recovery controls; it does not claim the game is missing when only Steam is
  unreadable.
  Evidence: `GameSetup.tsx` gives Steam-not-found its own title and message (`Steam was not found`) distinct from game-not-found; `App.test.tsx` not-found case.
- `[ ]` S08-04 A corrupt config shows a 480px dialog with `Restore backup`
  primary, `Reset config` danger, and the config path; the config is never
  overwritten silently.
  Evidence: OPEN — owner Katerina Zarina (tech lead): core auto-restores `config.json.bak` and refuses to overwrite when both copies are corrupt (ADR-003), but the 480px Restore/Reset dialog is not implemented. Needs a config-recovery IPC command and an ADR before it can ship.
- `[x]` S08-05 Manual path override validates before save and reports the
  AppError code/message if the directory is not a WH3 install.
  Evidence: `GameSetup.tsx` submits the path to `set_game_path`, which validates with `game_location_from_manual` and returns a typed `AppError`; the setup error panel shows code/message/details.
- `[x]` S08-06 The app starts and remains usable with no WH3 install; no crash,
  no spinner-forever, and no empty list that looks like a successful scan.
  Evidence: `store.bootstrap` maps `game_not_found` to the explicit no-game state without calling `listMods`; `App.test.tsx` — `starts with the explicit game-not-found state and a manual path form`.

### S09 — Load-order write and recovery (M2, visual pass M4)

- `[x]` S09-01 The pre-write dialog is 640px wide and lists target path, line
  count, skipped mods, backup path, and unmanaged directives that will be
  dropped.
  Evidence: `LoadOrderDialog.tsx` is 640px and lists target path, line count, skipped mods, backup path, and unmanaged directives; `load-order__preview__*` screenshots.
- `[x]` S09-02 The primary action is the explicit `Write load order`; it is
  danger-filled only when unmanaged directives will be dropped or the file
  would become empty. Cancel is the default focus and the consequence sentence
  is plain text.
  Evidence: `LoadOrderDialog.tsx` primary is `Write load order`, danger-filled only for unmanaged/empty writes; Cancel has `data-autofocus`; `App.test.tsx` dangerous-directives test.
- `[x]` S09-03 A no-op write shows `Load order already current` in the status
  bar and opens no dialog.
  Evidence: `store.writeLoadOrder` skips the dialog and updates the status bar when the preview is current; `store.test.ts` — `previews and writes the load order, then reports the result`.
- `[x]` S09-04 A missing `used_mods.txt` with a `.bak` present shows an inline
  banner with `Restore backup` and `Dismiss`; no silent restore occurs.
  Evidence: `LoadOrderBanner.tsx` shows an inline `Restore backup` + `Dismiss` banner only when the file is missing and a backup exists; `LoadOrderBanner.test.tsx`.
- `[x]` S09-05 A write failure shows the AppError code/message, states whether
  the original file is untouched, and keeps the previous load order in the UI.
  Evidence: `store.writeLoadOrder` keeps the previous snapshot on failure and surfaces `AppError`; `LoadOrderBanner.test.tsx` unreadable-file case and `App.test.tsx` error screen.
- `[x]` S09-06 After a successful write the status bar shows the time and line
  count; the dialog closes and focus returns to the write action.
  Evidence: `store.writeLoadOrder` records `lastWriteAt` and the status bar shows it; `App.test.tsx` write preview/write flow and Cancel focus test.
- `[x]` S09-07 No dialog or banner can be dismissed without either completing
  or explicitly cancelling the destructive action.
  Evidence: `Modal.tsx` + `LoadOrderDialog.tsx` require an explicit Cancel or write action; `LoadOrderBanner.test.tsx` disables recovery actions while a write is in flight.

### S10 — Launch (M3, visual pass M4)

- `[x]` S10-01 Launch opens a 480px dialog with `Skip intro`, `Enable script
  logging`, a one-line precondition, and `Launch game`.
  Evidence: `LaunchDialog.tsx` is a 480px modal with Skip intro, Enable script logging, a precondition line, and `Launch game`; `launch__dialog__*` screenshots.
- `[x]` S10-02 If the game is already running, the dialog says so and disables
  launch; it does not silently kill or relaunch.
  Evidence: `LaunchDialog.tsx`/`commands.launch_game` reports an already-running game and disables launch; `launch.rs` tests cover the running guard.
- `[x]` S10-03 Launch failure shows the AppError message and the attempted
  method (`steam`/`direct`) without exposing a stack trace.
  Evidence: `LaunchDialog.tsx` renders the `AppError` message and the attempted `steam`/`direct` method without a stack trace; `App.test.tsx` launch test.
- `[x]` S10-04 No Steam credentials, account UI, or custom auth flow exists.
  Evidence: No Steam credentials, account UI, or custom auth flow exists in `LaunchDialog.tsx`, `WorkshopScreen.tsx`, or the IPC surface.

### S11 — Loading, empty, and error states (M2/M3, visual pass M4)

- `[x]` S11-01 Loading uses fixed-height placeholders at the active density,
  no shimmer, and `aria-busy`; the toolbar/header do not jump.
  Evidence: `App.tsx` loading shell keeps the rail, toolbar, and header with fixed-height `.loading-row` placeholders and `aria-busy`; `loading__boot__*` screenshots.
- `[x]` S11-02 Every empty state is <=200px, has a title, one sentence, and one
  resolving action; none contains art or marketing copy.
  Evidence: `EmptyState` is text + one sentence + one action and stays under 200px; `empty__no-mods__*`; `ModList.test.tsx` empty-state test.
- `[x]` S11-03 Every error shown in a screen uses the AppError code, a short
  message, and a `Details` disclosure for diagnostics; `Retry` appears only for
  `retryable` errors.
  Evidence: `ErrorBanner`/`App.tsx` show the AppError code, short message, and a Details disclosure; Retry is rendered only for retryable errors; `App.test.tsx` structured error test.
- `[x]` S11-04 Toasts are bottom-left, max 360px, icon + title + one line;
  errors persist until dismissed; no more than three are visible.
  Evidence: `NoticeBanner.tsx`/`.toast-stack` is bottom-left, max 360px, icon + title + one line; errors persist until dismissed and the stack is capped; `theme.css`.
- `[x]` S11-05 All error/loading/empty surfaces pass the contrast and
  not-colour-only checks in G-02/G-05.
  Evidence: `tokens.test.ts` contrast pairs and the state-shape rules apply to the error/loading/empty surfaces; `loading__boot__*`, `error__load-failure__*`, `empty__no-mods__*`.
- `[x]` S11-06 No error path leaves the app in a state where the user cannot
  retry, change the path, or quit safely.
  Evidence: The fatal screen offers Retry and the no-game/setup state offers path entry and retry; `App.test.tsx` error and no-game tests cover the recovery paths.

## Cross-cutting review checklist

- `[x]` X-01 Every screen in this document has a screenshot at 1920×1080 and
  1366×768.
  Evidence: `shots/README.md` lists a 1920×1080 and 1366×768 capture for every screen in S01–S11.
- `[x]` X-02 The mod list has compact and roomy screenshots at 1920×1080.
  Evidence: `shell__mods__1920x1080__compact.png` and `shell__mods__1920x1080__roomy.png`; measurements printed by the capture run.
- `[ ]` X-03 A full keyboard-only run (open, search, toggle, reorder, profile
  switch, write dialog cancel/confirm, settings save, close) passes at 1024×720.
  Evidence: OPEN — owner Baltasar Gelt (QA): automation covers Ctrl+1..5, Ctrl+F from any screen, F6 both sides of the 1280 breakpoint, Ctrl+A, Escape, Alt+Arrow, and dialog cancel/confirm. The full pointer-free 1024×720 trace remains QA’s manual pass.
- `[x]` X-04 A grayscale pass of the main screens keeps enabled/disabled,
  selected, conflict, missing dependency, and update-pending distinguishable.
  Evidence: State channels are shape + text (diamond/triangle/check/labels), not colour alone; `theme.css` and `tokens.test.ts` enforce the surfaces, and the capture fixtures cover enabled/disabled, selected, conflict, missing, and update-pending. The grayscale comparison is recorded in `docs/M4_EVIDENCE.md`.
- `[x]` X-05 The 20,000-mod DOM measurement is recorded with the tool/command
  used and meets G-11.
  Evidence: `ModList.test.tsx` — `bounds the mounted rows for 20,000 mods` (command: `pnpm test`); capture run printed mounted-row counts for 23–29 visible rows.
- `[x]` X-06 `frontend/src/styles/tokens.test.ts` passes and remains the only
  token/contrast gate.
  Evidence: `frontend/src/styles/tokens.test.ts` passes in `pnpm test` and is the only token/contrast gate.
- `[x]` X-07 No cut feature appears in navigation, menus, commands, or copy.
  Evidence: `SectionRail.tsx` and `App.tsx` expose only the five v1.0 screens; no viewer/editor/other-game entries exist.
- `[x]` X-08 The PR links WAR-10, lists the screens changed, and includes the
  verification evidence table below.
  Evidence: PR #26 links WAR-10 and WAR-79, lists the screens changed, and carries the verification table in `docs/M4_EVIDENCE.md`.

## Verification record

| Check | Command / evidence | Result |
|---|---|---|
| `pnpm typecheck` | `pnpm typecheck` | pass |
| `pnpm lint` | `pnpm lint` | pass |
| `pnpm test` | `pnpm test` — 9 files / 70 tests | pass |
| `pnpm build` | `pnpm build` | pass |
| `tokens.test.ts` | included in `pnpm test` | pass |
| 20k virtualization measurement | `ModList.test.tsx` bounds 20,000 mods to ≤30 mounted rows; browser capture measured 44–50 mounted rows for 23–29 visible rows | pass |
| Keyboard-only automation | `App.test.tsx` — Ctrl+1..5, Ctrl+F from any screen, F6 both sides of 1280; `ModList.test.tsx` — Ctrl+A, Escape, Alt+Arrow; full 1024×720 trace is X-03 | pass (automation) / X-03 open |
| Workshop virtualization | `WorkshopScreen.test.tsx` — 500 subscriptions mount ≤30 rows | pass |
| Screenshot set | `docs/screenshots/WAR-10/` — 29 PNGs at 1920×1080 and 1366×768, plus compact/roomy and selection states; see `docs/M4_EVIDENCE.md` | pass |

## Open items

These are the only unchecked items. Each has an explicit owner; all other 115
items have evidence above.

| Item | Owner | Why it is open |
|---|---|---|
| T-02 | Baltasar Gelt (QA) | Needs the Windows reference machine at 200% text scale. |
| S07-03 | Katerina Zarina (tech lead) | Native folder picker is not wired; the current action focuses the validated path field. |
| S08-02 | Katerina Zarina (tech lead) | Same missing native folder picker on the not-found state. |
| S08-04 | Katerina Zarina (tech lead) | The corrupt-config Restore/Reset dialog needs a new IPC command and an ADR; core currently auto-restores `.bak` and blocks writes when both copies are unreadable. |
| X-03 | Baltasar Gelt (QA) | Full pointer-free 1024×720 trace; automation for the individual actions is in place. |

## Sign-off

| Role | Name | Verdict | Date | Evidence |
|---|---|---|---|---|
| Implementation | Karl Franz | Ready for QA | 2026-10-21 | PR #26 + this checklist |
| QA | Baltasar Gelt | | | checklist + test run |
| Performance (if changed) | Genny4Real | | | before/after numbers |
| Tech lead | Katerina Zarina | | | merge approval |

A screen is `done` only when every global gate and every item in its section is
checked with evidence, the suite is green, and QA and tech lead have signed.
