# Workshop title comparison

These images use the deterministic screenshot fixture, not a real user's install.
`before` was captured from a clean `main` build; `after` was captured from this
branch.

Regenerate with:

```bash
pnpm build
SHOT_TITLE_COMPARE=before SHOT_ONLY=title-compare node scripts/qa/screenshots-m4.mjs
SHOT_TITLE_COMPARE=after SHOT_ONLY=title-compare node scripts/qa/screenshots-m4.mjs
```

- The mod list title changes from the technical pack handle to the official
  Workshop title; the handle remains as the subtitle.
- The inspector keeps `Pack name` and adds the exact `File` name.
- The same filter matches both the official title and the technical handle.
