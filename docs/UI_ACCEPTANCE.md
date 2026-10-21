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
| Author column | hidden | visible >=1280px | visible >=1280px |

- `[ ]` D-01 `tokens.test.ts` passes and asserts 32/40/48 and the comfortable
  default.
- `[ ]` D-02 At 1920×1080, the mod list shows exactly 29 / 23 / 19 fully
  visible rows in compact / comfortable / roomy, measured with the formula
  above.
- `[ ]` D-03 At 1366×768, the mod list shows exactly 19 / 15 / 13 fully visible
  rows.
- `[ ]` D-04 Changing density keeps the same top visible mod and the same
  selected mod; scroll offset is preserved or clamped, never reset to 0.
- `[ ]` D-05 Density persists across an app restart and falls back to
  comfortable for an unknown stored value.

## Global gates

These apply to every screen and every milestone.

- `[ ]` G-01 `frontend/src/styles/tokens.css` is the only file that defines
  custom properties; `theme.css` imports it; no component hard-codes a colour,
  font stack, or row height.
- `[ ]` G-02 Body text contrast is >=4.5:1 and non-text control boundaries and
  focus indicators are >=3:1 against their adjacent surfaces, using the pairs
  enforced by `tokens.test.ts`.
- `[ ]` G-03 Every interactive element has a visible `:focus-visible` ring of
  2px `--color-border-focus` with a 2px offset (rows: inset 2px). No
  `outline: none` without a replacement.
- `[ ]` G-04 Every action in the keyboard map (`docs/UI_DIRECTION.md` §7) is
  reachable and works with the keyboard alone at 1024×720.
- `[ ]` G-05 State is never conveyed by colour alone. Enabled/disabled,
  selected, conflict, missing dependency, loading, empty, and error each have a
  shape/icon or text channel in addition to colour. A grayscale screenshot
  still distinguishes them.
- `[ ]` G-06 Density switching is wired to real row heights and persisted; the
  three modes match the table above.
- `[ ]` G-07 At 1920×1080 and 1366×768, the screen has no horizontal page
  scrollbar and no clipped primary controls.
- `[ ]` G-08 At 1024×720, the rail, toolbar, list, and overlays remain usable
  with no horizontal page scroll.
- `[ ]` G-09 Truncation follows the rules below; every truncated value has a
  tooltip and a full-value path (inspector or copy).
- `[ ]` G-10 Scroll ownership is explicit: the mod list owns vertical scroll;
  the inspector scrolls independently; the page shell never scrolls the list.
- `[ ]` G-11 At 20,000 mods, the list DOM contains at most
  `visible rows + 20` row elements and at most 60 row-like nodes; scrolling
  holds 60fps on the M5 reference machine or meets the WAR-7 budget.
- `[ ]` G-12 `prefers-reduced-motion: reduce` removes the reorder flash and all
  transitions; the text announcement still occurs.
- `[ ]` G-13 Forced-colors/high-contrast mode keeps focus, selection, and
  state shapes visible; the token file maps to system colours.
- `[ ]` G-14 No gradients, glow, blur, backdrop-filter, hero panels, card rows,
  dashboard tiles, or oversized empty states anywhere in the product.
- `[ ]` G-15 No navigation, menu, command, or screen exists for a feature cut
  from `docs/PRODUCT_SCOPE.md`.
- `[ ]` G-16 Empty states are <=200px tall, contain no illustration, and expose
  the action that resolves them.
- `[ ]` G-17 Screenshot evidence exists at both required viewports for every
  screen in this document.
- `[ ]` G-18 `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` pass
  on the implementation branch.

## Truncation and tooltips

