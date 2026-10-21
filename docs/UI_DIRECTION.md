# UI direction — WH3 Mod Manager v1.0

- Status: accepted for M2/M4
- Owner: Katerina Zarina
- Date: 2026-10-21
- Product contract: `docs/PRODUCT_SCOPE.md`
- Architecture: `docs/adr/001-architecture.md`, `docs/adr/002-ipc-contract.md`,
  `docs/adr/003-data-model.md`, `docs/adr/006-ui-tokens-and-density.md`
- Token source: `frontend/src/styles/tokens.css`
- Screen checklist: `docs/UI_ACCEPTANCE.md`
- Legacy reference (read-only): `docs/DESIGN.md` in
  `Shazbot/WH3-Mod-Manager`

This document is normative. `MUST`, `MUST NOT`, and `SHOULD` are requirements
for M2 and M4 implementation and for design review. Where this document and the
legacy design disagree, this document wins; where this document and the product
scope disagree, the product scope wins.

## 1. Design intent

The app is a **dense desktop instrument for managing one game's mods**. It is
not a dashboard, a storefront, or a game menu.

Three rules decide every visual question:

1. **The mod list is the product.** Chrome recedes; the list gets the pixels.
   Every pixel spent on framing is a row the user cannot see.
2. **TW:WH3 is a material language, not a decoration budget.** Dark iron and
   charcoal surfaces, parchment text, brass rules, square heraldic accents, and
   a serif display face for titles. No art, no textures, no glow, no gradients.
3. **State is explicit.** Enabled, selected, conflicting, missing a dependency,
   loading, empty, and failed are each expressed with at least two channels:
   shape/icon + text + colour, in that order of importance.

### What the legacy design contributes

Keep:

- the dense, virtualized list and its row-height discipline;
- the persistent left rail and fixed title strip;
- keyboard-first operation, multi-select, context menus, and stable scroll;
- text-first scanning with muted secondary metadata;
- explicit warning and destructive surfaces.

Drop:

- gradients, glow, hero panels, and decorative panel corners;
- cards-for-rows and dashboard tiles;
- oversized empty states and promotional copy;
- Flowbite, FontAwesome, and mixed icon families;
- the blue system accent; this product uses brass for interaction and faction
  accents only for identity.

### Visual references, in order

1. TW:WH3 campaign UI: iron frames, parchment readability, heraldic accents
   used sparingly.
2. A professional desktop tool: precise alignment, 1px rules, tabular numbers,
   no ornamental motion.
3. The legacy mod list: density and interaction behaviour, not its skin.

## 2. Design tokens

`frontend/src/styles/tokens.css` is the single source of truth. Components
MUST consume semantic tokens (`--color-*`, `--text-*`, `--space-*`, `--row-*`,
`--control-*`, `--radius-*`, `--shadow-*`, `--z-*`, `--motion-*`,
`--faction-*`) and MUST NOT read raw palette tokens (`--iron-*`,
`--parchment-*`, `--brass-*`, `--signal-*`) or hard-code colours.

### 2.1 Colour

#### Surfaces

| Token | Value | Use |
|---|---|---|
| `--color-bg-app` | `#0f1215` | App and list background |
| `--color-bg-rail` | `#14181c` | Title strip, left rail, status bar |
| `--color-bg-content` | `#0f1215` | Main pane behind lists |
| `--color-bg-surface` | `#191e23` | Panels, inspector, list header, menus |
| `--color-bg-surface-raised` | `#1f252b` | Hovered controls, tag background |
| `--color-bg-row` | `#0f1215` | Mod/table row |
| `--color-bg-row-alt` | `#14181c` | Alternating row, if used |
| `--color-bg-row-hover` | `#20262c` | Pointer hover |
| `--color-bg-row-selected` | `#262d34` | Selected row |
| `--color-bg-row-dragging` | `#1f252b` | Source row during drag |
| `--color-bg-list-header` | `#191e23` | Column header |
| `--color-bg-toolbar` | `#14181c` | Toolbar, filter bar |
| `--color-bg-inspector` | `#14181c` | Inspector sidebar |
| `--color-bg-input` | `#0a0c0e` | Text input, search field |
| `--color-bg-menu` | `#191e23` | Context menu, dropdown |
| `--color-bg-dialog` | `#191e23` | Dialog surface |
| `--color-bg-tooltip` | `#e8dcc4` | Parchment tooltip |
| `--color-bg-overlay` | `rgb(5 7 9 / 0.72)` | Modal backdrop |

State fills: `--color-state-success-bg` `#1c2418`,
`--color-state-warning-bg` `#2a2318`, `--color-state-danger-bg` `#2a1c19`,
`--color-state-info-bg` `#18242b`. State icons use
`--color-state-success`, `--color-state-warning`, `--color-state-danger`, and
`--color-state-info`.

