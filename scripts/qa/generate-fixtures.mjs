#!/usr/bin/env node
/**
 * Deterministic, licence-clean fixture generator for the
 * Yet Another Warhammer Mod Manager QA suite.
 *
 * Everything this script writes is synthetic. No game data, no user mods and no
 * Workshop downloads are involved.
 *
 * Modes
 *   --write                 regenerate the committed fixtures under `fixtures/`
 *   --verify                re-hash every committed data fixture against manifest.json
 *   --scale DIR [--count N] [--force]
 *                           write an N-pack synthetic WH3 layout (not committed);
 *                           refuses repo/home/ancestor targets and non-empty
 *                           directories unless they are previous --scale output
 *                           or --force is given
 *
 * The synthetic PFH5 header and packed-file index use this layout:
 *
 *   offset  size  field
 *        0     4  magic "PFH5"
 *        4     4  byte mask (0x40 = filename hash per index entry, 4 = movie)
 *        8     4  reserved (written as 0)
 *       12     4  dependency index size in bytes
 *       16     4  packed-file count
 *       20     4  packed-file index size in bytes
 *       24     4  timestamp (seconds, informational)
 *       28     -  dependency index (UTF-8 names, NUL separated)
 *        -     -  packed-file index
 *        -     -  file payloads
 *
 * Packed-file index entry:
 *   u32 size, [u32 filename hash when byteMask & 0x40], u8 compressed flag,
 *   UTF-8 name, NUL
 *
 * Usage:
 *   node scripts/qa/generate-fixtures.mjs --write
 *   node scripts/qa/generate-fixtures.mjs --verify
 *   node scripts/qa/generate-fixtures.mjs --scale /tmp/wh3-scale-500 --count 500
 *   node scripts/qa/generate-fixtures.mjs --scale /tmp/wh3-scale-500 --count 500 --force
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import * as nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkScaleTarget } from './fixture-target.mjs'

const HERE = nodePath.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = nodePath.resolve(HERE, '..', '..')
const FIXTURES_DIR = nodePath.join(REPO_ROOT, 'fixtures')
const MANIFEST_PATH = nodePath.join(FIXTURES_DIR, 'manifest.json')

const PFH5_HEADER_BYTES = 28
const FILENAME_HASH_MASK = 0x40
const FIXED_TIMESTAMP = 1_760_000_000
const SCALE_SEED = 20261021
const SCALE_DIGEST_SCHEMA = 'wh3mm.qa.scale-index.v1'

const args = process.argv.slice(2)
const hasFlag = (name) => args.includes(`--${name}`)
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

function fail(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

/** Deterministic xorshift32: same seed, same bytes on every machine. */
function makeRandom(seed) {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x100000000
  }
}

