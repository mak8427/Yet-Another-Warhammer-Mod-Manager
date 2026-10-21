import { vi } from 'vitest'
import type {
  AppInfo,
  ConflictReport,
  GameLocation,
  IpcClient,
  LaunchOptions,
  LaunchResult,
  LoadOrderReadReport,
  LoadOrderWriteReport,
  ModListSnapshot,
  ModSummary,
  Profile,
  ProfilesState,
  ResetDefaultsReport,
  Tag,
  UiPreferences,
  WorkshopItem,
} from '../lib/ipc'

export const APP_INFO: AppInfo = {
  name: 'WH3 Mod Manager',
  version: '0.1.0',
  coreVersion: '0.1.0',
  platform: 'windows',
  arch: 'x86_64',
}

export const GAME: GameLocation = {
  gamePath: 'C:/Steam/steamapps/common/Total War WARHAMMER III',
  dataPath: 'C:/Steam/steamapps/common/Total War WARHAMMER III/data',
  workshopPath: 'C:/Steam/steamapps/workshop/content/1142710',
  steamRoot: 'C:/Steam',
  protonPrefix: null,
  source: 'auto',
}

export const UI: UiPreferences = {
  density: 'comfortable',
  showAuthors: true,
  showThumbnails: true,
  lastScrollTop: 0,
}

export const EMPTY_LOAD_ORDER: LoadOrderReadReport = {
  path: 'C:/Steam/steamapps/common/Total War WARHAMMER III/used_mods.txt',
  present: true,
  corrupt: false,
  message: null,
  unreadable: null,
  modNames: [],
  resolvedModIds: [],
  missingNames: [],
  duplicates: [],
  unmanagedDirectives: [],
  backupAvailable: false,
}

export function makeMod(overrides: Partial<ModSummary> & { id: string; name: string }): ModSummary {
  return {
    humanName: overrides.name.replace(/\.pack$/i, ''),
    author: null,
    isWorkshop: false,
    workshopId: null,
    isEnabled: false,
    loadOrder: 0,
    tags: [],
    updatedAt: '2026-10-20T12:00:00Z',
    thumbnailPath: null,
    dependencies: [],
    packError: null,
    isMovie: false,
    sizeBytes: 1024,
    ...overrides,
  }
}

export function makeSnapshot(mods: ModSummary[], overrides: Partial<ModListSnapshot> = {}): ModListSnapshot {
  return {
    mods,
    enabledCount: mods.filter((mod) => mod.isEnabled).length,
    activeProfileId: 'profile-default',
    loadOrder: EMPTY_LOAD_ORDER,
    timings: { startupMs: 12, detectionMs: 3, scanMs: 5, loadOrderMs: 1, totalMs: 12 },
    warnings: [],
    ...overrides,
  }
}

export const PROFILE_DEFAULT: Profile = {
  id: 'profile-default',
  name: 'Default',
  enabledModIds: [],
  createdAt: '2026-10-20T12:00:00Z',
  updatedAt: '2026-10-20T12:00:00Z',
}

export const PROFILE_CAMPAIGN: Profile = {
  id: 'profile-campaign',
  name: 'Campaign',
  enabledModIds: ['mod-b'],
  createdAt: '2026-10-20T12:00:00Z',
  updatedAt: '2026-10-20T12:00:00Z',
}

export const PROFILES: ProfilesState = {
  profiles: [PROFILE_DEFAULT, PROFILE_CAMPAIGN],
  activeProfileId: PROFILE_DEFAULT.id,
}

export const TAGS: Tag[] = [
  { id: 'tag-overhaul', name: 'Overhaul', color: '#C9A227' },
  { id: 'tag-visual', name: 'Visual', color: '#6F8F4A' },
]

export const EMPTY_CONFLICTS: ConflictReport = {
  conflicts: [],
  missingDependencies: [],
  duplicatePackNames: [],
  disabledDependencies: [],
  shadowedBaseTables: [],
  shadowedBaseTableCount: 0,
  modSummaries: [],
  warnings: [],
}