#### Text

| Token | Value | Minimum contrast |
|---|---|---|
| `--color-text-primary` | `#e8dcc4` | 13.84:1 on app, 12.36:1 on surface |
| `--color-text-secondary` | `#d6c8ac` | 11.38:1 on app, 10.16:1 on surface |
| `--color-text-muted` | `#a59a83` | 6.76:1 on app, 6.03:1 on surface, 5.01:1 on selected row |
| `--color-text-disabled` | `#948a76` | 4.92:1 on surface; inactive controls only |
| `--color-text-inverse` | `#1a1408` | On brass/parchment fills |
| `--color-text-accent` | `#d7b45f` | 9.47:1 on app |
| `--color-text-link` | `#d7b45f` | Same as accent; underline on hover |
| `--color-text-success` | `#a3c178` | 7.95:1 on success fill |
| `--color-text-warning` | `#e0b45c` | 8.03:1 on warning fill |
| `--color-text-danger` | `#e07a63` | 5.58:1 on danger fill, 5.70:1 on surface |
| `--color-text-info` | `#7fb0d0` | 6.80:1 on info fill |

Disabled row text uses `--color-text-muted`, not `--color-text-disabled`:
disabling a mod must not make its name unreadable. The empty checkbox and the
inspector status carry the disabled meaning.

#### Borders and actions

| Token | Value | Use |
|---|---|---|
| `--color-border-subtle` | `#252c33` | Row separators, section rules |
| `--color-border-default` | `#2d353d` | Panel, rail, toolbar edges |
| `--color-border-strong` | `#39424c` | Menus, dialogs, tag edges |
| `--color-border-control` | `#66717e` | Input/select/button boundary (>=3:1) |
| `--color-border-accent` | `#9a7a32` | Brass frame detail |
| `--color-border-focus` | `#d7b45f` | Focus ring |
| `--color-border-selected` | `#c9a24d` | Selected-row left rule |
| `--color-border-success` / `warning` / `danger` | signal colours | State boundaries |

`--color-action-primary-bg` `#c9a24d` with `--color-action-primary-text`
`#1a1408` (7.63:1); hover `#d7b45f`. `--color-action-secondary-bg` is
transparent with `--color-border-control`; hover `#1f252b`.
`--color-action-danger-bg` `#7f2a21` with `#f6efe0` (8.13:1); hover `#8f2d21`.
Disabled actions use `--color-action-disabled-text` and a strong border; never
opacity below 0.72.

#### Faction accents

Faction/race identity is content. Accent colour is never the only label.

| Slot | Token | Value | Suggested identity |
|---|---|---|---|
| Brass | `--faction-accent-brass` | `#d7b45f` | Empire, neutral, default |
| Crimson | `--faction-accent-crimson` | `#e37b84` | Vampire Counts |
| Moss | `--faction-accent-moss` | `#9bb86a` | Greenskins |
| Copper | `--faction-accent-copper` | `#d09055` | Dwarfs |
| Azure | `--faction-accent-azure` | `#7fb0d0` | High Elves |
| Violet | `--faction-accent-violet` | `#b08cc8` | Dark Elves |
| Ember | `--faction-accent-ember` | `#e07a63` | Chaos |
| Jade | `--faction-accent-jade` | `#6fbf9e` | Lizardmen |

All eight accents are >=4.5:1 on `--color-bg-app` and
`--color-bg-row-selected`, so they may be used for tag text when the tag is a
faction tag. They are still never the only signal.

### 2.2 Typography

System fonts only; no web-font downloads and no external assets.

| Token | Stack |
|---|---|
| `--font-display` | `'Palatino Linotype', 'Book Antiqua', Palatino, 'URW Palladio L', Georgia, serif` |
| `--font-body` | `'Segoe UI Variable Text', 'Segoe UI', 'Noto Sans', system-ui, sans-serif` |
| `--font-mono` | `'Cascadia Mono', 'Cascadia Code', Consolas, 'DejaVu Sans Mono', monospace` |

| Role | Size / line | Weight | Use |
|---|---|---|---|
| App title | 16 / 19 | 400 display | Title strip only |
| Screen title | 22 / 26 | 400 display | One per screen, e.g. "Mods" |
| Section title | 16–18 / 20 | 400 display | Dialog title, inspector heading |
| Row title | 13 / 16 | 500 body | Mod name, profile name |
| Body | 13 / 18 | 400 body | Paragraphs, help text |
| Meta | 11 / 14 | 400 body | Pack name, timestamps |
| Label | 11 / 14 | 600 body, uppercase, `0.08em` | Column headers, section labels |
| Data | 12 / 16 | 400 mono, tabular | Order numbers, counts, paths, shortcuts |
| Micro | 11 / 14 | 400 body | Status bar, badge text; never smaller |

