# Development setup

## Linux desktop development flow

The shell is built with cargo on Linux; this repository does not run the Tauri
CLI dev server. Install the Linux desktop packages from the
[README prerequisites](../README.md#linux-desktop-shell) first.

Build the frontend, then the shell:

```bash
pnpm install --frozen-lockfile
pnpm build
cargo build -p wh3mm-app --locked
```

Run the binary:

```bash
./target/debug/wh3mm
```

`generate_context!` embeds `frontend/dist` at compile time, so the frontend must
be built before the shell. `cargo build` tracks `frontend/dist` and rebuilds the
app crate after `pnpm build`.

The shell does not use Vite HMR. `devUrl` and `beforeDevCommand` in
`crates/wh3mm-app/tauri.conf.json` are Tauri CLI settings, and this repository
does not run the Tauri CLI that reads them. The `tauri` dependency enables
`custom-protocol` for every cargo build (there is no `linux-desktop` feature),
so the binary serves the embedded frontend from the app scheme. After a
frontend change, run `pnpm build` and `cargo build -p wh3mm-app --locked`
again, then restart `wh3mm`. `pnpm dev` is for UI work in a browser, where
Tauri IPC is unavailable.

Because the shell always serves the frontend from the app scheme, the
`asset://` protocol used for pack thumbnails works in this flow. A `devUrl`
document is an `http://` origin, and WebKitGTK does not deliver custom-scheme
requests from one. See
[issue #46](https://github.com/mak8427/Warhammer_mod_manager/issues/46) for the
probe that established this.

For a release build (the CI artifact):

```bash
pnpm build
cargo build -p wh3mm-app --release --locked
./target/release/wh3mm
```

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