function fnv1a32(text) {
  let hash = 0x811c9dc5
  for (const byte of Buffer.from(text, 'utf8')) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Builds a PFH5 pack. Deliberate corruptions are parameterised so every
 * malformed fixture has exactly one documented defect.
 */
function buildPack({
  byteMask = 3,
  files = [],
  dependencies = [],
  timestamp = FIXED_TIMESTAMP,
  badMagic = false,
  truncateTo = null,
  declaredDependencySize = null,
  declaredFileCount = null,
  declaredIndexSize = null,
  omitNameTerminator = false,
}) {
  const dependencyIndex = Buffer.concat(dependencies.map((name) => Buffer.from(`${name}\0`, 'utf8')))
  const indexParts = []
  for (const file of files) {
    const size = Buffer.alloc(4)
    size.writeUInt32LE(file.data.length, 0)
    indexParts.push(size)
    if (byteMask & FILENAME_HASH_MASK) {
      const hash = Buffer.alloc(4)
      hash.writeUInt32LE(fnv1a32(file.name), 0)
      indexParts.push(hash)
    }
    indexParts.push(Buffer.from([file.compressed ? 1 : 0]), Buffer.from(file.name, 'utf8'))
    if (!omitNameTerminator) indexParts.push(Buffer.from([0]))
  }
  const packedFileIndex = Buffer.concat(indexParts)

  const header = Buffer.alloc(PFH5_HEADER_BYTES)
  header.write(badMagic ? 'PFH4' : 'PFH5', 0, 'ascii')
  header.writeUInt32LE(byteMask >>> 0, 4)
  header.writeUInt32LE(0, 8)
  header.writeUInt32LE(declaredDependencySize ?? dependencyIndex.length, 12)
  header.writeUInt32LE(declaredFileCount ?? files.length, 16)
  header.writeUInt32LE(declaredIndexSize ?? packedFileIndex.length, 20)
  header.writeUInt32LE(timestamp >>> 0, 24)

  const buffer = Buffer.concat([header, dependencyIndex, packedFileIndex, ...files.map((file) => file.data)])
  return truncateTo === null ? buffer : buffer.subarray(0, truncateTo)
}

function payload(text, minimum = 0) {
  const data = Buffer.from(text, 'utf8')
  if (data.length >= minimum) return data
  return Buffer.concat([data, Buffer.alloc(minimum - data.length, 0x20)])
}

/**
 * Independent reader used by --verify. It shares the format constants with the
 * writer but walks the bytes separately, so a writer bug that changes sizes is
 * caught by the committed fixtures rather than hidden.
 */
function parsePack(buffer) {
  if (buffer.length < PFH5_HEADER_BYTES) return { ok: false, reason: 'header_truncated' }
  const magic = buffer.toString('ascii', 0, 4)
  if (magic !== 'PFH5') return { ok: false, reason: `bad_magic:${magic}` }

  const byteMask = buffer.readUInt32LE(4)
  const dependencySize = buffer.readUInt32LE(12)
  const fileCount = buffer.readUInt32LE(16)
  const indexSize = buffer.readUInt32LE(20)
  const dataStart = PFH5_HEADER_BYTES + dependencySize + indexSize
  if (dataStart > buffer.length) return { ok: false, reason: 'declared_regions_past_eof' }

  const dependencyIndex = buffer.subarray(PFH5_HEADER_BYTES, PFH5_HEADER_BYTES + dependencySize)
  const dependencies = dependencyIndex
    .toString('utf8')
    .split('\0')
    .filter((name) => name.length > 0)

  const index = buffer.subarray(PFH5_HEADER_BYTES + dependencySize, dataStart)
  const hasHash = (byteMask & FILENAME_HASH_MASK) !== 0
  const files = []
  let position = 0
  let payloadOffset = dataStart
  for (let entry = 0; entry < fileCount; entry += 1) {
    if (position + 4 > index.length) return { ok: false, reason: `entry_${entry}_size_truncated` }
    const size = index.readUInt32LE(position)
    position += 4
    if (hasHash) {
      if (position + 4 > index.length) return { ok: false, reason: `entry_${entry}_hash_truncated` }
      position += 4
    }
    if (position + 1 > index.length) return { ok: false, reason: `entry_${entry}_flag_truncated` }
    const compressed = index[position] === 1
    position += 1
    const nameEnd = index.indexOf(0, position)
    if (nameEnd === -1) return { ok: false, reason: `entry_${entry}_name_unterminated` }
    const name = index.toString('utf8', position, nameEnd)
    position = nameEnd + 1
    payloadOffset += size
    if (payloadOffset > buffer.length) return { ok: false, reason: `entry_${entry}_payload_past_eof` }
    files.push({ name, size, compressed })
  }
  if (position !== index.length) return { ok: false, reason: 'index_trailing_bytes' }
  if (payloadOffset !== buffer.length) return { ok: false, reason: 'payload_length_mismatch' }
  return { ok: true, byteMask, dependencies, files, dataStart }
}

function expectOk(buffer, label) {
  const parsed = parsePack(buffer)
  if (!parsed.ok) fail(`${label}: expected a valid pack, got ${parsed.reason}`)
  return parsed
}

function expectRejected(buffer, reasonPrefix, label) {
  const parsed = parsePack(buffer)
  if (parsed.ok) fail(`${label}: expected rejection (${reasonPrefix}), but the pack parsed`)
  if (!parsed.reason.startsWith(reasonPrefix)) {
    fail(`${label}: expected rejection ${reasonPrefix}, got ${parsed.reason}`)
  }
  return parsed
}

const UNICODE_NAMES = ['mod_ñandú', 'mod_日本語_騎兵', 'mod_über_artillerie', 'mod_кирасиры']
const UNICODE_INTERNAL = ['db\\qa\\ñandú.txt', 'text\\db\\日本語.loc', 'db\\qa\\über.txt', 'db\\qa\\кирасиры.txt']

/** The committed pack fixtures. Each entry is self-checked before it is written. */
function committedPacks() {
  const minimal = buildPack({
    byteMask: 3,
    files: [{ name: 'db\\qa\\minimal.txt', data: payload('minimal fixture\n', 64) }],
  })
  const parsedMinimal = expectOk(minimal, 'valid_minimal')
  if (parsedMinimal.files.length !== 1 || parsedMinimal.files[0].name !== 'db\\qa\\minimal.txt') {
    fail('valid_minimal: unexpected index content')
  }

  const multi = buildPack({
    byteMask: 3,
    files: [
      { name: 'db\\qa\\a.txt', data: payload('a\n', 32) },
      { name: 'db\\qa\\b.txt', data: payload('b\n', 48), compressed: true },
      { name: 'script\\qa\\c.lua', data: payload('return 1\n', 80) },
    ],
  })
  const parsedMulti = expectOk(multi, 'valid_multi')
  if (parsedMulti.files.length !== 3 || parsedMulti.files[1].compressed !== true) {
    fail('valid_multi: expected three entries with the middle one compressed')
  }

  const unicode = buildPack({
    byteMask: 3,
    timestamp: FIXED_TIMESTAMP + 1,
    files: UNICODE_INTERNAL.map((name, index) => ({
      name,
      data: payload(`unicode fixture ${UNICODE_NAMES[index]}\n`, 40),
    })),
  })
  const parsedUnicode = expectOk(unicode, 'valid_unicode')
  if (!parsedUnicode.files.every((file) => /[^\x00-\x7f]/.test(file.name))) {
    fail('valid_unicode: every internal name must be non-ASCII')
  }

  const withDeps = buildPack({
    byteMask: 3,
    timestamp: FIXED_TIMESTAMP + 2,
    dependencies: ['data.pack', 'wh_main_placeholder.pack'],
    files: [{ name: 'db\\qa\\dependent.txt', data: payload('dependent fixture\n', 72) }],
  })
  const parsedDeps = expectOk(withDeps, 'valid_with_deps')
  if (parsedDeps.dependencies.join('|') !== 'data.pack|wh_main_placeholder.pack') {
    fail('valid_with_deps: dependency list did not round-trip')
  }

  const movie = buildPack({
    byteMask: 4,
    timestamp: FIXED_TIMESTAMP + 3,
    files: [{ name: 'movies\\qa_intro.usm', data: payload('synthetic movie payload\n', 96) }],
  })
  const parsedMovie = expectOk(movie, 'valid_movie')
  if (parsedMovie.byteMask !== 4) fail('valid_movie: byte mask must be 4')

  const hashed = buildPack({
    byteMask: FILENAME_HASH_MASK | 3,
    timestamp: FIXED_TIMESTAMP + 4,
    files: [
      { name: 'db\\qa\\hashed_a.txt', data: payload('hashed a\n', 40) },
      { name: 'db\\qa\\hashed_b.txt', data: payload('hashed b\n', 56) },
    ],
  })
  const parsedHashed = expectOk(hashed, 'valid_hashed')
  if (parsedHashed.files.length !== 2) fail('valid_hashed: expected two entries')

  const malformed = {
    'malformed_bad_magic.pack': {
      buffer: buildPack({
        files: [{ name: 'db\\qa\\x.txt', data: payload('x\n') }],
        badMagic: true,
      }),
      reason: 'bad_magic',
    },
    'malformed_truncated_header.pack': {
      buffer: buildPack({
        files: [{ name: 'db\\qa\\x.txt', data: payload('x\n') }],
        truncateTo: 12,
      }),
      reason: 'header_truncated',
    },
    'malformed_oversized_dependency_header.pack': {
      buffer: buildPack({
        files: [{ name: 'db\\qa\\x.txt', data: payload('x\n') }],
        declaredDependencySize: 0xffffff00,
      }),
      reason: 'declared_regions_past_eof',
    },
    'malformed_oversized_file_index.pack': {
      buffer: buildPack({
        files: [{ name: 'db\\qa\\x.txt', data: payload('x\n') }],
        declaredIndexSize: 0x7fffffff,
      }),
      reason: 'declared_regions_past_eof',
    },
    'malformed_count_mismatch.pack': {
      buffer: buildPack({
        files: [{ name: 'db\\qa\\x.txt', data: payload('x\n') }],
        declaredFileCount: 4096,
      }),
      reason: 'entry_1_size_truncated',
    },
    'malformed_unterminated_name.pack': {
      buffer: buildPack({
        files: [{ name: 'db\\qa\\x.txt', data: payload('x\n') }],
        omitNameTerminator: true,
      }),
      reason: 'entry_0_name_unterminated',
    },
    'malformed_empty.pack': {
      buffer: Buffer.alloc(0),
      reason: 'header_truncated',
    },
  }

  for (const [name, entry] of Object.entries(malformed)) {
    expectRejected(entry.buffer, entry.reason, name)
    if (entry.buffer.length > 4096) fail(`${name}: malformed fixture should stay small`)
  }

  return { minimal, multi, unicode, withDeps, movie, hashed, malformed }
}

const LIBRARY_FOLDERS = `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"label"		""
		"contentid"		"0"
		"totalsize"		"0"
		"update_clean_bytes_tally"		"0"
		"time_last_update_corruption"		"0"
		"apps"
		{
			"228980"		"0"
			"1142710"		"73400320000"
		}
	}
	"1"
	{
		"path"		"D:\\\\SteamLibrary"
		"label"		""
		"contentid"		"1234567890123456789"
		"totalsize"		"1000000000000"
		"update_clean_bytes_tally"		"0"
		"time_last_update_corruption"		"0"
		"apps"
		{
			"228980"		"0"
		}
	}
	"2"
	{
		"path"		"E:\\\\UnpluggedLibrary"
		"label"		""
		"contentid"		"0"
		"totalsize"		"0"
		"update_clean_bytes_tally"		"0"
		"time_last_update_corruption"		"0"
		"apps"
		{
		}
	}
}
`

const LIBRARY_FOLDERS_FLATPAK = `"libraryfolders"
{
	"0"
	{
		"path"		"/home/steam/.local/share/Steam"
		"apps"
		{
			"1142710"		"73400320000"
		}
	}
	"1"
	{
		"path"		"/home/steam/.var/app/com.valvesoftware.Steam/.local/share/Steam"
		"apps"
		{
			"228980"		"0"
		}
	}
}
`

const LIBRARY_FOLDERS_MALFORMED = `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"apps"
		{
			"1142710"		"73400320000"
`

const APP_MANIFEST_WH3 = `"AppState"
{
	"appid"		"1142710"
	"Universe"		"1"
	"name"		"Total War: WARHAMMER III"
	"StateFlags"		"4"
	"installdir"		"Warhammer3"
	"LastUpdated"		"1759000000"
	"SizeOnDisk"		"73400320000"
	"buildid"		"18000000"
	"LastPlayed"		"1760000000"
	"UserConfig"
	{
		"language"		"english"
	}
	"MountedDepots"
	{
		"1142711"		"1234567890123456789"
	}
}
`

const APP_WORKSHOP_WH3 = `"AppWorkshop"
{
	"appid"		"1142710"
	"SizeOnDisk"		"5368709120"
	"NeedsUpdate"		"0"
	"NeedsDownload"		"0"
	"TimeLastUpdated"		"1759000000"
	"TimeLastAppRan"		"1760000000"
	"WorkshopItemsInstalled"
	{
		"2858184271"
		{
			"size"		"73400320"
			"timeupdated"		"1759000000"
			"manifest"		"1234567890123456789"
		}
		"2927296206"
		{
			"size"		"10485760"
			"timeupdated"		"1758000000"
			"manifest"		"9876543210987654321"
		}
	}
	"WorkshopItemDetails"
	{
		"2858184271"
		{
			"manifest"		"1234567890123456789"
			"timeupdated"		"1759000000"
			"timetouched"		"1759000000"
			"subscribedby"
			{
				"76561198000000000"		"1759000000"
			}
		}
		"2927296206"
		{
			"manifest"		"9876543210987654321"
			"timeupdated"		"1758000000"
			"timetouched"		"1758000000"
			"subscribedby"
			{
				"76561198000000000"		"1758000000"
			}
		}
	}
}
`

const APP_WORKSHOP_EMPTY = `"AppWorkshop"
{
	"appid"		"1142710"
	"SizeOnDisk"		"0"
	"NeedsUpdate"		"0"
	"NeedsDownload"		"0"
	"WorkshopItemsInstalled"
	{
	}
}
`

const USED_MODS_VALID = [
  'mod "mod_a.pack";',
  'mod "mod_b.pack";',
  'mod "mod with spaces.pack";',
  'mod "mod_ñandú.pack";',
  '',
].join('\n')

const USED_MODS_UNKNOWN_DIRECTIVE = [
  'custom_directive "C:\\Games\\Steam\\steamapps\\common\\Warhammer3\\data";',
  'mod "mod_a.pack";',
  'another_unknown_directive "value";',
  'mod "mod_b.pack";',
  '',
].join('\n')

const USED_MODS_WORKING_DIRECTORY = [
  'add_working_directory "C:\\Games\\Steam\\steamapps\\workshop\\content\\1142710\\2858184271";',
  'mod "mod_a.pack";',
  'mod "mod_b.pack";',
  '',
].join('\n')

const USED_MODS_DUPLICATES = [
  'mod "mod_a.pack";',
  'mod "Mod_A.pack";',
  'mod "MOD_A.PACK";',
  'mod "mod_b.pack";',
  'mod "mod_b.pack";',
  '',
].join('\n')

const USED_MODS_CORRUPT = [
  'mod "unterminated.pack;',
  'mod mod_without_quotes.pack;',
  'garbage line with no directive',
  'mod "ok.pack";',
  '',
].join('\n')

const CONFIG_VALID = {
  schemaVersion: 1,
  paths: { gamePathOverride: null },
  ui: { density: 'comfortable', showThumbnails: true, lastScrollTop: 0, zoom: 100 },
  window: null,
  activeProfileId: 'b0f4e7f0-3a55-4b8e-9d4a-8a2f6f4b1c21',
  profiles: [
    {
      id: 'b0f4e7f0-3a55-4b8e-9d4a-8a2f6f4b1c21',
      name: 'Default',
      enabledModIds: [
        'c:/steam/steamapps/workshop/content/1142710/2858184271/mod_a.pack',
        'c:/steam/steamapps/common/Warhammer3/data/mod_b.pack',
      ],
      createdAt: '2026-10-20T14:00:00Z',
      updatedAt: '2026-10-20T14:00:00Z',
    },
  ],
  tags: [{ id: '0d1f8e2a-4c7b-4f0e-8a3d-2b6c9e5f7a11', name: 'Overhaul', color: '#c9a227' }],
  modTags: {
    'c:/steam/steamapps/workshop/content/1142710/2858184271/mod_a.pack': [
      '0d1f8e2a-4c7b-4f0e-8a3d-2b6c9e5f7a11',
    ],
  },
  launchOptions: {},
}

const CONFIG_FUTURE = { ...CONFIG_VALID, schemaVersion: 2 }

const CONFIG_UNKNOWN_FIELDS = {
  ...CONFIG_VALID,
  experimental: { removedFeature: true },
  profiles: [...CONFIG_VALID.profiles, { id: 'not-a-uuid', name: '', enabledModIds: 'nope' }],
}

function committedTextFixtures() {
  return {
    'steam/libraryfolders.vdf': LIBRARY_FOLDERS,
    'steam/libraryfolders_flatpak.vdf': LIBRARY_FOLDERS_FLATPAK,
    'steam/libraryfolders_malformed.vdf': LIBRARY_FOLDERS_MALFORMED,
    'steam/appmanifest_1142710.acf': APP_MANIFEST_WH3,
    'steam/appworkshop_1142710.acf': APP_WORKSHOP_WH3,
    'steam/appworkshop_1142710_empty.acf': APP_WORKSHOP_EMPTY,
    'load_order/used_mods_valid.txt': USED_MODS_VALID,
    'load_order/used_mods_crlf.txt': USED_MODS_VALID.replaceAll('\n', '\r\n'),
    'load_order/used_mods_bom.txt': `\ufeff${USED_MODS_VALID}`,
    'load_order/used_mods_empty.txt': '',
    'load_order/used_mods_unknown_directive.txt': USED_MODS_UNKNOWN_DIRECTIVE,
    'load_order/used_mods_working_directory.txt': USED_MODS_WORKING_DIRECTORY,
    'load_order/used_mods_duplicates.txt': USED_MODS_DUPLICATES,
    'load_order/used_mods_corrupt.txt': USED_MODS_CORRUPT,
    'load_order/used_mods_no_final_newline.txt': USED_MODS_VALID.trimEnd(),
    'config/config_valid.json': `${JSON.stringify(CONFIG_VALID, null, 2)}\n`,
    'config/config_future_version.json': `${JSON.stringify(CONFIG_FUTURE, null, 2)}\n`,
    'config/config_unknown_fields.json': `${JSON.stringify(CONFIG_UNKNOWN_FIELDS, null, 2)}\n`,
    'config/config_corrupt.json': '{\n  "schemaVersion": 1,\n  "profiles": [ { "id": "broken"\n',
    'config/config_truncated.json': '{"schemaVersion":1,"paths":',
  }
}

/**
 * Deterministic 500-entry index for frontend scale tests. No binary packs are
 * committed for this; the Rust scale path is generated by --scale.
 */
function buildScaleIndex(count) {
  const random = makeRandom(SCALE_SEED)
  const mods = []
  for (let index = 0; index < count; index += 1) {
    const isWorkshop = index % 3 === 0
    const variant = index % 17 === 0 ? 'malformed' : index % 5 === 0 ? 'unicode' : 'valid'
    const stem =
      variant === 'unicode'
        ? `${UNICODE_NAMES[index % UNICODE_NAMES.length]}_${String(index).padStart(4, '0')}`
        : `qa_scale_${String(index).padStart(4, '0')}`
    const name = `${stem}.pack`
    const workshopId = isWorkshop ? String(2_800_000_000 + index) : null
    const directory = isWorkshop
      ? `c:/steam/steamapps/workshop/content/1142710/${workshopId}`
      : 'c:/steam/steamapps/common/Warhammer3/data'
    mods.push({
      id: `${directory}/${name}`.toLowerCase(),
      name,
      humanName: variant === 'unicode' ? `${UNICODE_NAMES[index % UNICODE_NAMES.length]} ${index}` : `QA Scale Mod ${index}`,
      isWorkshop,
      workshopId,
      isEnabled: index % 4 !== 3,
      loadOrder: index,
      tags: index % 6 === 0 ? ['overhaul'] : [],
      updatedAt: new Date(FIXED_TIMESTAMP * 1000 + index * 60_000).toISOString(),
      variant,
      sizeBytes: 512 + Math.floor(random() * 8192),
    })
  }
  return {
    schema: SCALE_DIGEST_SCHEMA,
    seed: SCALE_SEED,
    count,
    digest: sha256(JSON.stringify(mods)),
    mods,
  }
}

function verifyTextFixtures(textFixtures) {
  if (!USED_MODS_VALID.endsWith('\n')) fail('used_mods_valid.txt must end with a newline')
  if (!USED_MODS_VALID.replaceAll('\n', '\r\n').includes('\r\n')) fail('CRLF variant was not generated')
  if (!USED_MODS_CORRUPT.includes('unterminated')) fail('corrupt used_mods fixture lost its defect')
  if (JSON.parse(JSON.stringify(CONFIG_VALID)).schemaVersion !== 1) fail('valid config must be schema v1')
  if (CONFIG_FUTURE.schemaVersion !== 2) fail('future config must be schema v2')
  if (Object.keys(textFixtures).length < 18) fail('expected at least 18 text fixtures')
}

async function writeCommitted() {
  const packs = committedPacks()
  const textFixtures = committedTextFixtures()
  verifyTextFixtures(textFixtures)

  const files = new Map()
  files.set('packs/valid_minimal.pack', packs.minimal)
  files.set('packs/valid_multi.pack', packs.multi)
  files.set('packs/valid_unicode.pack', packs.unicode)
  files.set('packs/valid_with_deps.pack', packs.withDeps)
  files.set('packs/valid_movie.pack', packs.movie)
  files.set('packs/valid_hashed.pack', packs.hashed)
  for (const [name, entry] of Object.entries(packs.malformed)) {
    files.set(`packs/${name}`, entry.buffer)
  }
  for (const [name, text] of Object.entries(textFixtures)) {
    files.set(name, Buffer.from(text, 'utf8'))
  }

  const scaleIndex = buildScaleIndex(500)
  files.set('scale/index-500.json', Buffer.from(`${JSON.stringify(scaleIndex, null, 2)}\n`, 'utf8'))

  for (const relative of [...files.keys()]) {
    const absolute = nodePath.join(FIXTURES_DIR, relative)
    await mkdir(nodePath.dirname(absolute), { recursive: true })
    await writeFile(absolute, files.get(relative))
  }

  const manifest = {}
  for (const [relative, buffer] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    manifest[relative] = { sha256: sha256(buffer), bytes: buffer.length }
  }
  await writeFile(MANIFEST_PATH, `${JSON.stringify({ schema: 'wh3mm.qa.fixtures.v1', files: manifest }, null, 2)}\n`)

  let total = 0
  for (const entry of Object.values(manifest)) total += entry.bytes
  console.log(`wrote ${Object.keys(manifest).length} fixtures (${total} bytes) to ${nodePath.relative(REPO_ROOT, FIXTURES_DIR)}/`)
}

async function listFiles(directory, prefix = '') {
  const entries = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      entries.push(...(await listFiles(nodePath.join(directory, entry.name), relative)))
    } else if (entry.isFile()) {
      entries.push(relative)
    }
  }
  return entries.sort()
}