Rules:

- Use tabular numerals for order numbers, counts, dates, and sizes.
- No text below 11px. No letterspacing on body text.
- Truncate with a single-line ellipsis, never with a font-size reduction.
- Do not use the display serif inside rows, tables, buttons, or metadata.
- Line height and size are fixed per role; do not tune per component.

### 2.3 Spacing and density

4px grid: `--space-1` 2px, `--space-2` 4px, `--space-3` 6px, `--space-4` 8px,
`--space-5` 10px, `--space-6` 12px, `--space-7` 16px, `--space-8` 20px,
`--space-9` 24px, `--space-10` 32px, `--space-11` 40px, `--space-12` 48px.
The 2px step exists for borders and optical alignment, not for general layout.

| Density | Row height | Thumb | Row pad | Title | Meta | Visible rows @1080p | @768p |
|---|---:|---:|---:|---|---|---:|---:|
| Compact | 32px | 24px | 8px | 12/16 | 11/14 | 29 | 19 |
| Comfortable (default) | 40px | 32px | 10px | 13/16 | 11/14 | 23 | 15 |
| Roomy | 48px | 40px | 12px | 14/18 | 12/16 | 19 | 13 |

The visible-row counts use a 1920×1080 or 1366×768 viewport, the shell heights
below, and no banner:

```
list viewport = viewport height - title strip 40 - status bar 24
                - toolbar 40 - list header 28
              = 948px @1080p, 636px @768p
visible rows = floor(list viewport / row height)
```

Rows include their 1px bottom border in the height. If a banner or inline
warning is present, subtract its measured height before counting. Density is
set with `data-density="compact|comfortable|roomy"` on `<html>`; comfortable is
the default and the persisted fallback.

### 2.4 Geometry

| Token | Value | Use |
|---|---:|---|
| `--titlebar-h` | 40px | Title strip |
| `--statusbar-h` | 24px | Status bar |
| `--toolbar-h` | 40px | Toolbar/filter row |
| `--list-header-h` | 28px | Column header |
| `--rail-w` | 208px | Left rail |
| `--inspector-w` | 320px | Inspector docked width |
| `--inspector-w-narrow` | 300px | Inspector docked width at 1280–1439px |
| `--inspector-min-w` / `max-w` | 280 / 420px | Resize bounds (M4) |
| `--control-h-sm` | 24px | Chips, small icon buttons |
| `--control-h-md` | 28px | Inputs, buttons, selects |
| `--control-h-lg` | 32px | Rail items, primary buttons in dialogs |
| `--row-order-w` | 36px | Order number/drag handle |
| `--row-check-w` | 32px | Enable checkbox |
| `--row-tags-w` | 132px | Tag column |
| `--row-status-w` | 28px | Conflict/dependency icon |
| `--row-menu-w` | 28px | Row menu |
| `--dialog-w-sm/md/lg` | 480 / 640 / 880px | Confirmation / form / wide |
| `--menu-min-w` | 200px | Context menu |
| `--tooltip-max-w` | 360px | Tooltip |

Minimum window: **1024×720** logical pixels (Tauri config). At that size the
app still shows the rail, toolbar, list, and overlay inspector with no
horizontal page scroll. Below 1024×720 is unsupported; do not design a mobile
layout.

### 2.5 Borders, radius, elevation

- 1px hairlines do the structural work. No double borders.
- Radii: 0 for row rules and separators; 2px for controls, chips, tags; 3px for
  panels and the inspector; 4px for dialogs. No pill shapes; status indicators
  are square/diamond and the scrollbar thumb is 2px.
- Shadows are functional only: menus (`--shadow-menu`), dialogs
  (`--shadow-dialog`), drag ghost (`--shadow-drag`). Nothing else casts a
  shadow.
- No gradients, no glow, no blur, no backdrop-filter, no inner shadows, no
  bevels, no ornamental corner marks.
- CSS-only texture is permitted only as a 1px rule pattern at no more than 3%
  contrast. The v1.0 default is flat fills; prefer no texture.

### 2.6 Motion

- `--motion-fast` 80ms for hover/focus colour changes.
- `--motion-base` 140ms for menus, tooltips, and disclosure.
- `--motion-reorder` 220ms for the local reorder confirmation.
- `--ease-standard` `cubic-bezier(0.2, 0.7, 0.3, 1)`.
- No animation on list rows except the one reorder confirmation; no skeleton
  shimmer; no page transitions.
- `prefers-reduced-motion: reduce` sets all durations to 0.01ms and disables
  smooth scrolling. The reorder result is still announced in text.

### 2.7 Stacking

