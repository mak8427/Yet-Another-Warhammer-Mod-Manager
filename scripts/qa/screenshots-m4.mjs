import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Capture the WAR-10 M4 evidence set from a production build with deterministic
 * mock IPC. Requires `pnpm build` first.
 *
 *   CHROME_PATH=/path/to/chrome node scripts/qa/screenshots-m4.mjs
 *
 * Writes PNGs under docs/screenshots/WAR-10 and prints the bounded-row
 * measurements used in the M4 evidence record.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DIST = join(ROOT, 'frontend/dist')
const OUT = process.env.SHOT_OUT
  ? resolve(ROOT, process.env.SHOT_OUT)
  : join(ROOT, 'docs/screenshots/WAR-10')
const ONLY = (process.env.SHOT_ONLY ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)
const CHROME =
  process.env.CHROME_PATH ??
  ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((path) =>
    existsSync(path),
  )

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

function startStatic() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    let file = join(DIST, decodeURIComponent(url.pathname))
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
    res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream')
    createReadStream(file).pipe(res)
  })
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => resolveServer({ server, port: server.address().port }))
  })
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 0
    this.pending = new Map()
    this.handlers = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
        return
      }
      for (const handler of this.handlers.get(message.method) ?? []) handler(message.params)
    })
  }
  send(method, params = {}) {
    return new Promise((resolveSend, reject) => {
      const id = ++this.nextId
      this.pending.set(id, { resolve: resolveSend, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  waitFor(method, timeout = 15000) {
    return new Promise((resolveEvent, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout)
      const handler = (params) => {
        clearTimeout(timer)
        this.handlers.get(method).delete(handler)
        resolveEvent(params)
      }
      if (!this.handlers.has(method)) this.handlers.set(method, new Set())
      this.handlers.get(method).add(handler)
    })
  }
}

async function launchChrome() {
  const probe = createServer()
  await new Promise((resolveProbe) => probe.listen(0, '127.0.0.1', resolveProbe))
  const port = probe.address().port
  await new Promise((resolveProbe) => probe.close(resolveProbe))
  const userDataDir = `/tmp/war10-shot/chrome-${port}`
  mkdirSync(userDataDir, { recursive: true })
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return { child, port }
    } catch {}
    await delay(200)
  }
  child.kill()
  throw new Error('Chromium did not expose a debugging port')
}

// Optional installed artwork for the README only. Keep default QA captures
// deterministic and do not copy the user's Workshop files into the repository.
const WORKSHOP_ART = process.env.SHOT_WORKSHOP_DIR
  ? readdirSync(process.env.SHOT_WORKSHOP_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap((entry) => {
        const folder = join(process.env.SHOT_WORKSHOP_DIR, entry.name)
        const files = readdirSync(folder).sort()
        const pack = files.find((file) => file.endsWith('.pack'))
        const artwork = files.find((file) => /\.(png|jpe?g|webp)$/i.test(file))
        if (!pack || !artwork) return []
        const bytes = readFileSync(join(folder, artwork))
        if (bytes.length > 2 * 1024 * 1024) return []
        const extension = extname(artwork).toLowerCase()
        const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
        return [{ pack, workshopId: entry.name, image: `data:${mime};base64,${bytes.toString('base64')}` }]
      })
      .slice(0, 63)
  : []

function fixtureScript() {
  const tags = [
    { id: 'tag-overhaul', name: 'Overhaul', color: '#C9A227' },
    { id: 'tag-visual', name: 'Visual', color: '#6F8F4A' },
    { id: 'tag-campaign', name: 'Campaign', color: '#9B3A3A' },
    { id: 'tag-ui', name: 'Interface', color: '#4F7FA8' },
    { id: 'tag-audio', name: 'Audio', color: '#8C6FA8' },
    { id: 'tag-lore', name: 'Lore', color: '#3F8C74' },
  ]

  const names = [
    'The Old World Campaign Overhaul',
    'Loreful Legendary Lords',
    'Better Camera Mod',
    'SFO: Grimhammer III — The Imperial Campaign, Part One',
    'Unit Cards — Reforged in Blood and Gold',
    'Karaz Ankor Runesmiths',
    'Brutal Battles: Realistic Combat, Morale, and Charge Physics for Total War',
    '阿兹汗与古墓王军团扩展包',
    'High Resolution UI Overhaul',
    'Recruit Defeated Legendary Lords',
    'Immortal Empires Map Expansion',
    'Chaos Realms of Ruin',
    'Thrones of Decay Unit Pack',
    'Grand Cathay Caravan Routes',
    'Kislev Ice Court Rework',
    'Vampire Counts Bloodlines',
    'Skaven Under-Empire Rework',
    'Bretonnia Chivalry Overhaul',
    'Dwarfen Forge and Runes',
    'Empire State Troops',
    'Norsca Monster Hunt',
    'Tzeentch Changing of the Ways',
    'Khorne Skull Throne Mechanics',
    'Slaanesh Seduction Rework',
    'Nurgle Plague Garden',
    'Wood Elves Worldroots',
    'Beastmen Herdstones',
    'Tomb Kings Dynasties',
    'Lizardmen Geomantic Web',
    'Dark Elves Slave Economy',
    'High Elves Influence Rework',
    'Greenskin Waaagh Tuning',
    'Ogre Kingdoms Camp Rework',
    'Warriors of Chaos Warband',
    'Cathay Harmony Rework',
    'Daemons of Chaos Undivided',
    'Settlements and Provinces Redux',
    'Campaign Map Lighting',
    'Battlefield Weather Overhaul',
    'Magic Lore Rebalance',
    'Unique Lord Traits',
    'Legendary Hero Recruitment',
    'Faction Banners and Heraldry',
    'Diplomacy Options Expanded',
    'Trade Routes and Resources',
    'Siege Equipment Rework',
    'Naval Encounters',
    'Monster Hunter Contracts',
    'Quest Battle Rebalance',
    'Rite and Invocation Tuning',
    'Hero Skill Trees Expanded',
    'Unit Experience and Rank',
    'Garrison and Defence Rework',
    'Public Order and Corruption',
    'Economy and Upkeep Rework',
    'Character Voice Lines',
    'Soundtrack Extensions',
    'Loading Screen Art',
    'UI Scaling and Layout',
    'Battle Camera Presets',
    'Diplomatic Envoy',
    'Endgame Crisis Manager',
    'Victory Conditions Rework',
  ]

  const tagSets = [
    ['tag-overhaul', 'tag-campaign'],
    ['tag-overhaul'],
    ['tag-visual'],
    ['tag-overhaul', 'tag-lore'],
    ['tag-visual', 'tag-ui'],
    ['tag-campaign', 'tag-lore'],
    ['tag-overhaul', 'tag-visual'],
    ['tag-overhaul', 'tag-audio', 'tag-lore'],
    ['tag-ui'],
    ['tag-campaign'],
  ]

  const mods = names.map((humanName, index) => {
    const slug = humanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 42) || `pack_${index}`
    const enabled = index < 26
    return {
      id: `mod-${index}`,
      name: `${slug}.pack`,
      humanName,
      isWorkshop: index % 3 !== 0,
      workshopId: index % 3 !== 0 ? String(2800000000 + index) : null,
      isEnabled: enabled,
      loadOrder: enabled ? index : index,
      tags: tagSets[index % tagSets.length],
      updatedAt: new Date(Date.UTC(2026, 9, 20 - (index % 18), 12, 0, 0)).toISOString(),
      thumbnailPath: null,
      dependencies: index === 3 ? ['missing_lords.pack'] : [],
      packError: index === 45 ? 'Unexpected pack header size' : null,
      isMovie: index === 57,
      sizeBytes: 1024 * 1024 * (12 + index),
    }
  })

  if (WORKSHOP_ART.length) {
    for (const [index, mod] of mods.entries()) {
      const artwork = WORKSHOP_ART[index % WORKSHOP_ART.length]
      mod.name = artwork.pack
      mod.humanName = artwork.pack.replace(/\.pack$/, '').replace(/_/g, ' ')
      mod.isWorkshop = true
      mod.workshopId = artwork.workshopId
      mod.thumbnailPath = artwork.image
    }
  }

  const loadOrder = {
    path: 'C:/Steam/steamapps/common/Total War WARHAMMER III/used_mods.txt',
    present: true,
    corrupt: false,
    message: null,
    unreadable: null,
    modNames: mods.filter((mod) => mod.isEnabled).map((mod) => mod.name),
    resolvedModIds: mods.filter((mod) => mod.isEnabled).map((mod) => mod.id),
    missingNames: [],
    duplicates: [],
    unmanagedDirectives: [],
    backupAvailable: true,
  }

  const snapshot = {
    mods,
    enabledCount: 26,
    activeProfileId: 'profile-default',
    loadOrder,
    timings: { startupMs: 148, detectionMs: 22, scanMs: 96, loadOrderMs: 4, totalMs: 148 },
    warnings: [],
  }

  const profiles = {
    profiles: [
      {
        id: 'profile-default',
        name: 'Default',
        enabledModIds: mods.filter((mod) => mod.isEnabled).map((mod) => mod.id),
        createdAt: '2026-10-12T18:10:00Z',
        updatedAt: '2026-10-21T12:44:00Z',
      },
      {
        id: 'profile-campaign',
        name: 'Immortal Empires — Long Campaign',
        enabledModIds: mods.slice(0, 18).map((mod) => mod.id),
        createdAt: '2026-10-14T19:24:00Z',
        updatedAt: '2026-10-20T21:02:00Z',
      },
      {
        id: 'profile-mp',
        name: 'Multiplayer',
        enabledModIds: mods.slice(0, 4).map((mod) => mod.id),
        createdAt: '2026-10-16T20:02:00Z',
        updatedAt: '2026-10-19T18:31:00Z',
      },
      {
        id: 'profile-vanilla',
        name: 'Vanilla test',
        enabledModIds: [],
        createdAt: '2026-10-18T08:15:00Z',
        updatedAt: '2026-10-18T08:15:00Z',
      },
    ],
    activeProfileId: 'profile-default',
  }

  const conflicts = {
    conflicts: [
      {
        path: 'db/units_tables/units',
        winnerModId: 'mod-5',
        loserModIds: ['mod-4', 'mod-7'],
      },
      {
        path: 'db/unit_stats_land_tables/unit_stats_land',
        winnerModId: 'mod-0',
        loserModIds: ['mod-3'],
      },
      {
        path: 'script/campaign/mod/wh_main_campaign.lua',
        winnerModId: 'mod-2',
        loserModIds: ['mod-8'],
      },
    ],
    missingDependencies: [
      { modId: 'mod-3', missing: ['missing_lords.pack'] },
      { modId: 'mod-8', missing: ['sfo_core.pack', 'sfo_units.pack'] },
    ],
    duplicatePackNames: [
      { name: 'unit_cards_reforged.pack', modIds: ['mod-4', 'mod-14'] },
    ],
    disabledDependencies: [{ modId: 'mod-2', dependency: 'sfo_core.pack', providerModId: 'mod-3' }],
    shadowedBaseTables: [
      { modId: 'mod-0', path: 'db/units_tables/units', basePack: 'data.pack' },
    ],
    shadowedBaseTableCount: 1,
    modSummaries: [
      { modId: 'mod-0', name: 'the_old_world_campaign_overhaul.pack', overrides: 42, overriddenOn: 0, baseTableOverrides: 1, fileCount: 1284 },
      { modId: 'mod-2', name: 'better_camera_mod.pack', overrides: 3, overriddenOn: 0, baseTableOverrides: 0, fileCount: 12 },
      { modId: 'mod-3', name: 'sfo_grimhammer_iii_the_imperial_ca.pack', overrides: 0, overriddenOn: 7, baseTableOverrides: 0, fileCount: 2048 },
      { modId: 'mod-4', name: 'unit_cards_reforged_in_blood_and_gold.pack', overrides: 18, overriddenOn: 1, baseTableOverrides: 0, fileCount: 86 },
      { modId: 'mod-5', name: 'karaz_ankor_runesmiths.pack', overrides: 9, overriddenOn: 0, baseTableOverrides: 0, fileCount: 44 },
      { modId: 'mod-7', name: 'azhag_and_tomb_kings_legion_expansion.pack', overrides: 0, overriddenOn: 2, baseTableOverrides: 0, fileCount: 33 },
      { modId: 'mod-8', name: 'high_resolution_ui_overhaul.pack', overrides: 0, overriddenOn: 0, baseTableOverrides: 0, fileCount: 58 },
    ],
    warnings: ['2 dependencies are disabled'],
  }

  const workshop = [
    { workshopId: '2800000001', title: 'The Old World Campaign Overhaul', state: 'installed', updatedAt: '2026-10-19T08:12:00Z' },
    { workshopId: '2800000002', title: 'Loreful Legendary Lords', state: 'subscribed', updatedAt: '2026-10-18T14:40:00Z' },
    { workshopId: '2800000003', title: 'Better Camera Mod', state: 'installed', updatedAt: '2026-10-20T11:05:00Z' },
    { workshopId: '2800000004', title: 'SFO: Grimhammer III', state: 'update_pending', updatedAt: '2026-10-21T06:18:00Z' },
    { workshopId: '2800000005', title: 'Unit Cards — Reforged', state: 'installed', updatedAt: '2026-10-17T19:22:00Z' },
    { workshopId: '2800000006', title: 'Immortal Empires Map Expansion', state: 'update_pending', updatedAt: '2026-10-21T07:44:00Z' },
    { workshopId: '2800000007', title: 'Thrones of Decay Unit Pack', state: 'subscribed', updatedAt: '2026-10-15T16:10:00Z' },
    { workshopId: '2800000008', title: 'Uncatalogued Workshop Entry', state: 'unknown', updatedAt: null },
  ]

  const writeReport = {
    path: 'C:/Steam/steamapps/common/Total War WARHAMMER III/used_mods.txt',
    backupPath: 'C:/Steam/steamapps/common/Total War WARHAMMER III/used_mods.txt.bak',
    written: 26,
    skipped: [],
    unmanagedDirectives: ['mod "legacy_override.pack";'],
    wouldDropUnmanaged: true,
    existingModCount: 24,
    resultingModCount: 26,
    canWrite: true,
    blockedReason: null,
    requiresEmptyConfirmation: false,
    requiresUnmanagedConfirmation: true,
    hardBlocked: false,
  }

  const prefs = { density: 'comfortable', showThumbnails: true, lastScrollTop: 0, zoom: 100 }
  const launchOptions = { skipIntro: false, scriptLogging: false }
  const game = {
    gamePath: 'C:/Steam/steamapps/common/Total War WARHAMMER III',
    dataPath: 'C:/Steam/steamapps/common/Total War WARHAMMER III/data',
    workshopPath: 'C:/Steam/steamapps/workshop/content/1142710',
    steamRoot: 'C:/Steam',
    protonPrefix: null,
    source: 'auto',
  }
  const appInfo = {
    name: 'Yet Another Warhammer Mod Manager',
    version: '1.1.0',
    coreVersion: '1.1.0',
    platform: 'windows',
    arch: 'x86_64',
  }

  return `(() => {
    const scenario = new URLSearchParams(location.search).get('scenario') || 'ready';
    const data = ${JSON.stringify({ tags, snapshot, profiles, conflicts, workshop, writeReport, prefs, launchOptions, game, appInfo })};
    let current = JSON.parse(JSON.stringify(data.snapshot));
    let ui = { ...data.prefs };
    const error = (code, message, details, retryable) => ({ code, message, details, retryable });
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    window.__TAURI_INTERNALS__ = {
      convertFileSrc: (path) => path,
      transformCallback: (callback) => callback,
      unregisterCallback: () => {},
      async invoke(command, args = {}) {
        await delay(18);
        if (scenario === 'loading' && command === 'list_mods') {
          return new Promise(() => {});
        }
        switch (command) {
          case 'app_info':
            return data.appInfo;
          case 'detect_game':
            if (scenario === 'no-game') {
              throw error('game_not_found', 'Could not find a Total War: Warhammer III installation', 'Checked 3 Steam libraries, the Flatpak library, and the Snap library.', false);
            }
            if (scenario === 'steam-missing') {
              throw error('steam_not_found', 'Steam library metadata is unreadable', 'libraryfolders.vdf could not be parsed. The game may still be installed.', false);
            }
            return data.game;
          case 'set_game_path':
            return data.game;
          case 'list_mods':
            if (scenario === 'error') {
              throw error('io', 'The mod roll could not be read', 'Access denied while reading the data directory.', true);
            }
            if (scenario === 'empty') {
              return { ...current, mods: [], enabledCount: 0, loadOrder: { ...current.loadOrder, modNames: [], resolvedModIds: [], backupAvailable: false } };
            }
            return current;
          case 'set_mod_enabled': {
            const mods = current.mods.map((mod) => mod.id === args.modId ? { ...mod, isEnabled: args.enabled } : mod);
            current = { ...current, mods, enabledCount: mods.filter((mod) => mod.isEnabled).length };
            return current;
          }
          case 'set_mods_enabled': {
            const set = new Set(args.modIds);
            const mods = current.mods.map((mod) => set.has(mod.id) ? { ...mod, isEnabled: args.enabled } : mod);
            current = { ...current, mods, enabledCount: mods.filter((mod) => mod.isEnabled).length };
            return current;
          }
          case 'set_load_order':
          case 'apply_profile':
            return current;
          case 'list_profiles':
            return data.profiles;
          case 'save_profile':
          case 'duplicate_profile':
            return data.profiles.profiles[1];
          case 'delete_profile':
            return data.profiles;
          case 'list_tags':
            return data.tags;
          case 'create_tag':
          case 'delete_tag':
            return data.tags;
          case 'set_mod_tags':
            return current;
          case 'get_ui_preferences':
            return ui;
          case 'update_ui_preferences':
            ui = { ...args.preferences };
            return ui;
          case 'read_load_order':
            return current.loadOrder;
          case 'preview_load_order':
            return data.writeReport;
          case 'write_load_order':
            return { ...data.writeReport, written: data.writeReport.resultingModCount, unmanagedDirectives: [], wouldDropUnmanaged: false, requiresUnmanagedConfirmation: false };
          case 'restore_load_order':
            return current.loadOrder;
          case 'get_conflicts':
            if (scenario === 'workshop-unavailable') return data.conflicts;
            return data.conflicts;
          case 'list_workshop_items':
            if (scenario === 'workshop-unavailable') {
              throw error('steam_not_found', 'Steam is unavailable', 'The Steam client process could not be reached.', true);
            }
            return data.workshop;
          case 'workshop_action':
            return { action: args.action, workshopId: args.workshopId, opened: true, message: 'Steam opened the Workshop page.' };
          case 'get_launch_options':
          case 'set_launch_options':
            return data.launchOptions;
          case 'launch_game':
            return { launched: true, method: 'direct', message: 'Warhammer III launch requested directly.' };
          default:
            throw error('internal', 'Unknown command: ' + command, null, false);
        }
      },
    };
  })();`
}

async function capture(cdp, { scenario, viewport, density, view, action, name, skipShot = false }) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  })
  const url = `http://127.0.0.1:${STATIC.port}/?scenario=${scenario}`
  await cdp.send('Page.navigate', { url })
  await cdp.waitFor('Page.loadEventFired', 20000)

  const waitFor = async (expression, timeout = 15000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (result.value) return result.value
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${expression}`)
  }

  await waitFor("!!document.querySelector('.app-shell')")
  await waitFor("document.fonts.status === 'loaded'")

  if (scenario === 'loading') {
    await waitFor("!!document.querySelector('.loading-list')")
  } else if (scenario === 'no-game' || scenario === 'steam-missing') {
    await waitFor("!!document.querySelector('.setup-pane')")
  } else if (scenario === 'error') {
    await waitFor("!!document.querySelector('.fatal-screen')")
  } else {
    await waitFor("!!document.querySelector('[data-region=\"list\"]') || !!document.querySelector('.profiles-screen') || !!document.querySelector('.conflicts-screen') || !!document.querySelector('.workshop-screen') || !!document.querySelector('.settings-screen')")
  }

  if (density !== 'comfortable') {
    await waitFor("!!document.querySelector('[aria-label=\"Density\"]')")
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const select = document.querySelector('[aria-label="Density"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(select, ${JSON.stringify(density)});
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    })
    await waitFor(`document.documentElement.dataset.density === ${JSON.stringify(density)}`)
  }

  const clickText = async (selector, text) => {
    const clicked = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => item.textContent.trim().includes(${JSON.stringify(text)}));
        if (!element) return false;
        element.click();
        return true;
      })()`,
      returnByValue: true,
    })
    if (!clicked.result.value) throw new Error(`Could not click ${text}`)
  }

  if (view) {
    await clickText('.section-rail .rail-item', view)
    await delay(250)
  }

  if (action === 'tag-filter') {
    await clickText('.toolbar-menu-button', 'Tags')
    await delay(120)
    await clickText('.toolbar-popover [role="menuitemcheckbox"]', 'Overhaul')
    await waitFor("document.querySelector('[data-screen-title]').textContent.includes('Overhaul')")
    await delay(200)
  } else if (action === 'search') {
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const input = document.querySelector('#mod-search');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'camera');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`,
    })
    await delay(250)
  } else if (action === 'load-order-dialog') {
    await clickText('button', 'Apply load order')
    await waitFor("!!document.querySelector('[role=\"dialog\"] h2') && document.querySelector('[role=\"dialog\"] h2').textContent.includes('Write used_mods.txt')")
    await delay(200)
  } else if (action === 'launch-dialog') {
    await cdp.send('Runtime.evaluate', {
      expression: "document.querySelector('button[aria-label=\"Launch game\"]').click()",
    })
    await waitFor("!!document.querySelector('[role=\"dialog\"] h2') && document.querySelector('[role=\"dialog\"] h2').textContent.includes('Launch Warhammer III')")
    await delay(200)
  } else if (action === 'open-menu') {
    await clickText('.toolbar-menu-button', 'Tags')
    await waitFor("!!document.querySelector('.toolbar-popover')")
    await delay(200)
  } else if (action === 'focus-primary') {
    await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('.toolbar-actions .btn-primary')?.focus()`,
    })
    await delay(120)
  } else if (action === 'select-row') {
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const row = document.querySelector('.mod-row[data-mod-id="mod-4"]');
        if (!row) return false;
        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        return true;
      })()`,
      returnByValue: true,
    })
    await waitFor("!!document.querySelector('.inspector.is-open')")
    await delay(200)
  }

  await delay(250)
  const layout = await cdp.send('Runtime.evaluate', {
    expression: `({
      width: innerWidth,
      height: innerHeight,
      pageScrollWidth: document.documentElement.scrollWidth,
      pageScrollHeight: document.documentElement.scrollHeight,
      rows: document.querySelectorAll('.mod-row').length,
      loadingRow: document.querySelector('.loading-row') ? getComputedStyle(document.querySelector('.loading-row')).height : null,
      rowVar: getComputedStyle(document.documentElement).getPropertyValue('--row-h'),
      density: document.documentElement.dataset.density || null,
      shell: {
        title: document.querySelector('.title-bar')?.getBoundingClientRect().height ?? null,
        toolbar: document.querySelector('.toolbar, .screen-bar')?.getBoundingClientRect().height ?? null,
        listHeader: document.querySelector('.mod-list-header, .data-table thead th')?.getBoundingClientRect().height ?? null,
        status: document.querySelector('.status-bar')?.getBoundingClientRect().height ?? null,
      },
    })`,
    returnByValue: true,
  })
  if (layout.result.value.pageScrollWidth > layout.result.value.width) {
    throw new Error(`${name}: horizontal page scroll ${layout.result.value.pageScrollWidth} > ${layout.result.value.width}`)
  }

  if (!skipShot) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.data, 'base64'))
  }
  const visible = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const list = document.querySelector('.mod-list-scroll');
      if (!list) return null;
      const top = list.getBoundingClientRect().top;
      const bottom = list.getBoundingClientRect().bottom;
      return [...list.querySelectorAll('.mod-row')].filter((row) => {
        const box = row.getBoundingClientRect();
        return box.top >= top - 0.5 && box.bottom <= bottom + 0.5;
      }).length;
    })()`,
    returnByValue: true,
  })
  const { shell } = layout.result.value
  console.log(`${name} rows=${layout.result.value.rows} visible=${visible.result.value} scroll=${layout.result.value.pageScrollWidth}x${layout.result.value.pageScrollHeight} loadingRow=${layout.result.value.loadingRow} rowVar=${layout.result.value.rowVar} shell=${JSON.stringify(shell)}`)
}

