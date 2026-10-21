# ADR-006 — UI token source, density roles, and faction accents

- Status: accepted
- Date: 2026-10-21
- Owner: Katerina Zarina
- Depends on: ADR-001, ADR-003
- Implements: WAR-8 (`docs/UI_DIRECTION.md`, `docs/UI_ACCEPTANCE.md`)

## Context

ADR-001 placed the visual tokens in `frontend/src/styles/theme.css` and left
the scale to M4. WAR-8 defines a larger system: semantic colour, typography,
density, geometry, states, and faction accents. Keeping tokens and shell rules
in one mutable file makes it easy for components to drift and impossible to
enforce a single source.

ADR-003 limits `ui.density` to `compact` and `comfortable`. The M4 deliverable
requires `compact`, `comfortable`, and `roomy`. Extending an enum with a new
value is backward compatible: an older build falls back to `comfortable` for an
unknown value (already specified in ADR-003), and no schema-version bump is
needed.

Tags in ADR-003 store an arbitrary `#RRGGBB` colour. Faction framing needs a
small, contrast-checked palette, and tag identity must not depend on colour.

## Decision

### Token source

- `frontend/src/styles/tokens.css` is the **only** file that defines CSS custom
  properties. It is imported by `theme.css`, which `main.tsx` imports.
- Tokens are split into private primitives (`--iron-*`, `--parchment-*`,
  `--brass-*`, `--signal-*`) and public semantic tokens (`--color-*`,
  `--text-*`, `--space-*`, `--row-*`, `--control-*`, `--radius-*`,
  `--shadow-*`, `--z-*`, `--motion-*`, `--faction-*`). Components use semantic
  tokens only.
- No component may hard-code a colour, font stack, row height, or density
  value. Data-driven faction accents may set `--faction-accent` inline.
- Semantic token changes require an update to `docs/UI_DIRECTION.md`,
  `docs/UI_ACCEPTANCE.md`, and `tokens.test.ts` in the same PR.

### Density

- `ui.density` accepts `compact`, `comfortable`, and `roomy`; the default and
  persisted fallback is `comfortable`.
- CSS reads `data-density` on `<html>`. Row heights are fixed at 32px, 40px,
  and 48px (including the 1px row border); thumbnails are 24px, 32px, and
  40px.
- Density changes do not alter the persisted scroll offset beyond clamping.

### Faction accents

- Eight accent slots are defined in `tokens.css`. They are selected with
  `data-faction` on a tag or a screen header; the default is brass.
- The visible tag or faction name is always present. Accent colour is
  decoration and never the only indication of identity or state.
- Faction accents do not replace semantic state colours. Enabled, selected,
  conflict, missing dependency, loading, and error keep their own tokens and
  icon shapes.
- Stored tag colours outside the palette map to the nearest slot for the 2px
  rule; tag text remains a semantic text colour.

### Migration bridge for the pre-token M2 shell

- The WAR-5 shell predates this ADR and references thirteen legacy palette
  variables (`--ink-*`, `--parchment*`, `--gold*`, `--brass-line`, `--blood*`,
  `--green`). So that `main` stays visually intact after this branch merges,
  `tokens.css` defines them as deprecated aliases to semantic tokens.
- The pre-token shell block in `theme.css` is marked `legacy-m2:start` /
  `legacy-m2:end`. The anti-pattern test checks everything outside that block,
  so new styles remain bound by the no-gradient/no-glow rule.
- M4 (WAR-10) migrates the shell to semantic tokens and deletes both the alias
  block and the legacy section. The aliases are not part of the public token
  contract.

### Enforcement

- `frontend/src/styles/tokens.test.ts` verifies required tokens, contrast
  pairs, density order, the single-source rule, and the
  no-gradient/no-external-asset rule.
- `docs/UI_ACCEPTANCE.md` global gates G-01, G-02, G-05, G-06, G-11 and G-14
  are the review gates for implementation.

## Consequences

- M2 can consume the tokens immediately; M4 replaces placeholder shell styles
  without redefining values.
- WAR-5 may ship `compact` and `comfortable` first. The `roomy` value must be
  accepted by config parsing by the time M4 is done; an unknown value still
  falls back safely.
- The token file is now an API. Adding a semantic token is cheap; changing an
  existing one needs the docs/test update above.
- This ADR supersedes the ADR-001 statement that tokens live in `theme.css` and
  the ADR-003 enumeration of `ui.density`. It does not change the storage
  location or the `schemaVersion`.
