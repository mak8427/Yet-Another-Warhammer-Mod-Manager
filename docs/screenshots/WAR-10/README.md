# WAR-10 — M4 screenshot evidence

Captured from the production build (`pnpm build`) with deterministic mock IPC,
headless Chromium, `deviceScaleFactor: 1`, and `prefers-reduced-motion: reduce`.
The mock data is in `scripts/qa/screenshots-m4.mjs`; the screenshots are evidence,
not shipped in the app bundle.

Regenerate after a UI change:

```sh
pnpm build
node scripts/qa/screenshots-m4.mjs   # set CHROME_PATH when Chromium is not on PATH
```

Naming follows `docs/UI_ACCEPTANCE.md`:
`<screen>__<state>__<viewport>__<density>.png`.

## Set

| Screen / state | 1920×1080 | 1366×768 |
|---|---|---|
| Shell + mod list (comfortable) | `shell__mods__1920x1080__comfortable.png` | `shell__mods__1366x768__comfortable.png` |
| Mod list (compact) | `shell__mods__1920x1080__compact.png` | measured only |
| Mod list (roomy) | `shell__mods__1920x1080__roomy.png` | measured only |
| Faction tag filter | `mods__filtered-tag__1920x1080__comfortable.png` | `mods__filtered-tag__1366x768__comfortable.png` |
| Selection + docked inspector | `mods__selected-inspector__1920x1080__comfortable.png` | `mods__selected-inspector__1366x768__comfortable.png` |
| Profiles | `profiles__active__1920x1080__comfortable.png` | `profiles__active__1366x768__comfortable.png` |
| Conflicts | `conflicts__report__1920x1080__comfortable.png` | `conflicts__report__1366x768__comfortable.png` |
| Workshop | `workshop__subscribed__1920x1080__comfortable.png` | `workshop__subscribed__1366x768__comfortable.png` |
| Workshop, Steam unavailable | — | `workshop__steam-unavailable__1366x768__comfortable.png` |
| Settings | `settings__general__1920x1080__comfortable.png` | `settings__general__1366x768__comfortable.png` |
| First run, game not found | `first-run__not-found__1920x1080__comfortable.png` | `first-run__not-found__1366x768__comfortable.png` |
| Loading | `loading__boot__1920x1080__comfortable.png` | `loading__boot__1366x768__comfortable.png` |
| Empty mod list | `empty__no-mods__1920x1080__comfortable.png` | `empty__no-mods__1366x768__comfortable.png` |
| Error | `error__load-failure__1920x1080__comfortable.png` | `error__load-failure__1366x768__comfortable.png` |
| Load-order preview | `load-order__preview__1920x1080__comfortable.png` | `load-order__preview__1366x768__comfortable.png` |
| Launch dialog | `launch__dialog__1920x1080__comfortable.png` | `launch__dialog__1366x768__comfortable.png` |

## Measurements printed by the capture run

Fully visible rows, 63-mod fixture (viewport minus title/toolbar/header/status):

| Viewport | Compact 32px | Comfortable 40px | Roomy 48px |
|---|---:|---:|---:|
| 1920×1080 | 29 | 23 | 19 |
| 1366×768 | 19 | 15 | 13 |

Mounted `.mod-row` nodes stay bounded by the virtual window (visible + overscan):
50 / 44 / 40 at 1920×1080 and 40 / 36 / 34 at 1366×768. The 20,000-mod case is
asserted in `frontend/src/components/mod-list/ModList.test.tsx`
(`bounds the mounted rows for 20,000 mods`, ≤30 mounted rows at 320px height).
The capture run also checks every screen at 1024×720 for horizontal page scroll;
all report `scrollWidth = innerWidth`.