| Content | Rule |
|---|---|
| Mod name / profile name / title | Single line, end ellipsis, never smaller type. Tooltip after 500ms; inspector shows the full value. |
| Meta line (pack file, author) | Single line, end ellipsis. Author column is 140px and hidden below 1280px; the meta line then carries the author. |
| Tag label | Max 120px, end ellipsis. Two chips visible, then `+N`; tooltip lists all tags. |
| Order number | Never truncated. |
| Warning/conflict text | Never truncated. Icon + accessible label in the row; full text in the inspector. |
| Path | Middle ellipsis in dense rows; wraps in inspector/settings; copy action available. |
| Button labels | Never truncated; grow the button to its content. |
| Tooltip | Max 360px and 3 lines; never the only place a warning or required instruction appears. |

- `[ ]` T-01 Long names (>=120 chars), long authors, long pack paths, and long
  unicode names truncate as specified and expose the full value.
- `[ ]` T-02 A 200% Windows text scale does not clip row titles or controls;
  rows may grow only if the density contract explicitly allows it, otherwise
  text truncates and the tooltip/inspector path remains.
- `[ ]` T-03 Tooltips do not open on pointer pass-by before 500ms, do not take
  focus, and do not cover the focused row.

## Screen checklists

### S01 — Shell and navigation (M4)

- `[ ]` S01-01 Title strip is 40px, left rail 208px, status bar 24px, and these
  do not change per screen.
- `[ ]` S01-02 Title strip contains the 28px sigil, app name, profile selector,
  game status, and settings button; no fake minimise/maximise/close controls.
- `[ ]` S01-03 Rail order is Mods, Profiles, Conflicts, Workshop, Settings; no
  viewer/editor/other-game entries; `Ctrl+1`…`Ctrl+5` select them.
- `[ ]` S01-04 Active rail item has a 2px brass left rule and is also marked
  `aria-current="page"`; focus ring is visible on every item.
- `[ ]` S01-05 `F6` cycles rail → toolbar → list → inspector; `Shift+F6`
  reverses; focus never escapes to a hidden element.
- `[ ]` S01-06 Status bar is one line, shows readiness and counts, and reports
  `Unsaved changes` when the load order is dirty.
- `[ ]` S01-07 At 1280px and above the inspector is docked (320px, 300px from
  1280–1439); below 1280px it is an overlay and `Escape` closes it.
- `[ ]` S01-08 The app enforces a 1024×720 minimum window and never shows a
  mobile layout.

### S02 — Mod list (M2, visual pass M4)

- `[ ]` S02-01 Column header is 28px and uses the exact row grid; header labels
  align with every row cell at 1920×1080 and 1366×768.
- `[ ]` S02-02 Row height matches the active density (32/40/48) including the
  1px bottom border; no row is shorter than its density token.
- `[ ]` S02-03 Row anatomy is present in order: order, enable, thumbnail
  (optional), name/meta, tags, author (where width allows), status, menu.
- `[ ]` S02-04 The order number is 1-based, tabular, right-aligned, and doubles
  as the drag handle; it is never truncated.
- `[ ]` S02-05 The checkbox hit area is 32px wide and full row height; clicking
  it toggles enablement without changing selection.
- `[ ]` S02-06 Enabled rows show a checked checkbox and full-contrast title;
  disabled rows show an empty checkbox and muted (but >=4.5:1) title, with no
  opacity reduction below 0.72.
- `[ ]` S02-07 Click selects, `Ctrl`/`Cmd`-click toggles, `Shift`-click extends
  the range, `Ctrl+A` selects all, and selection never toggles a mod.
- `[ ]` S02-08 Selected rows use the selected surface plus a 2px brass left
  rule; the focused selected row also shows the focus ring; the two states are
  distinguishable in grayscale.
- `[ ]` S02-09 Hover changes only the background; no reflow, lift, or per-row
  animation. The row menu stays visible (muted) so it is not hover-only.
- `[ ]` S02-10 Toggling a mod or opening/closing the row menu preserves the
  list scroll offset.
- `[ ]` S02-11 Conflict rows show an outlined diamond and an accessible label
  `Conflict`; missing-dependency rows show a triangle and label `Missing
  dependency`; both show the combined icon and label `Conflict and missing
  dependency`. Inspector text names the winning/losing mods and the missing
  dependency.