export const CONFLICT_REPORT: ConflictReport = {
  conflicts: [
    {
      path: 'db/units_tables/units',
      winnerModId: 'mod-b',
      loserModIds: ['mod-a'],
    },
  ],
  missingDependencies: [{ modId: 'mod-a', missing: ['missing.pack'] }],
  duplicatePackNames: [],
  disabledDependencies: [],
  shadowedBaseTables: [],
  shadowedBaseTableCount: 0,
  modSummaries: [
    {
      modId: 'mod-a',
      name: 'alpha.pack',
      overrides: 0,
      overriddenOn: 1,
      baseTableOverrides: 0,
      fileCount: 2,
    },
    {
      modId: 'mod-b',
      name: 'beta.pack',
      overrides: 1,
      overriddenOn: 0,
      baseTableOverrides: 0,
      fileCount: 2,
    },
  ],
  warnings: [],
}

export const WORKSHOP_ITEMS: WorkshopItem[] = [
  {
    workshopId: '111',
    title: 'Installed Mod',
    state: 'installed',
    updatedAt: '2023-11-14T22:13:20Z',
  },
  {
    workshopId: '222',
    title: 'Pending Mod',
    state: 'update_pending',
    updatedAt: '2023-11-14T22:15:00Z',
  },
]

export const LAUNCH_OPTIONS: LaunchOptions = {
  skipIntro: false,
  scriptLogging: false,
}

export const LAUNCH_RESULT: LaunchResult = {
  launched: true,
  method: 'steam',
  message: 'Warhammer III launch requested through Steam.',
}

export const RESET_REPORT: ResetDefaultsReport = {
  loadOrder: {
    status: 'written',
    message: null,
    unmanagedDirectives: [],
    requiresUnmanagedConfirmation: false,
  },
}

export const WRITE_REPORT: LoadOrderWriteReport = {
  path: 'C:/Steam/steamapps/common/Total War WARHAMMER III/used_mods.txt',
  backupPath: null,
  written: 2,
  skipped: [],
  unmanagedDirectives: [],
  wouldDropUnmanaged: false,
  existingModCount: 0,
  resultingModCount: 2,
  canWrite: true,
  blockedReason: null,
  requiresEmptyConfirmation: false,
  requiresUnmanagedConfirmation: false,
  hardBlocked: false,
}

export function makeClient(overrides: Partial<IpcClient> = {}): IpcClient {
  const base: IpcClient = {
    appInfo: vi.fn(async () => APP_INFO),
    detectGame: vi.fn(async () => GAME),
    setGamePath: vi.fn(async () => GAME),
    listMods: vi.fn(async () => makeSnapshot([])),
    setModEnabled: vi.fn(async () => makeSnapshot([])),
    setModsEnabled: vi.fn(async () => makeSnapshot([])),
    setLoadOrder: vi.fn(async () => makeSnapshot([])),
    listProfiles: vi.fn(async () => PROFILES),
    saveProfile: vi.fn(async () => PROFILE_DEFAULT),
    duplicateProfile: vi.fn(async () => PROFILE_CAMPAIGN),
    deleteProfile: vi.fn(async () => PROFILES),
    applyProfile: vi.fn(async () => makeSnapshot([])),
    listTags: vi.fn(async () => TAGS),
    createTag: vi.fn(async () => TAGS),
    deleteTag: vi.fn(async () => TAGS),
    setModTags: vi.fn(async () => makeSnapshot([])),
    getUiPreferences: vi.fn(async () => UI),
    updateUiPreferences: vi.fn(async () => UI),
    resetToDefaults: vi.fn(async () => RESET_REPORT),
    readLoadOrder: vi.fn(async () => EMPTY_LOAD_ORDER),
    previewLoadOrder: vi.fn(async () => WRITE_REPORT),
    writeLoadOrder: vi.fn(async () => WRITE_REPORT),
    restoreLoadOrder: vi.fn(async () => EMPTY_LOAD_ORDER),
    getConflicts: vi.fn(async () => EMPTY_CONFLICTS),
    listWorkshopItems: vi.fn(async () => WORKSHOP_ITEMS),
    workshopAction: vi.fn(async (action, workshopId) => ({
      action,
      workshopId,
      opened: true,
      message: 'Steam opened the Workshop page.',
    })),
    getLaunchOptions: vi.fn(async () => LAUNCH_OPTIONS),
    setLaunchOptions: vi.fn(async (options) => options),
    launchGame: vi.fn(async () => LAUNCH_RESULT),
  }
  return { ...base, ...overrides }
}