async function verifyCommitted() {
  let manifest
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
  } catch (error) {
    fail(`cannot read fixtures/manifest.json (${error.message}); run --write`)
  }
  if (manifest.schema !== 'wh3mm.qa.fixtures.v1') fail(`unexpected manifest schema ${manifest.schema}`)

  const files = await listFiles(FIXTURES_DIR)
  const dataFiles = files.filter((file) => file !== 'manifest.json' && !file.endsWith('.md'))
  const expected = Object.keys(manifest.files).sort()
  if (dataFiles.length !== expected.length) {
    fail(`fixture count drift: ${dataFiles.length} files on disk, ${expected.length} in manifest`)
  }
  for (const relative of dataFiles) {
    if (!expected.includes(relative)) fail(`unlisted fixture on disk: ${relative}`)
  }

  for (const relative of expected) {
    const buffer = await readFile(nodePath.join(FIXTURES_DIR, relative))
    const entry = manifest.files[relative]
    if (buffer.length !== entry.bytes) fail(`${relative}: size ${buffer.length}, manifest says ${entry.bytes}`)
    const digest = sha256(buffer)
    if (digest !== entry.sha256) fail(`${relative}: sha256 ${digest}, manifest says ${entry.sha256}`)
  }

  for (const relative of Object.keys(manifest.files)) {
    if (!relative.startsWith('packs/')) continue
    const buffer = await readFile(nodePath.join(FIXTURES_DIR, relative))
    if (relative.includes('malformed_')) {
      if (parsePack(buffer).ok) fail(`${relative}: malformed fixture parsed as valid`)
    } else if (!parsePack(buffer).ok) {
      fail(`${relative}: valid fixture rejected: ${parsePack(buffer).reason}`)
    }
  }

  const scale = JSON.parse(await readFile(nodePath.join(FIXTURES_DIR, 'scale/index-500.json'), 'utf8'))
  if (scale.schema !== SCALE_DIGEST_SCHEMA) fail(`scale index schema ${scale.schema}`)
  if (scale.mods.length !== scale.count) fail(`scale index has ${scale.mods.length} mods, expected ${scale.count}`)
  if (sha256(JSON.stringify(scale.mods)) !== scale.digest) fail('scale index digest mismatch')

  console.log(`verified ${expected.length} fixtures and the ${scale.count}-mod scale index`)
}