if (!CHROME) {
  throw new Error('No Chromium binary found; set CHROME_PATH')
}
if (!existsSync(join(DIST, 'index.html'))) {
  throw new Error('Missing frontend/dist; run `pnpm build` first')
}

mkdirSync(OUT, { recursive: true })
const STATIC = await startStatic()
const { child, port } = await launchChrome()
let ws
try {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json())
  ws = new WebSocket(created.webSocketDebuggerUrl)
  await new Promise((resolveOpen, reject) => {
    ws.addEventListener('open', resolveOpen, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: fixtureScript() })

  const wide = { width: 1920, height: 1080 }
  const narrow = { width: 1366, height: 768 }

  const specs = [
    { scenario: 'ready', viewport: wide, density: 'comfortable', name: 'shell__mods__1920x1080__comfortable' },
    { scenario: 'ready', viewport: narrow, density: 'comfortable', name: 'shell__mods__1366x768__comfortable' },
    { scenario: 'ready', viewport: wide, density: 'compact', name: 'shell__mods__1920x1080__compact' },
    { scenario: 'ready', viewport: wide, density: 'roomy', name: 'shell__mods__1920x1080__roomy' },
    { scenario: 'ready', viewport: wide, density: 'comfortable', action: 'select-row', name: 'mods__selected-inspector__1920x1080__comfortable' },
    { scenario: 'ready', viewport: narrow, density: 'comfortable', action: 'select-row', name: 'mods__selected-inspector__1366x768__comfortable' },
    { scenario: 'ready', viewport: wide, density: 'comfortable', action: 'tag-filter', name: 'mods__filtered-tag__1920x1080__comfortable' },
    { scenario: 'ready', viewport: narrow, density: 'comfortable', action: 'tag-filter', name: 'mods__filtered-tag__1366x768__comfortable' },
    { scenario: 'ready', viewport: wide, density: 'comfortable', action: 'open-menu', name: 'mods__menu__1920x1080__comfortable' },
    { scenario: 'ready', viewport: narrow, density: 'comfortable', action: 'open-menu', name: 'mods__menu__1366x768__comfortable' },
    { scenario: 'ready', viewport: wide, density: 'comfortable', action: 'focus-primary', name: 'mods__focus__1920x1080__comfortable' },
    { scenario: 'ready', viewport: narrow, density: 'comfortable', action: 'focus-primary', name: 'mods__focus__1366x768__comfortable' },
    { scenario: 'ready', viewport: wide, density: 'comfortable', view: 'Profiles', name: 'profiles__active__1920x1080__comfortable' },
    { scenario: 'ready', viewport: narrow, density: 'comfortable', view: 'Profiles', name: 'profiles__active__1366x768__comfortable' },
    { scenario: 'ready', viewport: wide, density: 'comfortable', view: 'Conflicts', name: 'conflicts__report__1920x1080__comfortable' },
    { scenario: 'ready', viewport: narrow, density: 'comfortable', view: 'Conflicts', name: 'conflicts__report__1366x768__comfortable' },
    { scenario: 'ready', viewport: wide, density: 'comfortable', view: 'Workshop', name: 'workshop__subscribed__1920x1080__comfortable' },
    { scenario: 'ready', viewport: narrow, density: 'comfortable', view: 'Workshop', name: 'workshop__subscribed__1366x768__comfortable' },
    { scenario: 'workshop-unavailable', viewport: narrow, density: 'comfortable', view: 'Workshop', name: 'workshop__steam-unavailable__1366x768__comfortable' },
    { scenario: 'ready', viewport: wide, density: 'comfortable', view: 'Settings', name: 'settings__general__1920x1080__comfortable' },
    { scenario: 'ready', viewport: narrow, density: 'comfortable', view: 'Settings', name: 'settings__general__1366x768__comfortable' },
    { scenario: 'no-game', viewport: wide, density: 'comfortable', name: 'first-run__not-found__1920x1080__comfortable' },
    { scenario: 'no-game', viewport: narrow, density: 'comfortable', name: 'first-run__not-found__1366x768__comfortable' },
    { scenario: 'loading', viewport: wide, density: 'comfortable', name: 'loading__boot__1920x1080__comfortable' },
    { scenario: 'loading', viewport: narrow, density: 'comfortable', name: 'loading__boot__1366x768__comfortable' },
    { scenario: 'empty', viewport: wide, density: 'comfortable', name: 'empty__no-mods__1920x1080__comfortable' },
    { scenario: 'empty', viewport: narrow, density: 'comfortable', name: 'empty__no-mods__1366x768__comfortable' },
    { scenario: 'error', viewport: wide, density: 'comfortable', name: 'error__load-failure__1920x1080__comfortable' },
    { scenario: 'error', viewport: narrow, density: 'comfortable', name: 'error__load-failure__1366x768__comfortable' },
    { scenario: 'ready', viewport: wide, density: 'comfortable', action: 'load-order-dialog', name: 'load-order__preview__1920x1080__comfortable' },
    { scenario: 'ready', viewport: narrow, density: 'comfortable', action: 'load-order-dialog', name: 'load-order__preview__1366x768__comfortable' },
    { scenario: 'ready', viewport: wide, density: 'comfortable', action: 'launch-dialog', name: 'launch__dialog__1920x1080__comfortable' },
    { scenario: 'ready', viewport: narrow, density: 'comfortable', action: 'launch-dialog', name: 'launch__dialog__1366x768__comfortable' },
  ]

  for (const spec of specs) {
    if (ONLY.length > 0 && !ONLY.some((name) => spec.name.includes(name))) continue
    await capture(cdp, spec)
  }

  if (ONLY.length === 0) {
    for (const view of [null, 'Profiles', 'Conflicts', 'Workshop', 'Settings']) {
      await capture(cdp, {
        scenario: 'ready',
        viewport: { width: 1024, height: 720 },
        density: 'comfortable',
        view,
        name: `check__${view ?? 'mods'}__1024x720`,
        skipShot: true,
      })
    }

    for (const density of ['compact', 'comfortable', 'roomy']) {
      for (const [label, viewport] of [['1920x1080', wide], ['1366x768', narrow]]) {
        await capture(cdp, {
          scenario: 'ready',
          viewport,
          density,
          name: `count__mods__${label}__${density}`,
          skipShot: true,
        })
      }
    }
  }
} finally {
  ws?.close()
  child.kill('SIGKILL')
  STATIC.server.close()
}
