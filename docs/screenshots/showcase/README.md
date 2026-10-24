# README showcase

Captured from the current production frontend on 2026-10-24 after the dark
Fiery Forge grey / blue-controls palette landed in main (`6ae9103`, PR #64).
Profiles, enabled states, tags, and conflict reports are simulated. The mod-list
and launch captures include real installed Workshop pack names and artwork;
these do not claim to reproduce a user's actual load order or conflict results.

All six views use 1920×1080 and comfortable density. The capture harness
reported no horizontal or vertical page overflow (`scroll=1920x1080`).
Mod-list captures have 23 visible rows and retain the 40/40/28/24 shell bands.

Reproduce from the repository root:

```bash
pnpm build
SHOT_OUT=docs/screenshots/showcase \
SHOT_ONLY=mods__selected-inspector__1920x1080__comfortable,profiles__active__1920x1080__comfortable,conflicts__report__1920x1080__comfortable,launch__dialog__1920x1080__comfortable,settings__general__1920x1080__comfortable \
node scripts/qa/screenshots-m4.mjs
```

The README uses these six captures. Set `SHOT_WORKSHOP_DIR` to your installed
`steamapps/workshop/content/1142710` directory to include local thumbnails in the
mod-list/launch captures; omit it for the original deterministic fixtures.
Source artwork is read locally and embedded only in the screenshots. Historical WAR-10/WAR-147 evidence remains
in its original directories.