- `[ ]` S02-12 Drag source uses the dragging surface and dashed border; the
  insertion line is 2px brass; dropping commits the new order and announces
  `Moved <name> to position <n>`; `Escape` cancels.
- `[ ]` S02-13 `Alt+Up/Down` moves one position and `Alt+Home/End` moves to
  top/bottom; the result is identical to pointer drag and is announced.
- `[ ]` S02-14 The row context menu opens at the pointer or at the row menu
  button, contains only existing actions, and closes with `Escape`.
- `[ ]` S02-15 With 500 mods, the list loads, toggles, filters, and reorders
  without visible blanking; with 20,000 mods it meets G-11.
- `[ ]` S02-16 Empty and error states remain inside the list region; the header
  and toolbar never disappear.

### S03 — Search, filters, tags, sort (M2, visual pass M4)

- `[ ]` S03-01 The search field is 280px preferred, 28px high, has a
  visible `Ctrl+F` hint, and focuses/selects its text on `Ctrl+F`.
- `[ ]` S03-02 Search is live, case-insensitive, matches human name, pack name,
  and author, and never reorders rows by itself.
- `[ ]` S03-03 The active filter chips are visible in the toolbar, each has a
  2px faction accent and a remove button, and `Clear filters` resets all.
- `[ ]` S03-04 Tag chips are never colour-only: the tag name is always visible;
  at most two chips show before `+N`; the tooltip and inspector list all tags.
- `[ ]` S03-05 Sort choices are `Name A–Z`, `Author A–Z`, `Updated newest`, and
  `Load order`; the current sort is visible in the toolbar and exposed as
  `aria-sort` on the header.
- `[ ]` S03-06 A zero-result filter shows the <=200px empty state with
  `Clear filters` as the resolving action.
- `[ ]` S03-07 `Escape` in search clears it and returns focus to the list;
  `Down` from search moves focus into the first visible row.
- `[ ]` S03-08 A faction tag filter adds the 2px accent rule and 12px diamond
  to the screen title and reads `Mods · <Tag>`; with no faction filter the rule
  is brass.

### S04 — Profiles (M2, visual pass M4)

- `[ ]` S04-01 Profiles use a 28px header and 40px rows with columns Active,
  Name, Mods, Updated, Actions; no cards or preview tiles.
- `[ ]` S04-02 The active profile has a 2px brass left rule and an `Active`
  text chip; it is not distinguished by colour alone.
- `[ ]` S04-03 Toolbar exposes New, Rename, Duplicate, Delete, Apply; Rename,
  Duplicate, Delete, and Apply are disabled unless exactly one row is selected,
  with a tooltip explaining why.
- `[ ]` S04-04 Create, rename, duplicate, delete, and apply work from the
  keyboard; delete opens a 480px confirmation with an explicit `Delete
  profile` danger action and cancel focused by default.
- `[ ]` S04-05 Applying a profile updates the mod list, counts, and active
  profile marker without a full page reload; unsaved changes are never lost
  silently.
- `[ ]` S04-06 A long profile name truncates in the table and shows fully in
  the inspector/tooltip; mod counts are tabular.
- `[ ]` S04-07 Empty profile list shows a <=200px state with `New profile`.
- `[ ]` S04-08 A profile save failure shows the AppError code/message in a
  banner or dialog with a retry path where `retryable` is true.

### S05 — Conflict report (M3, visual pass M4)

- `[ ]` S05-01 Conflict groups use 28px header and 40px rows with columns Path,
  Winner, Losers, Type; no card per conflict.
- `[ ]` S05-02 Filter tabs are All, Conflicts, Missing dependencies, Duplicate
  names; the active filter and total count are visible.
- `[ ]` S05-03 The winner is named in text (`Wins`) with a check; losers are
  counted in the row and listed in the inspector or expanded 28px sub-rows.
- `[ ]` S05-04 Expanded sub-rows align under the path, use 28px height, and do
  not break the virtualizer or scroll position.
