# ADR-008 — TW:WH3 fidelity skin (WAR-147)

- Status: accepted for v1.1
- Date: 2026-10-22
- Owner: Katerina Zarina
- Related: ADR-006 (UI tokens and density), `docs/UI_DIRECTION.md` §2.8,
  WAR-147

## Context

The v1.0 shell used semantic tokens but a neutral iron palette and flat
chrome. The result was legible and dense, but it read as a generic developer
tool rather than the Total War: WARHAMMER III material language the product
brief asks for.

WAR-147 is a visual fidelity pass, not a feature change. It must not move the
shell geometry, row heights, scroll ownership, keyboard map, or accessibility
contract proven by the v1.0 acceptance suite.

ADR-006 forbade double borders, inner shadows, bevels, and ornamental corner
marks. A faithful TW:WH3 chrome needs a warm wine/gold palette, banner plates,
brass frames, and small corner studs. Keeping the old ban would make the task
contradict the design contract.

## Decision

### Palette primitives

The private primitives are renamed and retuned:

- `--iron-*` is replaced by `--obsidian-*` (warm near-black stone).
- `--wine-*` is added for banner plates, rail plates, tabs, and the primary
  action.
- `--parchment-*`, `--brass-*`, `--signal-*`, and `--oxide-*` keep their names
  and roles.

Semantic token names do not change. Components still consume semantic tokens
only. The contrast pairs enforced by `tokens.test.ts` are recomputed and pass.

### Chrome treatments

- Framed chrome may use a brass outer border, a 1px dark inner line
  (`--bevel-frame`), and an inset top/bottom bevel (`--bevel-plate`,
  `--bevel-sunken`). These are structural, not decorative shadows.
- A single 14×14 brass corner stud, `--ornament-corner`, is permitted on
  framed panels. It is an inline SVG data URI drawn for this project; it is
  not game art and it is not fetched at runtime.
- Banner plates are flat fills with a brass frame and a faction-accent left
  rule. No gradients, glow, blur, backdrop-filter, or imported textures.
- The display serif is used for banners, section labels, and buttons; rows and
  data cells stay in the body face.

### Faction framing

Each screen has a stable accent: Mods brass, Profiles azure, Conflicts ember,
Workshop copper, Settings jade. The accent appears as a 3px rule and a 6px
diamond on the header banner and on the active rail item. It is never the only
signal: the screen name and rail label are always visible.

### Geometry is frozen

The following stay at their ADR-006 values, and the screenshot harness asserts
them at 1920×1080 and 1366×768:

- title strip 40px, toolbar/screen bar 40px, list header 28px, status bar 24px;
- row heights 32/40/48px and thumbnails 24/32/40px;
- visible rows 29/23/19 at 1920×1080 and 19/15/13 at 1366×768.

## Consequences

- ADR-006 clauses forbidding bevels and corner marks are superseded by this
  ADR. Its token-source, density, contrast, and single-source clauses still
  apply.
- `tokens.test.ts` now requires the chrome tokens and the local ornament, and
  still forbids gradients, glow, external assets, and web fonts.
- Any future palette change must update `docs/UI_DIRECTION.md` §2.8,
  `docs/UI_ACCEPTANCE.md`, and this ADR's mapping table.
- No layout code changes. The pass is CSS plus `data-faction` attributes.

## Evidence

- `docs/UI_DIRECTION.md` §2.8: reference links, sampled palette, and mapping.
- `docs/screenshots/WAR-147/`: our own captures at both required viewports,
  before/after pairs, and the reference study plate.
- `frontend/src/styles/tokens.test.ts` and
  `frontend/src/components/shell/SectionRail.test.tsx`.