function buildScalePack(variant, index, random) {
  const payloadSize = 512 + Math.floor(random() * 8192)
  const files = [
    {
      name: `db\\qa\\scale_${String(index).padStart(4, '0')}.txt`,
      data: payload(`scale variant=${variant} index=${index}\n`, payloadSize),
    },
  ]
  if (variant === 'unicode') {
    files.push({
      name: UNICODE_INTERNAL[index % UNICODE_INTERNAL.length],
      data: payload(`unicode ${index}\n`, 64 + Math.floor(random() * 256)),
    })
  }
  if (variant === 'valid' && index % 13 === 0) {
    files.push({
      name: `variantmeshes\\qa\\mesh_${index}.rigid_model_v2`,
      data: Buffer.alloc(2048, index & 0xff),
    })
  }
  const buffer = buildPack({
    byteMask: index % 19 === 0 ? FILENAME_HASH_MASK | 3 : 3,
    files,
    dependencies: index % 23 === 0 ? ['data.pack'] : [],
    timestamp: FIXED_TIMESTAMP + index,
  })
  if (variant !== 'malformed') {
    expectOk(buffer, `scale_${index}`)
    return buffer
  }
  const kind = index % 4
  if (kind === 0) return buffer.subarray(0, 12)
  if (kind === 1) {
    const broken = Buffer.from(buffer)
    broken.write('PFH4', 0, 'ascii')
    return broken
  }
  if (kind === 2) {
    const broken = Buffer.from(buffer)
    broken.writeUInt32LE(0x7fffffff, 20)
    return broken
  }
  return Buffer.alloc(0)
}

