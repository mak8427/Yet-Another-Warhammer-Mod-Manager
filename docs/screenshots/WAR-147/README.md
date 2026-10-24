# WAR-147 screenshot evidence

These captures are our own renderings of the WH3 Mod Manager with deterministic
mock IPC. They are evidence, not design sources. The reference captures used for
the study are linked in `docs/UI_DIRECTION.md` §2.8 and are **not** committed:
they are third-party/game media.

## Generation

```sh
pnpm build
SHOT_OUT=docs/screenshots/WAR-147 node scripts/qa/screenshots-m4.mjs
./scripts/qa/render-reference-study.sh
```

The capture run prints the measured shell heights and visible-row counts. At
1920×1080 and 1366×768 the shell is `40 / 40 / 28 / 24` (title / toolbar /
list header / status bar). Visible rows are 29 / 23 / 19 and 19 / 15 / 13 for
compact / comfortable / roomy.

## What is here

| Group | Files | Purpose |
|---|---|---|
| Mods | `shell__mods__*`, `mods__selected-inspector__*`, `mods__filtered-tag__*` | Main screen, selection, tag filter, all densities |
| Chrome states | `mods__menu__*`, `mods__focus__*` | Framed menu and visible focus ring at both viewports |
| Screens | `profiles__active__*`, `conflicts__report__*`, `workshop__subscribed__*`, `settings__general__*` | Faction-framed headers and tables |
| Dialogs | `load-order__preview__*`, `launch__dialog__*` | Centred banner headers, framed body, footer |
| Edge states | `empty__no-mods__*`, `loading__boot__*`, `first-run__not-found__*`, `error__load-failure__*`, `workshop__steam-unavailable__*` | Framed briefing/empty surfaces |
| Reference study | `reference-study__*` | Our own reconstruction of the observed chrome, palette, and type |
| Side-by-side | `side-by-side/*__side-by-side.png` | Before (WAR-10) vs after (WAR-147) at native resolution |
| Capture log | `capture.log` | One measurement line per capture, including shell heights and visible rows |

All primary screens and states have a 1920×1080 and a 1366×768 capture. The mod
list additionally has compact and roomy captures at 1920×1080. The
`side-by-side/` pairs are 29 composites covering every state present in the
WAR-10 evidence set.

## Copyright note

No game screenshot, crest, texture, font, or other game asset is committed in
this directory. `reference-study__*` is drawn from our own tokens and markup.

## Integration refresh (2026-10-24)

The 33 application screenshots and capture.log were refreshed with the
WAR-141 zoom controls integrated. The log includes 11 additional geometry
checks. The 29 side-by-side composites retain the original comparison; the
reference study plates are unchanged.

## Final owner-reference palette

The application screenshots now use the supplied jade/stone/teal palette and
bevelled capsule button style. capture.log records 33 screenshots plus 11
geometry checks from this final build. The reference plates and side-by-side
composites are explicitly retained as the earlier wine/gold concept.
