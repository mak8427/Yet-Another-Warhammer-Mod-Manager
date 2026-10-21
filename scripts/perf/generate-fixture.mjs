#!/usr/bin/env node
/**
 * Generates the reproducible 500-mod fixture used by the legacy WH3 Mod Manager baseline.
 *
 * The fixture is deliberately *not* committed: it contains hundreds of binary packs.
 * It is rebuilt from this script, byte for byte, from a fixed seed.
 *
 * Layout (a synthetic WH3 game root):
 *   <root>/data/*.pack                 data-folder mods (and the vanilla pack named in manifest.txt)
 *   <root>/data/manifest.txt           vanilla pack list read by the legacy app
 *   <root>/content/1142710/<id>/*.pack workshop-shaped mods
 *   <root>/userdata/config.json        app config pointing at the fixture
 *   <root>/fixture-manifest.json       what was generated (variant -> file list)
 *
 * Variants in the 500 packs:
 *   valid        PFH5 with 1-4 packed files, realistic size spread
 *   unicode      PFH5 whose pack name and internal names use non-ASCII characters
 *   duplicate    two packs with the same basename in data/ and content/ (cross-source duplicate)
 *   bad-magic    PFH4 header
 *   truncated    header cut in the middle
 *   bad-index    file count / index size disagree with the bytes on disk
 *   empty        zero-byte file
 *
 * Usage:
 *   node scripts/perf/generate-fixture.mjs [--out DIR] [--count 500] [--seed 20261020]
 *   node scripts/perf/generate-fixture.mjs --verify DIR
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import * as nodePath from "node:path";

const PFH5_HEADER_BYTES = 28;
const DEFAULTS = { count: 500, seed: 20261020, out: nodePath.resolve("perf-fixture", "wh3-500") };

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const hasFlag = (name) => args.includes(`--${name}`);

/** Deterministic xorshift32 so every machine produces identical bytes. */
function makeRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * Builds a minimal but valid PFH5 pack. The layout matches src/packFileHandler.ts:
 * 28-byte header, dependency index, packed-file index (size, [hash], compression flag, UTF-8
 * name, NUL), payloads. byteMask 0 means "no filename hash", so the index has no hash word.
 */
function buildPFH5({ files, timestamp = 0, corruptedIndexSize = null }) {
  const indexParts = [];
  for (const file of files) {
    const size = Buffer.alloc(4);
    size.writeUInt32LE(file.data.length, 0);
    indexParts.push(size, Buffer.from([file.compressed ? 1 : 0]), Buffer.from(`${file.name}\0`, "utf8"));
  }
  const index = Buffer.concat(indexParts);
  const header = Buffer.alloc(PFH5_HEADER_BYTES);
  header.write("PFH5", 0, "ascii");
  header.writeUInt32LE(0, 4); // byte mask: no dependency blocks, no filename hash
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(0, 12); // dependency index size
  header.writeUInt32LE(files.length, 16);
  header.writeUInt32LE(corruptedIndexSize ?? index.length, 20);
  header.writeUInt32LE(timestamp >>> 0, 24);
  return Buffer.concat([header, index, ...files.map((file) => file.data)]);
}

const padTo = (buffer, minimum, filler) => {
  if (buffer.length >= minimum) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(minimum - buffer.length, filler)]);
};

const UNICODE_STEMS = [
  "mod_ñandú",
  "mod_日本語_騎兵",
  "mod_über_artillerie",
  "mod_Ελληνικά",
  "mod_🚀_rocket",
  "mod_кирасиры",
  "mod_中文_单位",
  "mod_østfold",
];

function makeModPack(variant, index, random) {
  const payloadSize = 256 + Math.floor(random() * 8192);
  const entries = [
    {
      // A text file keeps the pack parseable by the table reader without needing a DB schema.
      name: `db\\perf\\variant_${index}.txt`,
      data: padTo(Buffer.from(`fixture variant=${variant} index=${index}\n`, "utf8"), payloadSize, 0x20),
    },
  ];
  if (variant === "unicode") {
    entries.push({
      name: `text\\db\\${UNICODE_STEMS[index % UNICODE_STEMS.length]}_${index}.loc`,
      data: Buffer.alloc(64 + Math.floor(random() * 256), index & 0xff),
    });
  }
  if (variant === "valid" && index % 7 === 0) {
    entries.push({ name: `variantmeshes\\wh_variantmodels\\perf\\mesh_${index}.rigid_model_v2`, data: Buffer.alloc(4096, 7) });
  }
  const timestamp = 1_760_000_000 + index * 37;
  return buildPFH5({ files: entries, timestamp });
}