- `[ ]` S05-05 Missing dependencies and duplicate pack names are distinguishable
  by icon shape + label, not colour alone.
- `[ ]` S05-06 The empty state says `No conflicts across N enabled mods.` and
  offers `Rescan`; it is <=200px.
- `[ ]` S05-07 There is no fix/merge/save action in v1.0; the report is
  read-only.
- `[ ]` S05-08 At 120 conflicts and at 1366×768, the report stays readable,
  the path column truncates in the middle, and the inspector shows the full
  path.

### S06 — Workshop (M3, visual pass M4)

- `[ ]` S06-01 Workshop uses 28px header and 40px rows with columns Title,
  Workshop ID (mono), State, Updated, Actions.
- `[ ]` S06-02 State chips use text + icon: `Subscribed`, `Installed`,
  `Update pending`, `Unknown`; update-pending uses a triangle + warning text.
- `[ ]` S06-03 Actions are Open page, Subscribe, Unsubscribe, Update; each goes
  through Steam and no custom credential form exists.
- `[ ]` S06-04 Update-pending and unknown states are not conveyed by colour
  alone and are explained in the inspector/tooltip.
- `[ ]` S06-05 Empty and Steam-unavailable states are inline, <=200px, and offer
  the available action (Open Steam / Retry).
- `[ ]` S06-06 At 500 subscriptions the list uses the same virtualization
  contract as the mod list and preserves scroll on action.
- `[ ]` S06-07 No Workshop action can remove or alter a local mod file without
  an explicit confirmation naming the item.

### S07 — Settings (M2, visual pass M4)

- `[ ]` S07-01 Settings content is max 720px wide, left-aligned, divided by 1px
  rules; no cards, tiles, or icon grid.
- `[ ]` S07-02 Labels, help text, and controls use the specified type roles;
  controls are 28px high and line up on the right edge.
- `[ ]` S07-03 Path fields validate inline, show the resolved path, and offer a
  folder picker; invalid paths cannot be saved.
- `[ ]` S07-04 Density offers Compact, Comfortable, Roomy and applies
  immediately (or on save with a clear dirty state).
- `[ ]` S07-05 Show authors and show thumbnails options change the list within
  one render and preserve scroll and selection.
- `[ ]` S07-06 Backup/restore load order and reset to defaults are present;
  reset requires a 480px confirmation with an explicit danger action.
- `[ ]` S07-07 Save is the toolbar primary; a clean state shows no dirty
  message; a failed save shows the AppError code/message and keeps edits.
- `[ ]` S07-08 At 1366×768 the form fits without horizontal scroll and the save
  action remains visible.

### S08 — First run and detection errors (M1, visual pass M4)

- `[ ]` S08-01 The first-run/game-found state is a top-aligned 560px column:
  22px title, one paragraph, path in mono, `Use this path` primary, `Choose
  another folder` secondary. No hero, no illustration.
- `[ ]` S08-02 The not-found state names the cause and offers folder picker +
  `Retry detection`; it is an inline state, not a modal error.
- `[ ]` S08-03 Steam-not-found is a distinct inline state with the same
  recovery controls; it does not claim the game is missing when only Steam is
  unreadable.
- `[ ]` S08-04 A corrupt config shows a 480px dialog with `Restore backup`
  primary, `Reset config` danger, and the config path; the config is never
  overwritten silently.
- `[ ]` S08-05 Manual path override validates before save and reports the
  AppError code/message if the directory is not a WH3 install.
- `[ ]` S08-06 The app starts and remains usable with no WH3 install; no crash,
  no spinner-forever, and no empty list that looks like a successful scan.

### S09 — Load-order write and recovery (M2, visual pass M4)

- `[ ]` S09-01 The pre-write dialog is 640px wide and lists target path, line
  count, skipped mods, backup path, and unmanaged directives that will be
  dropped.
- `[ ]` S09-02 The primary action is the explicit `Write load order`; it is
  danger-filled only when unmanaged directives will be dropped or the file
  would become empty. Cancel is the default focus and the consequence sentence
  is plain text.