`--z-rail` 20, `--z-titlebar` 30, `--z-toolbar` 40, `--z-menu` 60,
`--z-dialog` 80, `--z-toast` 90, `--z-tooltip` 100. Do not invent z-index
values in components. Tooltips sit above dialogs only because they are
non-interactive overlays; a tooltip inside a dialog uses the same layer.

## 3. Shell

```
┌ title strip 40 ──────────────────────────────────────────────────────────┐
│ [III] WARHAMMER III MOD MANAGER   [Default profile ▾]  ◆ Game found  ⚙  │
├ rail 208 ┬ main pane (flex) ───────────────────────────────┬ inspector 320 ┤
│ MODS     │ toolbar 40 (search, filters, sort, density, …)  │ Selected mod  │
│ Profiles │ column header 28                               │ metadata      │
│ Conflicts│ row 32 / 40 / 48                               │ dependencies  │
│ Workshop │ …                                              │ conflicts     │
│ Settings │                                                │ actions       │
├──────────┴────────────────────────────────────────────────┴───────────────┤
│ status bar 24: Ready · 142 mods · 98 enabled        Load order saved 12:40 │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Title strip (40px)

- Left: 28×28 brass-framed sigil, `TOTAL WAR` kicker (11px label), app name
  (16px display). The sigil is the only decorative element allowed in the
  shell.
- Centre: profile selector, 28px high, label `Profile` + current name. This is
  the only place the active profile is switched from outside the Profiles
  screen.
- Right: game status (`◆ Game found` / `◇ Set game path`), settings icon button,
  window controls provided by the OS. Do not draw fake window buttons.
- Background `--color-bg-rail`, bottom border default. No gradient.

### 3.2 Left rail (208px)

Sections, in order: **Mods** (`Ctrl+1`), **Profiles** (`Ctrl+2`),
**Conflicts** (`Ctrl+3`), **Workshop** (`Ctrl+4`), **Settings** (`Ctrl+5`).
Group labels: `COLLECTION` above Mods/Profiles/Conflicts, `GAME` above
Workshop/Settings.

- Item height 32px, icon 16px inline SVG, label 13px, 10px horizontal padding.
- Idle: transparent, secondary text. Hover: surface raised, primary text.
- Active: surface fill, 2px brass left rule, primary text, medium weight.
- Focus: the global focus ring, inset by 2px.
- Planned/unavailable sections are not rendered at v1.0. During M2/M3 a section
  that is not yet implemented may render disabled with the text `Not available
  yet`; it must not be an empty clickable target.
- No section may be added that is not in the product scope. No viewer, pack
  editor, unit viewer, map, or collection-import entries.

### 3.3 Main pane and toolbar

- Main pane fills the space between rail, inspector, title strip, and status
  bar. It does not scroll; the list inside it owns vertical scrolling.
- Toolbar: 40px, 12px horizontal padding, `--color-bg-toolbar`, bottom border
  subtle. Groups are separated by a 16px-high 1px vertical rule.
- Group 1: search field, 280px preferred (200–360px), 28px high, magnifier icon
  14px, `Ctrl+F` hint on the right.
- Group 2: active filter chips (24px, tag accent 2px left, label 11px, remove
  button 16px) and `Clear filters` text button.
- Group 3: sort select (28px) with a visible label (`Sort: Name A–Z`), density
  select (`Density: Comfortable`), column visibility menu.
- Group 4 (right): primary `Apply load order` button (28px, brass, dark text)
  and overflow menu. The primary action is disabled when the order is clean;
  disabled state uses text + border, not opacity alone.
- No hero header, no subtitle paragraph, no stats tiles. The screen title is in
  the pane heading, 22px display, with a count in mono (`142 mods`).

### 3.4 List header (28px)

One grid row shared with the data rows. Labels are 11px uppercase, muted,
letterspacing 0.08em. Sortable columns show a 10px triangle arrow next to the
label and expose `aria-sort`. The header does not scroll horizontally; there is
no horizontal scroll. Column visibility is controlled from the toolbar menu;
the order and enable columns are always visible.

### 3.5 Inspector (320px)

- Docked on the right at >=1280px wide; `--inspector-w` (320px), or
  `--inspector-w-narrow` (300px) at 1280–1439. Overlay drawer at <1280px,
  opened by `Enter` on a row or the row menu. Closed by `Escape` or the close
  button.
- Header 36px: `Inspector` label + close 24px button. Body scrolls
  independently, 12–16px padding. Footer 44px for actions.
- Sections are separated by 1px rules, not cards. Section labels use the label
  role; values use body/mono. Paths wrap with `overflow-wrap: anywhere`, are
  selectable, and have a copy button.
- Content: name, pack file, source (local/Workshop + workshop id), updated,
  tags, dependencies (present/missing), conflicts (wins/loses), enabled state,
  load-order position.
- Empty: one 12px muted line, `Select a mod to inspect.` at the top of the
  body. No illustration, no large empty block.
- Multi-select: `N mods selected` and only bulk actions that exist (enable,
  disable, move to top, move to bottom). No multi-mod metadata soup.

### 3.6 Status bar (24px)

Left: readiness and counts (`Ready · 142 mods · 98 enabled`) or the active
operation (`Scanning Workshop…`). Right: last write result and time
(`Load order saved 12:40` or `Unsaved changes`). Text only; status colour may
accent an icon, never carry the meaning alone. It never grows to more than one
line and never scrolls.

### 3.7 Dialogs

- Width 480px (confirm), 640px (form), 880px (wide detail); max height
  `calc(100vh - 96px)`; centered; overlay `--color-bg-overlay`.
- Header 44px, title 18px display, close button 28px. Body scrolls; 16px
  padding. Footer 56px with buttons right-aligned, 8px gap; cancel is
  secondary, the safe action is focused first.
- Destructive dialogs: danger-filled button with an explicit verb (`Delete
  profile`, `Write load order`), a plain-language consequence sentence, and
  cancel as the default focus.
- Focus is trapped; `Escape` cancels; focus returns to the trigger.
- No dialog for a non-blocking success. Use a status bar message or a toast.
- A dialog may not contain a second scrollable region; if the content is long,
  the body scrolls.

### 3.8 Menus, tooltips, toasts

- Menus: 200px min, 28px items, 8px horizontal padding, icon 14px, shortcut
  right-aligned in mono 11px, 1px separators. Destructive items last, danger
  text. Shadow menu; no arrow.
- Tooltips: parchment surface, inverse text, 1px brass-600 border, 11/14,
  max 360px and 3 lines, 500ms delay, 8px offset. Tooltips explain truncation
  or icon-only controls; they never contain the only copy of a warning.
- Toasts: bottom-left, 16px inset, max 360px, surface-raised, 1px border,
  status icon + title + one line. Success auto-dismisses after 4s; errors stay
  until dismissed. No glow, no stacking more than three; older toasts collapse.

### 3.9 Responsive and resize behaviour

| Width | Inspector | Tags |
|---|---|---|
| >=1440px | Docked 320px | Column, 132px |
| 1280–1439px | Docked 300px | Column, 132px |
| 1100–1279px | Overlay 320px | Column, 132px |
| 1024–1099px | Overlay 320px | Inline in the name cell |

No horizontal page scroll at any width >=1024px. The name column has a 180px
minimum and absorbs all remaining width. The rail never collapses to icons at
v1.0; 208px is affordable at 1024px.

## 4. Mod list

### 4.1 Row anatomy

Column template (comfortable/roomy, >=1440px):

```css
grid-template-columns:
  var(--row-order-w) var(--row-check-w) var(--row-thumb)
  minmax(180px, 1fr) var(--row-tags-w)
  var(--row-status-w) var(--row-menu-w);
