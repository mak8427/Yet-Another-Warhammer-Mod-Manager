# README showcase

Captured from the current production frontend on 2026-10-24 after the dark
Fiery Forge grey / blue-controls palette landed in main (`6ae9103`, PR #64).
These are synthetic fixture-backed captures, not a real user's mod collection.

All five views use 1920×1080 and comfortable density. The capture harness
reported no horizontal or vertical page overflow (`scroll=1920x1080`).
Mod-list captures have 23 visible rows and retain the 40/40/28/24 shell bands.

Reproduce from the repository root:

```bash
pnpm build
SHOT_OUT=docs/screenshots/showcase \
SHOT_ONLY=mods__selected-inspector__1920x1080__comfortable,profiles__active__1920x1080__comfortable,conflicts__report__1920x1080__comfortable,launch__dialog__1920x1080__comfortable,settings__general__1920x1080__comfortable \
node scripts/qa/screenshots-m4.mjs
```

The README uses these five captures. Historical WAR-10/WAR-147 evidence remains
in its original directories.
