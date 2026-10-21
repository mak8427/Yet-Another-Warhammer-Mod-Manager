# Fixtures — synthetic, licence-clean

Owner: Baltasar Gelt (QA). Regenerate with:

```bash
node scripts/qa/generate-fixtures.mjs --write
node scripts/qa/generate-fixtures.mjs --verify
```

Nothing here is game data, a user mod, or downloaded Workshop content. Every
byte is produced from `scripts/qa/generate-fixtures.mjs` with fixed inputs, so a
clean checkout and a rerun agree.

`manifest.json` records the SHA-256 and size of every committed data fixture.
`--verify` fails on any drift, and `crates/wh3mm-core/tests/qa_fixtures.rs`
fails when a file is unlisted or the manifest lists a file that is gone.
`fixtures/**` is marked `-text` in `.gitattributes` so Git never rewrites a
CRLF or BOM fixture on checkout.

## Packs (`packs/`)

PFH5 layout follows the legacy compatibility reference
(`src/packFileHandler.ts`, `src/utility/packFileIndex.ts`). The committed packs
were validated against that project's own `parsePFH5Header` / `parsePFH5Index`:
6/6 valid packs parse, 7/7 malformed packs are rejected.

| File | Purpose |
| --- | --- |
| `valid_minimal.pack` | One file, no dependencies, `byteMask` 3 |
| `valid_multi.pack` | Three files; middle entry has the compression flag |
| `valid_unicode.pack` | Four non-ASCII internal paths (ñ, 日本語, ü, кириллица) |
| `valid_with_deps.pack` | Dependency index `data.pack`, `wh_main_placeholder.pack` |
| `valid_movie.pack` | `byteMask` 4 (movie pack) |
| `valid_hashed.pack` | `byteMask & 0x40`; every index entry has a filename hash |
| `malformed_bad_magic.pack` | `PFH4` magic |
| `malformed_truncated_header.pack` | 12-byte file |
| `malformed_oversized_dependency_header.pack` | dependency size `0xffffff00` |
| `malformed_oversized_file_index.pack` | index size `0x7fffffff` |
| `malformed_count_mismatch.pack` | declares 4096 files, contains 1 |
| `malformed_unterminated_name.pack` | index name without its NUL |
| `malformed_empty.pack` | zero bytes |

## Steam metadata (`steam/`)

| File | Purpose |
| --- | --- |
| `libraryfolders.vdf` | Three libraries: WH3 present, no WH3, and a missing path |
| `libraryfolders_flatpak.vdf` | Flatpak Steam root |
| `libraryfolders_malformed.vdf` | Unbalanced braces |
| `appmanifest_1142710.acf` | WH3 app state (`installdir` `Warhammer3`) |
| `appworkshop_1142710.acf` | Two subscribed/installed Workshop items |
| `appworkshop_1142710_empty.acf` | No subscriptions |

WH3's Steam app id is **1142710** (`src/supportedGames.ts`). The WAR-6 brief
mentioned `appworkshop_3247630.acf`; 3247630 is not WH3, so the fixture uses
1142710 and the mismatch is recorded as a finding in `docs/QA_PLAN.md`.

## Load order (`load_order/`)

`used_mods_valid.txt` (LF), `_crlf.txt`, `_bom.txt`, `_empty.txt`,
`_unknown_directive.txt` (two `add_working_directory` lines),
`_duplicates.txt` (case-insensitive duplicates), `_corrupt.txt` (unterminated
quote, unquoted name, garbage), `_no_final_newline.txt`.

## Config (`config/`)

Schema v1 from ADR-003: `config_valid.json`, `config_future_version.json`
(schema 2), `config_unknown_fields.json` (unknown key plus an invalid profile),
`config_corrupt.json`, `config_truncated.json`. `config.json.bak` scenarios are
built by the test that needs them; only the primary document is committed.

## Scale (`scale/`)

`index-500.json` is the deterministic 500-mod index used by frontend scale
tests, with 167 Workshop mods, 125 disabled mods, unicode names, and malformed
variants. It carries a digest over the `mods` array and is verified by the Rust
fixture-contract test. It is data only: no 500 binary packs are committed.

For Rust scale tests, generate a real 500-pack tree outside the repo:

```bash
node scripts/qa/generate-fixtures.mjs --scale /tmp/wh3-scale-500 --count 500
```

The target is validated before anything is deleted. The repository root, any
path inside the repository, ancestors of the repository, the home directory and
its ancestors are always refused. A non-empty directory that is not a previous
`--scale` output is refused unless `--force` is passed; symlinks are resolved
first. `--force` only overrides that last rule, never the protected paths:

```bash
node scripts/qa/generate-fixtures.mjs --scale /tmp/wh3-scale-500 --count 500 --force
```

The output contains `data/`, `content/1142710/<id>/`, a vanilla `data.pack` and
`manifest.txt`, and `fixture-manifest.json` with a stable digest over every
pack. Never commit the generated tree.
