# WAR-147 — TW:WH3 UI fidelity pass evidence

- Issue: WAR-147 (`60d73306-80b3-4d45-a4af-6ebee00ba475`)
- Branch: `feat/war-147-ui-fidelity`
- Base: `main` @ `1747c64`
- PR: #59 (https://github.com/mak8427/Warhammer_mod_manager/pull/59)
- Merged SHA: pending

## What changed

The shell now uses the TW:WH3 material language observed in the reference
session: warm wine-dark stone, parchment text, brass frames and banner plates,
serif small caps, and one drawn corner stud. The change is CSS plus
`data-faction` attributes; no layout, state, IPC, virtualization, or keyboard
code changed.

- `frontend/src/styles/tokens.css`: palette primitives retuned to
  `--obsidian-*` and `--wine-*`; new banner/frame/tab/bevel/ornament tokens;
  contrast pairs recomputed.
- `frontend/src/styles/theme.css`: fidelity skin for the title strip, rail,
  screen banners, toolbar, buttons, inputs, list header, rows, inspector,
  dialogs, menus, tabs, settings sections, empty states, first-run/fatal
  panels, and status bar. Also fixes the toolbar menu being clipped by
  `overflow: hidden` when open.
- `frontend/src/components/shell/SectionRail.tsx`: stable faction accent per
  section.
- `frontend/src/components/mod-list/ModsScreen.tsx`,
  `frontend/src/components/profiles/ProfilesScreen.tsx`,
  `frontend/src/components/conflicts/ConflictScreen.tsx`,
  `frontend/src/components/workshop/WorkshopScreen.tsx`,
  `frontend/src/components/settings/SettingsScreen.tsx`: `data-faction` on each
  screen.
- `frontend/src/styles/tokens.test.ts`: new chrome tokens and contrast pairs.
- `frontend/src/components/shell/SectionRail.test.tsx`,
  `frontend/src/App.test.tsx`: faction framing and menu behaviour tests.
- `scripts/qa/screenshots-m4.mjs`: output directory override, shell geometry in
  the measurement line, menu/focus captures.
- `scripts/qa/reference-study.html`,
  `scripts/qa/render-reference-study.sh`: our own reference study plate.
- `docs/UI_DIRECTION.md` §2.8, `docs/adr/008-tw-wh3-fidelity-skin.md`,
  `docs/UI_ACCEPTANCE.md` (WAR-147 section), this evidence file.

## Reference study

The reference captures are linked, not committed, because they are game or
third-party media. Sources and the observed anatomy/palette/type mapping are in
`docs/UI_DIRECTION.md` §2.8. Our own reconstruction is
`docs/screenshots/WAR-147/reference-study__1920x1080.png` and
`reference-study__1366x768.png`.

Sampled reference values were used as observations, then normalised into the
semantic tokens. They are not claimed as exact source values: the captures are
JPEG and scene-lit. No copyrighted art was committed.

## Verification

Run from `frontend/` on the implementation branch:

| Check | Command | Result |
|---|---|---|
| Type check | `pnpm typecheck` | pass |
| Lint | `pnpm lint` | pass |
| Unit / integration tests | `pnpm test` | pass — 10 files / 80 tests |
| Production build | `pnpm build` | pass — 45 modules, CSS 56.64 kB (10.16 kB gzip) |
| Token/contrast gate | included in `pnpm test` (`tokens.test.ts`) | pass |
| Screenshot capture | `SHOT_OUT=docs/screenshots/WAR-147 node scripts/qa/screenshots-m4.mjs` | pass — 44 captures, no horizontal page scroll |
| Reference plate | `./scripts/qa/render-reference-study.sh` | pass — 1920×1080 and 1366×768 |

Rust was not changed, so no Rust command is part of this pass.

### Shell geometry (no mod-list space consumed)

Capture line format:
`shell={"title":40,"toolbar":40,"listHeader":28,"status":24}`.

| Viewport | Density | Row height | Visible rows | Shell |
|---|---|---:|---:|---|
| 1920×1080 | compact | 32px | 29 | 40 / 40 / 28 / 24 |
| 1920×1080 | comfortable | 40px | 23 | 40 / 40 / 28 / 24 |
| 1920×1080 | roomy | 48px | 19 | 40 / 40 / 28 / 24 |
| 1366×768 | compact | 32px | 19 | 40 / 40 / 28 / 24 |
| 1366×768 | comfortable | 40px | 15 | 40 / 40 / 28 / 24 |
| 1366×768 | roomy | 48px | 13 | 40 / 40 / 28 / 24 |

The capture also asserts no horizontal page scroll at 1920×1080, 1366×768, and
1024×720 for all five screens.

### Existing behaviour contract

These v1.0 tests still pass unchanged in intent and assertions:

- density order and comfortable default (`tokens.test.ts`);
- first-visible row and selection preserved across density changes
  (`ModList.test.tsx`);
- 20,000-mod mounted-row bound (`ModList.test.tsx`);
- Ctrl+1..5, Ctrl+F, F6, Ctrl+A, Escape, Alt+Arrow, dialog cancel/confirm
  (`App.test.tsx`, `ModList.test.tsx`);
- 500-subscription Workshop bound (`WorkshopScreen.test.tsx`).

### Accessibility

- Text/background pairs are re-checked by `tokens.test.ts`; the lowest pair is
  still above 4.5:1.
- Focus rings are unchanged: 2px `--color-border-focus`, 2px offset. No
  focusable element received `clip-path`; the buttons keep an outer outline.
- The new banner and rail accents are never the only signal: the visible label
  and `aria-current` remain.
- `prefers-reduced-motion` and `forced-colors` blocks are untouched and still
  last in the cascade.

### Visual evidence

`docs/screenshots/WAR-147/`:

- 44 captures at 1920×1080 and 1366×768, including all five screens, dialogs,
  empty/loading/first-run/error states, the framed menu, and a focus state.
- 29 before/after composites in `side-by-side/`.
- Two reference study plates.

## Checklist mapping

| Acceptance item | Evidence |
|---|---|
| F-01 reference captures + token mapping, no copyrighted art | `docs/UI_DIRECTION.md` §2.8; `docs/screenshots/WAR-147/reference-study__*` |
| F-02 our own rendering only | reference study HTML + local SVG stud; token test rejects remote assets |
| F-03 shell chrome redesign | 44 captures; `theme.css` fidelity section |
| F-04 faction-framed headers | `SectionRail.test.tsx`; `App.test.tsx`; captures |
| F-05 no mod-list space consumed | geometry table above; capture output |
| F-06 density/virtualization/keyboard unchanged | `pnpm test` 80/80; unchanged v1.0 tests |
| F-07 contrast/focus/forced-colors | `tokens.test.ts`; `mods__focus__*`; unchanged media blocks |
| F-08 side-by-side at both viewports | `side-by-side/` 29 composites |
| F-09 no gradient/glow/remote asset | `tokens.test.ts` forbidden-pattern test |
| F-10 PR evidence | PR #59 + `docs/UI_FIDELITY_EVIDENCE.md` |

## Known limitations

- The reference captures are external links, not committed images, by the
  task's copyright constraint. The palette values are sampled approximations.
- The reference study reconstructs chrome, not game layout or content; the app
  remains a dense desktop mod manager, not a game menu.
- `dev`/`build` were run on Linux; Windows 200% text scaling remains T-02 in
  the v1.0 acceptance record.