function makeMalformedPack(variant, index, random) {
  const valid = makeModPack("valid", index, random);
  switch (variant) {
    case "bad-magic": {
      const broken = Buffer.from(valid);
      broken.write("PFH4", 0, "ascii");
      return broken;
    }
    case "truncated":
      return valid.subarray(0, 12);
    case "bad-index": {
      const broken = Buffer.from(valid);
      // Claim far more files than the index actually holds.
      broken.writeUInt32LE(4096, 16);
      return broken;
    }
    case "empty":
      return Buffer.alloc(0);
    default:
      throw new Error(`unknown malformed variant ${variant}`);
  }
}

async function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function generate(out, count, seed) {
  const random = makeRandom(seed);
  const dataDir = nodePath.join(out, "data");
  const contentRoot = nodePath.join(out, "content", "1142710");
  const userData = nodePath.join(out, "userdata");
  await rm(out, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(contentRoot, { recursive: true });
  await mkdir(userData, { recursive: true });

  // One synthetic vanilla pack, listed in manifest.txt so the legacy app excludes it from mods.
  await writeFile(
    nodePath.join(dataDir, "data.pack"),
    buildPFH5({
      files: [{ name: "db\\vanilla\\data__", data: Buffer.alloc(512, 0x11) }],
      timestamp: 1_700_000_000,
    }),
  );
  const manifest = ["data.pack", "", "db.pack", "ui.pack", "local_en.pack", ""].join("\n");
  await writeFile(nodePath.join(dataDir, "manifest.txt"), manifest, "utf8");

  const variants = {
    valid: 0,
    unicode: 0,
    duplicate: 0,
    "bad-magic": 0,
    truncated: 0,
    "bad-index": 0,
    empty: 0,
  };
  const files = [];

  const malformedCycle = ["bad-magic", "truncated", "bad-index", "empty"];
  const DUPLICATE_PAIRS = 8; // 16 pack files: one data/ copy and one content/ copy per name
  for (let d = 0; d < DUPLICATE_PAIRS; d++) {
    const name = `perf_duplicate_${String(d).padStart(2, "0")}.pack`;
    const buffer = makeModPack("duplicate", d, random);
    await writeFile(nodePath.join(dataDir, name), buffer);
    const workshopDir = nodePath.join(contentRoot, String(1_000_000_000 + d));
    await mkdir(workshopDir, { recursive: true });
    await writeFile(nodePath.join(workshopDir, name), buffer);
    files.push({ variant: "duplicate", path: nodePath.join("data", name) });
    files.push({ variant: "duplicate", path: nodePath.relative(out, nodePath.join(workshopDir, name)) });
    variants.duplicate += 2;
  }

  const uniqueCount = count - DUPLICATE_PAIRS * 2;
  for (let i = 0; i < uniqueCount; i++) {
    // ~12% malformed, the rest a realistic mix. Deterministic, not random, so the counts are stable.
    const isMalformed = i % 8 === 7;
    let variant;
    let name;
    if (isMalformed) {
      variant = malformedCycle[Math.floor(i / 8) % malformedCycle.length];
      name = `perf_malformed_${String(i).padStart(4, "0")}.pack`;
    } else if (i % 5 === 0) {
      variant = "unicode";
      name = `${UNICODE_STEMS[i % UNICODE_STEMS.length]}_${String(i).padStart(4, "0")}.pack`;
    } else {
      variant = "valid";
      name = `perf_mod_${String(i).padStart(4, "0")}.pack`;
    }
    const buffer = isMalformed ? makeMalformedPack(variant, i, random) : makeModPack(variant, i, random);
    await writeFile(nodePath.join(dataDir, name), buffer);
    files.push({ variant, path: nodePath.join("data", name) });
    variants[variant] += 1;
  }

  const gameRoot = out;
  // Two presets give the measurement runner a real profile switch to time. Entries join by pack
  // name; the duplicate pairs collapse to one entry, the same way the app's preset resolver does.
  const uniqueModNames = [...new Set(files.map((file) => nodePath.basename(file.path)))].sort();
  const halfPresetNames = uniqueModNames.filter((_, index) => index % 2 === 0);
  const config = {
    configVersion: 3,
    currentGame: "wh3",
    currentLanguage: "en",
    gameFolderPaths: {
      wh3: {
        gamePath: gameRoot,
        dataFolder: nodePath.join(gameRoot, "data"),
        contentFolder: nodePath.join(gameRoot, "content"),
        customModFolders: [],
        modSourceOrder: ["data", "workshop"],
      },
    },
    games: {
      wh3: {
        currentPreset: { name: "Perf All", mods: uniqueModNames.map((name) => ({ name })), version: 2 },
        presets: [
          { name: "Perf Half", mods: halfPresetNames.map((name) => ({ name })), version: 2 },
          { name: "Perf All", mods: uniqueModNames.map((name) => ({ name })), version: 2 },
        ],
        modUserData: {},
        loadOrderRules: [],
        disabledModLoadOrderRules: [],
        loadOrderRuleDisabledPacks: [],
      },
    },
    alwaysEnabledModNames: [],
    hiddenModNames: [],
    ignoredMissingReqModNames: [],
    isDualModListLayoutEnabled: true,
    isClosedOnPlay: false,
    categories: [],
    categoryColors: {},
    packDataOverwrites: {},
    userFlowOptions: {},
    nodeEditorFavorites: [],
    hiddenMainWindowTabs: [],
    recentPackPaths: [],
  };
  await writeFile(nodePath.join(userData, "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

  // Normalise separators so the digest is identical on Windows and POSIX hosts.
  const digestPath = (path) => path.replaceAll("\\", "/");
  const digestInput = await Promise.all(
    files.map(
      async (file) =>
        `${digestPath(file.path)}:${await sha256(await readFile(nodePath.join(out, file.path)))}`,
    ),
  );
  const manifestJson = {
    schema: "wh3mm.perf.fixture.v1",
    seed,
    requestedPacks: count,
    packFiles: files.length,
    variants,
    sha256: await sha256(Buffer.from(digestInput.sort().join("\n"), "utf8")),
    generatedAt: new Date().toISOString(),
  };
  await writeFile(nodePath.join(out, "fixture-manifest.json"), `${JSON.stringify(manifestJson, null, 2)}\n`, "utf8");

  return manifestJson;
}

async function verify(out) {
  const expected = JSON.parse(await readFile(nodePath.join(out, "fixture-manifest.json"), "utf8"));
  const dataDir = nodePath.join(out, "data");
  const contentDir = nodePath.join(out, "content", "1142710");
  // Vanilla packs listed in manifest.txt are part of the game, not of the 500-mod fixture.
  const vanillaNames = new Set(
    (await readFile(nodePath.join(dataDir, "manifest.txt"), "utf8"))
      .split("\n")
      .map((line) => line.split(/\s+/)[0])
      .filter(Boolean),
  );
  const packs = [];
  for (const key of await readdir(dataDir)) {
    if (!key.endsWith(".pack") || vanillaNames.has(key)) continue;
    packs.push({ path: nodePath.join("data", key), buffer: await readFile(nodePath.join(dataDir, key)) });
  }
  for (const id of await readdir(contentDir)) {
    for (const key of await readdir(nodePath.join(contentDir, id))) {
      packs.push({
        path: nodePath.join("content", "1142710", id, key),
        buffer: await readFile(nodePath.join(contentDir, id, key)),
      });
    }
  }
  const digestPath = (path) => path.replaceAll("\\", "/");
  const digestInput = [];
  for (const pack of packs) digestInput.push(`${digestPath(pack.path)}:${await sha256(pack.buffer)}`);
  const actual = await sha256(Buffer.from(digestInput.sort().join("\n"), "utf8"));
  const ok = actual === expected.sha256 && packs.length === expected.packFiles;
  console.log(
    JSON.stringify(
      {
        ok,
        packs: packs.length,
        expectedPacks: expected.packFiles,
        sha256: actual,
        expectedSha256: expected.sha256,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
}

const out = nodePath.resolve(readArg("out", DEFAULTS.out));
const count = Number(readArg("count", DEFAULTS.count));
const seed = Number(readArg("seed", DEFAULTS.seed));

if (hasFlag("verify")) {
  await verify(nodePath.resolve(readArg("verify", out)));
} else {
  const sizeBefore = Date.now();
  const manifest = await generate(out, count, seed);
  const bytes = (await stat(nodePath.join(out, "fixture-manifest.json"))).size;
  console.log(
    JSON.stringify(
      {
        ok: true,
        out,
        ...manifest,
        manifestBytes: bytes,
        generatedInMs: Date.now() - sizeBefore,
      },
      null,
      2,
    ),
  );
}