async function writeScale(directory, count) {
  const random = makeRandom(SCALE_SEED)
  if (count < 1 || count > 20000) fail('--count must be between 1 and 20000')
  await rm(directory, { recursive: true, force: true })
  const dataDir = nodePath.join(directory, 'data')
  const contentRoot = nodePath.join(directory, 'content', '1142710')
  await mkdir(dataDir, { recursive: true })
  await mkdir(contentRoot, { recursive: true })

  await writeFile(
    nodePath.join(dataDir, 'data.pack'),
    buildPack({ files: [{ name: 'db\\vanilla\\data__', data: Buffer.alloc(256, 0x11) }], timestamp: FIXED_TIMESTAMP }),
  )
  await writeFile(nodePath.join(dataDir, 'manifest.txt'), 'data.pack\n\ndb.pack\nui.pack\nlocal_en.pack\n', 'utf8')

  const variants = { valid: 0, unicode: 0, malformed: 0, duplicate: 0 }
  const entries = []
  const duplicatePairs = Math.min(8, Math.floor(count / 20))
  for (let duplicate = 0; duplicate < duplicatePairs; duplicate += 1) {
    const name = `qa_duplicate_${String(duplicate).padStart(2, '0')}.pack`
    const buffer = buildScalePack('valid', duplicate, random)
    await writeFile(nodePath.join(dataDir, name), buffer)
    const workshopId = String(2_900_000_000 + duplicate)
    const workshopDir = nodePath.join(contentRoot, workshopId)
    await mkdir(workshopDir, { recursive: true })
    await writeFile(nodePath.join(workshopDir, name), buffer)
    entries.push({ variant: 'duplicate', path: `data/${name}`, sha256: sha256(buffer) })
    entries.push({ variant: 'duplicate', path: `content/1142710/${workshopId}/${name}`, sha256: sha256(buffer) })
    variants.duplicate += 2
  }

  for (let index = duplicatePairs * 2; index < count; index += 1) {
    const variant = index % 9 === 8 ? 'malformed' : index % 6 === 0 ? 'unicode' : 'valid'
    const name =
      variant === 'unicode'
        ? `${UNICODE_NAMES[index % UNICODE_NAMES.length]}_${String(index).padStart(4, '0')}.pack`
        : variant === 'malformed'
          ? `qa_malformed_${String(index).padStart(4, '0')}.pack`
          : `qa_scale_${String(index).padStart(4, '0')}.pack`
    const buffer = buildScalePack(variant, index, random)
    await writeFile(nodePath.join(dataDir, name), buffer)
    entries.push({ variant, path: `data/${name}`, sha256: sha256(buffer) })
    variants[variant] += 1
  }

  const digest = sha256(JSON.stringify(entries))
  await writeFile(
    nodePath.join(directory, 'fixture-manifest.json'),
    `${JSON.stringify({ schema: 'wh3mm.qa.scale-fixture.v1', seed: SCALE_SEED, count, digest, variants, entries }, null, 2)}\n`,
  )
  console.log(`wrote ${count} packs to ${directory}`)
  console.log(`variants: ${JSON.stringify(variants)}`)
  console.log(`digest:   ${digest}`)
}

async function main() {
  if (hasFlag('write')) {
    await writeCommitted()
    await verifyCommitted()
    return
  }
  if (hasFlag('verify')) {
    await verifyCommitted()
    return
  }
  if (hasFlag('scale')) {
    const directory = argValue('scale', null)
    if (!directory || directory.startsWith('--')) fail('--scale needs an output directory')
    const target = checkScaleTarget(nodePath.resolve(directory), {
      repoRoot: REPO_ROOT,
      force: hasFlag('force'),
    })
    if (!target.ok) fail(target.reason)
    const count = Number(argValue('count', '500'))
    await writeScale(target.path, count)
    return
  }
  console.log(
    'usage: node scripts/qa/generate-fixtures.mjs [--write|--verify|--scale DIR [--count N] [--force]]',
  )
  process.exitCode = 1
}

try {
  const stats = await stat(HERE)
  if (!stats.isDirectory()) throw new Error('unreachable')
} catch {
  fail(`script directory does not exist: ${HERE}`)
}

await main()
