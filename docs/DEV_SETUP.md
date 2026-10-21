# Development setup

## Legacy WH3 Mod Manager reference

The legacy application ([`Shazbot/WH3-Mod-Manager`](https://github.com/Shazbot/WH3-Mod-Manager))
is the reference for M1/M2 porting work (UI, pack handling, load order) and for
the WAR-7 performance baselines. It is **not** part of this repository and is
never vendored, committed, or shipped.

### Pinned revision

| Field | Value |
|---|---|
| Repository | `https://github.com/Shazbot/WH3-Mod-Manager.git` |
| Commit | `07fcf3ea1428fe3aa88282ba7aed44d9947ef103` |
| Commit date | 2026-10-19 |
| License | MIT (upstream `LICENSE`) |

### Fetch it

From the repository root:

```bash
bash scripts/fetch-reference.sh
```

The script creates a shallow, detached checkout at `reference/WH3-Mod-Manager`
with exactly the pinned commit. It requires `git` and network access to GitHub.
The command is idempotent: when the checkout already exists at the pinned
commit it prints a confirmation and exits without changing anything.

`reference/` is listed in `.gitignore`, so the checkout never appears in
`git status` and never reaches a commit. No CI job needs to fetch it; any job
that does can call the same script.

### Read-only rule

Treat `reference/WH3-Mod-Manager` as read-only. Do not edit files there, do not
commit them, and do not copy the tree into the product. Use it to read the
legacy implementation, then write the Rust or TypeScript version in this
repository. Local edits make the checkout disagree with the pinned commit and
invalidate comparisons against the legacy baselines.

### Verify

```bash
git -C reference/WH3-Mod-Manager rev-parse HEAD   # prints the pinned commit
git status --porcelain                            # clean
git check-ignore reference/WH3-Mod-Manager        # prints the path
git ls-files reference/                           # prints nothing
```

### Re-pin

1. Pick the new upstream commit and update `PINNED_COMMIT` in
   `scripts/fetch-reference.sh` and the table above (commit and date).
2. Remove the old checkout: `rm -rf reference/WH3-Mod-Manager`.
3. Run `bash scripts/fetch-reference.sh` and repeat the verification commands.
4. Record why the revision moved in the task or pull request that changes it.
