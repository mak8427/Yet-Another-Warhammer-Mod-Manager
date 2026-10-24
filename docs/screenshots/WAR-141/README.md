# WAR-141 screenshot evidence

Captured from the production frontend build with deterministic mock IPC at the
two viewports required by `docs/UI_ACCEPTANCE.md`.

Command:

```sh
pnpm build
SHOT_OUT=docs/screenshots/WAR-141 \
SHOT_ONLY=settings__general,shell__mods__1920x1080__comfortable,shell__mods__1366x768__comfortable \
node scripts/qa/screenshots-m4.mjs
```

| File | Viewport |
|---|---|
| `shell__mods__1920x1080__comfortable.png` | 1920×1080 |
| `shell__mods__1366x768__comfortable.png` | 1366×768 |
| `settings__general__1920x1080__comfortable.png` | 1920×1080, zoom control visible |
| `settings__general__1366x768__comfortable.png` | 1366×768, zoom control visible |

The capture harness asserts there is no horizontal page scroll at either
viewport. Webview zoom and window placement itself are exercised by the
`wh3mm-core` restore tests and the manual restart check Z-05.