column-gap: var(--space-4);
padding-inline: var(--row-pad-x);
```

Below 1100px drop `--row-tags-w` and render tags inline in the name cell. The
header uses the same template at every breakpoint.

| Cell | Width | Content |
|---|---:|---|
| Order | 36px | 1-based number, mono 12, right-aligned, tabular. Doubles as the drag handle. |
| Enable | 32px | 16px checkbox in a full-height 32px hit area. |
| Thumb | row thumb | Square, `object-fit: cover`, 1px border subtle. If missing, 2-letter pack-type abbreviation in mono 10, muted. Collapses when thumbnails are disabled. |
| Name | >=180px, 1fr | Title 13/16 medium; meta 11/14 muted on a second line: pack filename. Single-line ellipsis on both. |
| Tags | 132px | Up to 2 chips, 20px high, 2px faction accent on the left, 11px label; `+N` for the rest. |
| Status | 28px | Conflict diamond, missing-dependency triangle, or both. Accessible label is mandatory. |
| Menu | 28px | 24px overflow button, always visible but muted until hover/focus. |

The header uses exactly the same template and gap. The row is 1px bottom border
`--color-border-subtle`; no card, no margin between rows, no rounded row.

### 4.2 Row behaviour

- Single click selects; `Ctrl`/`Cmd` toggles selection; `Shift` extends a
  range. Selection never toggles a mod.
- Clicking the checkbox toggles enabled state and does not change selection.
- `Space` toggles the focused row; `Enter` opens the inspector.
- Double-click is not required for any action.
- The row context menu opens at the pointer, or at the row's menu button when
  invoked by keyboard.
- Toggling or reordering preserves the scroll offset.
- Hover only changes the background and reveals the drag affordance; it does
  not move content.
- The last row's border is suppressed so the list does not end with a double
  rule.

### 4.3 States

| State | Visual treatment | Non-colour channel |
|---|---|---|
| Enabled | Checked checkbox, brass fill with dark check; title primary; order normally weighted. | Checked shape + `aria-checked`. |
| Disabled | Empty checkbox; title muted; order muted. No opacity. | Empty shape + `aria-checked=false`; inspector says `Disabled`. |
| Selected | `--color-bg-row-selected`, 2px brass left rule, title primary. | Rule position + `aria-selected`. |
| Hover | `--color-bg-row-hover`; no border change. | Pointer cursor only on controls; row cursor default. |
| Focused | 2px brass outline inset 2px, independent of selected. | Ring + `:focus-visible`. |
| Conflict | 12px outlined diamond in the status cell, danger colour, accessible label `Conflict`. | Diamond shape + inspector text `Conflict: wins/loses`. |
| Missing dependency | 12px outlined triangle, warning colour, label `Missing dependency`. | Triangle shape + inspector list. |
| Conflict + missing | Diamond with a 4px amber corner marker; label names both. | Shape combination + inspector text. |
| Dragging | Source row `--color-bg-row-dragging`, 1px dashed border control; 320px ghost with title + shadow-drag. | Insertion line at target; cursor. |
| Drop target | 2px brass insertion line across the row width at the insertion point; no row reflow. | Line position + live-region announcement. |
| Loading | 6 static placeholder rows at the active density; no shimmer; list `aria-busy`. | Toolbar/status text `Scanning mods…`. |
| Empty | Inline block, max 200px high, aligned to the content edge. | Title + sentence + action. |
| Error | 48px inline banner above the list: code, message, `Details` disclosure, `Retry`. | Icon + text; not a toast. |

Reorder confirmation: a 220ms background flash on the moved row plus a live
region announcement (`Moved <name> to position <n>`). Under reduced motion the
flash is removed; the announcement remains.

### 4.4 Empty, loading, error

- Empty state: 200px maximum height; title 16px display, one sentence 13px
  secondary, one primary action 28px. No illustration, no marketing copy, no
  centred hero. For no mods found: `No mods found` / `Set the game path or
  rescan to look again.` / `Set game path`.
- Loading: keep the toolbar and header stable; render placeholders at the exact
  active row height. Never show a full-window spinner.
- Error: one banner per failure, above the list. `Retry` only when
  `error.retryable` is true. A corrupt config or `used_mods.txt` gets a dialog
  because it requires a choice, not a banner.
- Never cover the list with a modal for a recoverable read failure.

### 4.5 Search, filters, tags

- Search is live, case-insensitive substring over human name and pack name.
  Debounce 120ms. It never reorders rows by itself; it filters.
- Filter chips are additive (AND across types, OR within tags). Active chips
  are visible in the toolbar; overflow collapses into `+N filters`.
- Tag chips use the faction accent slot only as a 2px left rule. The tag name
  is always visible; colour is never the only identity.
- Sort: Name A–Z, Updated newest, Load order. The active sort is shown in the
  toolbar, not hidden in a menu-only state.
- No filter may remove the header or the toolbar. The empty result state must
  fit in 200px and keep `Clear filters` visible.

### 4.6 Virtualization contract

- The list is virtualized with fixed row heights from the density tokens.
  Rows are never measured per render.
- At 20,000 mods the DOM contains at most `visible rows + 20` row elements
  (overscan 10 each side), and at most 60 total row-like nodes.
- Category/group headers, inline banners, and empty states are measured and
  reported into the virtualizer; they must not overlap rows.
- CSS transitions or animations must not run per row. Hover and selection are
  plain background/rules, not layout.

## 5. Screen-specific visual rules

These are visual rules; the pass/fail checklist is in
`docs/UI_ACCEPTANCE.md`.

### 5.1 Profiles

- Same shell and toolbar. Screen title `Profiles`, count `4 profiles`.
- Dense table: 40px rows, columns `Active` 64px, `Name` min 220px,
  `Mods` 72px right-aligned, `Updated` 160px, `Actions` 120px. Header 28px.
- Active profile: 2px brass left rule + `Active` text chip. No filled row card.
- Toolbar actions: `New profile`, `Rename`, `Duplicate`, `Delete`, `Apply`.
  Destructive actions are disabled unless exactly one profile row is selected.
- No thumbnails, no per-profile cards, no preview images.

### 5.2 Conflict report

- Single list of conflict groups, 40px rows, columns `Path` min 260px,
  `Winner` 200px, `Losers` 72px, `Type` 100px.
- Header toolbar: filter `All`, `Conflicts`, `Missing dependencies`,
  `Duplicate names`; count summary in mono.
- The winner cell says `Wins` in text with a small check; losers are listed
  inline when expanded (28px sub-rows) and in the inspector. Never a card per
  conflict.
- Empty: `No conflicts across 98 enabled mods.` plus `Rescan`.
- The report is read-only in v1.0; no fix/merge actions.

### 5.3 Workshop

- Same list density as mods; columns `Title` min 240px, `Workshop ID` 120px
  mono, `State` 120px, `Updated` 140px, `Actions` 120px.
- State is a text chip + icon: `Subscribed`, `Installed`, `Update pending`,
  `Unknown`. Update-pending uses warning colour and a triangle; subscribed is
  not green (avoid implying enabled state).
- Actions are `Open page`, `Subscribe`, `Unsubscribe`, `Update`. All go through
  the Steam client; the UI never asks for credentials and never shows a custom
  auth form.

### 5.4 Settings

- Main column max 720px, left-aligned; sections separated by 1px rules, not
  cards. Section title 16px display; setting label 13px medium; help 11px
  muted; control 28px.
- Rows: label/description left, control right, 40–56px tall. Path inputs can
  wrap and are validated inline.
- Save bar is the toolbar primary (`Save settings`); dirty state shows
  `Unsaved changes` in the status bar, not a red banner.
- Reset to defaults is a danger-outline button and requires confirmation.
- No dashboard tiles, no icon grid, no toggle cards. Toggles are checkboxes or
  compact switches with text labels.

### 5.5 First run and detection failure

- A single 560px column in the main pane, top-aligned at 48px, no hero.
- App title 22px display; one paragraph; one primary action.
- Found state: path in mono, `Use this path` primary, `Choose another folder`
  secondary. Not-found state: short cause, folder picker, `Retry detection`.
- Steam not found and game not found are inline states, not modal errors.
- Corrupt config: dialog with `Restore backup` (primary) and `Reset config`
  (danger), plus the config path in mono; never overwrite silently.

### 5.6 Load-order write and recovery

- Pre-write dialog 640px: target path, number of lines to write, skipped mods,
  backup path, and any unmanaged directives that will be dropped. The primary
  button is `Write load order`. It is brass for a safe write and danger-filled
  only when unmanaged directives will be dropped or the file would become
  empty.
- If nothing would change, no dialog; the status bar says `Load order already
  current`.
- Recovery state when `used_mods.txt` is missing and `.bak` exists: inline
  banner in the mod list with `Restore backup` and `Dismiss`; no silent restore.
- Errors show the `AppError` code and message; `details` is behind a disclosure.

### 5.7 Launch

- Launch is a toolbar/title-strip action that opens a 480px dialog, not a
  screen.
- Dialog: two checkboxes (`Skip intro`, `Enable script logging`), a one-line
  precondition (`Game is not running` / warning if it is), and `Launch game`.
- No launcher settings that are not in the product scope. No Steam auth UI.

## 6. Faction framing

Faction and race identity must help scanning, not slow it down.

Rules:

1. **Label first.** Every faction tag shows its full name (or the user's tag
   name). The accent is a 2px rule or a 6px diamond, never a background wash.
2. **One accent per row.** If a row has several tags, only the first faction tag
   contributes its accent to the row. Other tags keep neutral chips. Do not
   tint the row, checkbox, order number, or borders.
3. **Header framing is a clue, not a theme.** When exactly one faction tag
   filter is active, the screen title gets a 2px accent rule and a 12px
   diamond, and the title reads `Mods · <Tag>`. With no faction filter, the
   rule is brass. The accent may occupy at most 2×160px in the header.
4. **Palette, not heraldry.** Use the eight accent slots only. Do not add race
   crests, insignia, or artwork without a licensed asset and a new decision.
   The product ships with no external art.
5. **Stable assignment.** A tag keeps its accent across sessions. Suggested
   mappings are in §2.1; user-created tags choose from the eight slots. If a
   stored tag colour is outside the palette, the UI uses the nearest slot for
   the rule and keeps the tag text neutral.
6. **No semantic collision.** Faction accents never mean enabled, selected,
   success, warning, or error. Those states use the semantic state tokens and
   their own icon shapes.
7. **Scan speed checks.** At 1080p with 50 rows visible, no row may contain
   more than two chips; the name column must remain the widest element; a
   grayscale screenshot must still distinguish enabled, disabled, selected,
   conflict, and missing-dependency rows.

## 7. Keyboard and focus

### 7.1 Global

| Key | Action |
|---|---|
| `Ctrl+1` … `Ctrl+5` | Mods, Profiles, Conflicts, Workshop, Settings |
| `Ctrl+F` | Focus the search field and select its text |
| `F5` | Rescan mods and Workshop metadata |
| `F6` / `Shift+F6` | Cycle focus between rail, toolbar, list, inspector |
| `Escape` | Close menu/dialog/tooltip, cancel drag, clear search when search is focused |
| `Ctrl+,` | Settings (optional alias for `Ctrl+5`) |

Shortcuts do not fire while typing in an input, except `Escape`, `Ctrl+F`, and
the section shortcuts.

### 7.2 Mod list

| Key | Action |
|---|---|
| `Up` / `Down` | Move the focused row |
| `Shift+Up` / `Shift+Down` | Extend selection |
| `Ctrl+A` | Select all visible rows |
| `Home` / `End` | First/last row |
| `PageUp` / `PageDown` | Move by one visible page minus one row |
| `Space` | Toggle enabled state of the focused row(s) |
| `Enter` | Open the inspector for the focused row |
| `Alt+Up` / `Alt+Down` | Move selected rows one position |
| `Alt+Home` / `Alt+End` | Move selected rows to top/bottom |
| `Shift+F10` or Menu key | Open the row context menu |
| `Escape` | Close the context menu, cancel drag |

Reorder is immediate; it is announced through a polite live region
(`Moved <name> to position <n>`). Pointer drag shows an insertion line and
commits on drop; `Escape` cancels. Do not require a placement mode to use the
keyboard.

### 7.3 Focus rules

- Focus is always visible: 2px `--color-border-focus`, 2px offset; on rows the
  outline is inset 2px so it is not clipped.
- `:focus-visible` only; pointer clicks do not draw the ring.
- Selected and focused are distinct: selected uses the left rule and
  background; focused uses the ring. Both can be present.
- Focus order within a row: row -> checkbox -> menu button; `Tab` leaves the
  list, `F6` moves between regions.
- Dialogs trap focus. Menus use roving focus and arrow keys. Tooltips never
  take focus.
- After route/section change, focus moves to the screen title (`tabindex=-1`)
  and the title is announced.
- Nothing may use `outline: none` without an equivalent visible replacement.
- `prefers-contrast: more` may increase border and text contrast; it must not
  change layout.

## 8. Anti-patterns

The following are review failures:

1. Cards for rows, cards for settings, or a card per conflict.
2. Hero panels, marketing copy, taglines, or onboarding illustrations.
3. Gradients, glow, blur, backdrop-filter, bevels, or ornamental corners.
4. Dashboard tiles, KPI strips, sparklines, or decorative charts.
5. Empty states taller than 200px, or empty states with art.
6. Pill-shaped buttons or pills as row containers.
7. Colour as the only state signal, or opacity as the only disabled signal.
8. Blue/cyan system accents, neon focus rings, or category colours used for
   state.
9. Icon-only controls without an accessible name and tooltip.
10. Row hover that reflows content, lifts the row, or animates per row.
11. Full-DOM rendering of large mod lists or per-row measurement in render.
12. Horizontal page scrolling at or above 1024px.
13. Hiding persistent navigation at desktop widths to imitate mobile.
14. Fake window controls, custom OS chrome, or an in-app title bar with
    minimise/maximise buttons.
15. External art, fonts, icon packs, or assets with unclear licensing.
16. Adding navigation or menus for cut features (viewers, editors, other
    games).
17. A second component library, second icon family, or CSS-in-JS theme.
18. Motion that is not a state change, or unguarded animation for
    reduced-motion users.

## 9. Implementation contract

- `tokens.css` is imported by `theme.css`; `main.tsx` imports `theme.css`.
  Components may import only `theme.css` (or future component stylesheets that
  themselves consume tokens).
- No raw hex, `rgb()`, `hsl()`, font stacks, or magic values for spacing, row
  heights, shell geometry, or type sizes in component styles or inline styles,
  except data-driven faction accent values assigned to `--faction-accent` and
  optical details such as 1px rules, icon and dot sizes, and uppercase label
  tracking.
- Density is read from `data-density` on `<html>`; do not duplicate row heights
  in component CSS.
- Row grids are defined once per breakpoint and shared by header and rows.
  Header and row MUST use the same template.
- No CSS texture or image is required. If one is added, it must be a CSS-only
  1px pattern at <=3% contrast, with no animation.
- Every new component state must map to an existing semantic token. If it
  cannot, propose a token change in review; do not invent a local value.
- Token changes that alter meaning or contrast require an update to this
  document, `docs/UI_ACCEPTANCE.md`, ADR-006 when the contract changes, and a
  passing `tokens.test.ts`.
- `frontend/src/styles/tokens.test.ts` enforces token presence, contrast,
  density order, and the no-gradient/no-external-asset rules. It is part of the
  PR gate.
- Screenshots for M4 live in `docs/screenshots/` and are evidence, not design
  sources; do not ship them in the app bundle unless a task explicitly asks.

## 10. Open decisions

None for v1.0. Two items are deliberately deferred and must not be invented by
implementation:

- Custom accent colours beyond the eight slots (needs a product decision).
- A light theme (out of scope for v1.0; the app is dark-only).