- `[ ]` S09-03 A no-op write shows `Load order already current` in the status
  bar and opens no dialog.
- `[ ]` S09-04 A missing `used_mods.txt` with a `.bak` present shows an inline
  banner with `Restore backup` and `Dismiss`; no silent restore occurs.
- `[ ]` S09-05 A write failure shows the AppError code/message, states whether
  the original file is untouched, and keeps the previous load order in the UI.
- `[ ]` S09-06 After a successful write the status bar shows the time and line
  count; the dialog closes and focus returns to the write action.
- `[ ]` S09-07 No dialog or banner can be dismissed without either completing
  or explicitly cancelling the destructive action.

### S10 — Launch (M3, visual pass M4)

- `[ ]` S10-01 Launch opens a 480px dialog with `Skip intro`, `Enable script
  logging`, a one-line precondition, and `Launch game`.
- `[ ]` S10-02 If the game is already running, the dialog says so and disables
  launch; it does not silently kill or relaunch.
- `[ ]` S10-03 Launch failure shows the AppError message and the attempted
  method (`steam`/`direct`) without exposing a stack trace.
- `[ ]` S10-04 No Steam credentials, account UI, or custom auth flow exists.

### S11 — Loading, empty, and error states (M2/M3, visual pass M4)

- `[ ]` S11-01 Loading uses fixed-height placeholders at the active density,
  no shimmer, and `aria-busy`; the toolbar/header do not jump.
- `[ ]` S11-02 Every empty state is <=200px, has a title, one sentence, and one
  resolving action; none contains art or marketing copy.
- `[ ]` S11-03 Every error shown in a screen uses the AppError code, a short
  message, and a `Details` disclosure for diagnostics; `Retry` appears only for
  `retryable` errors.
- `[ ]` S11-04 Toasts are bottom-left, max 360px, icon + title + one line;
  errors persist until dismissed; no more than three are visible.
- `[ ]` S11-05 All error/loading/empty surfaces pass the contrast and
  not-colour-only checks in G-02/G-05.
- `[ ]` S11-06 No error path leaves the app in a state where the user cannot
  retry, change the path, or quit safely.

## Cross-cutting review checklist

- `[ ]` X-01 Every screen in this document has a screenshot at 1920×1080 and
  1366×768.
- `[ ]` X-02 The mod list has compact and roomy screenshots at 1920×1080.
- `[ ]` X-03 A full keyboard-only run (open, search, toggle, reorder, profile
  switch, write dialog cancel/confirm, settings save, close) passes at 1024×720.
- `[ ]` X-04 A grayscale pass of the main screens keeps enabled/disabled,
  selected, conflict, missing dependency, and update-pending distinguishable.
- `[ ]` X-05 The 20,000-mod DOM measurement is recorded with the tool/command
  used and meets G-11.
- `[ ]` X-06 `frontend/src/styles/tokens.test.ts` passes and remains the only
  token/contrast gate.
- `[ ]` X-07 No cut feature appears in navigation, menus, commands, or copy.
- `[ ]` X-08 The PR links WAR-10, lists the screens changed, and includes the
  verification evidence table below.

## Verification record

| Check | Command / evidence | Result |
|---|---|---|
| `pnpm typecheck` | | |
| `pnpm lint` | | |
| `pnpm test` | | |
| `pnpm build` | | |
| `tokens.test.ts` | | |
| 20k virtualization measurement | | |
| Keyboard-only run | | |
| Screenshot set | | |

## Sign-off

| Role | Name | Verdict | Date | Evidence |
|---|---|---|---|---|
| Implementation | Karl Franz | | | PR + screenshots |
| QA | Baltasar Gelt | | | checklist + test run |
| Performance (if changed) | Genny4Real | | | before/after numbers |
| Tech lead | Katerina Zarina | | | merge approval |

A screen is `done` only when every global gate and every item in its section is
checked with evidence, the suite is green, and QA and tech lead have signed.
