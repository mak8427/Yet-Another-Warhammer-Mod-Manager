# Bug report template

Copy this into a child issue. A report without reproduction steps and evidence
is not a bug report, it is a guess.

Use the issue title shape `[S<severity>] <area>: <observable symptom>`.
Assign the owning engineer, link the parent task and any related PR/run, and
add the `qa` label. Do not fix the feature in the report task.

---

## Summary

One sentence: what is broken, and for whom.

## Severity

Pick one; the definitions are in `docs/QA_PLAN.md` §8.

| Severity | Meaning | Release impact |
| --- | --- | --- |
| S1 — Blocker | Data loss, crash on a normal path, security issue, unopenable build | Blocks release and the PR |
| S2 — Major | A v1.0 acceptance criterion is broken; no workaround | Blocks release |
| S3 — Minor | Incorrect but recoverable; a workaround exists | Fix or record as known issue |
| S4 — Trivial | Cosmetic, docs, test-only | Queue, no gate |

## Environment

| Field | Value |
| --- | --- |
| App version / commit | |
| Build type | release / debug |
| OS + build | |
| Rust / Node / pnpm | |
| Steam install type | native / Flatpak / Snap / Proton |
| WH3 install path | |
| Fixture or real data | |
| CI run / PR | |

## Reproduction steps

Numbered, minimal, deterministic. Start from a clean state and say what that
means.

1.
2.
3.

Frequency: always / intermittent (x of y).
Seed or fixture digest if the data is generated.

## Expected vs actual

- **Expected:** the behaviour the docs require (link the criterion, ADR, or
  `docs/PRODUCT_SCOPE.md` row).
- **Actual:** what happened.

## Evidence

Attach at least two of:

- exact command and full output (or a link to the CI log);
- failing test name and assertion;
- `used_mods.txt` / `config.json` before and after, with hashes;
- screenshot or short screen recording (UI defects);
- stack trace or `RUST_BACKTRACE=1` output (panics);
- `fixture-manifest.json` digest for generated data.

Never paste secrets, tokens, or absolute user paths that identify a person.

## Impact and workaround

- Affected users / data:
- Workaround (if any):
- Is a backup or manual recovery possible? Do not rely on one silently.

## Regression test

What automated test will prove the fix? Name the intended test file and case.
If the bug cannot be automated, say why and add it to
`docs/MANUAL_QA_WINDOWS.md`.

## Links

- Parent task:
- Related PR / run:
- Duplicate of:
