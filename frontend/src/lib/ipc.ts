import { convertFileSrc, invoke } from '@tauri-apps/api/core'

/**
 * Manual mirror of the Rust IPC contract.
 *
 * Source of truth:
 * - `crates/wh3mm-core/src/ipc.rs` (payload structs)
 * - `crates/wh3mm-core/src/error.rs` (error envelope and codes)
 * - ADR-002 and ADR-006 in `docs/adr/`
 *
 * Keep this file in lockstep with Rust. Do not add filesystem or business
 * logic here; this module only marshals values across the Tauri boundary.
 */

export const ERROR_CODES = [
  'io',
  'config_corrupt',
  'game_not_found',
  'steam_not_found',
  'pack_parse_failed',
  'not_found',
  'validation',
  'internal',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** Wire shape of `wh3mm_core::error::AppError`. */
export interface AppErrorPayload {
  code: ErrorCode
  message: string
  details: string | null
  retryable: boolean
}

/** Wire shape of `wh3mm_core::ipc::AppInfo`. */
export interface AppInfo {
  name: string
  version: string
  coreVersion: string
  platform: string
  arch: string
}

export type LocationSource = 'auto' | 'manual'

export interface GameLocation {
  gamePath: string
  dataPath: string
  workshopPath: string
  steamRoot: string
  protonPrefix: string | null
  source: LocationSource
}

export interface ModSummary {
  id: string
  name: string
  humanName: string
  author: string | null
  isWorkshop: boolean
  workshopId: string | null
  isEnabled: boolean
  loadOrder: number
  tags: string[]
  updatedAt: string | null
  thumbnailPath: string | null
  dependencies: string[]
  packError: string | null
  isMovie: boolean
  sizeBytes: number
}

export interface LoadOrderReadReport {
  path: string
  present: boolean
  corrupt: boolean
  message: string | null
  unreadable: string | null
  modNames: string[]
  resolvedModIds: string[]
  missingNames: string[]
  duplicates: string[]
  unmanagedDirectives: string[]
  backupAvailable: boolean
}

export interface LoadOrderWriteReport {
  path: string
  backupPath: string | null
  written: number
  skipped: string[]
  unmanagedDirectives: string[]
  wouldDropUnmanaged: boolean
  existingModCount: number
  resultingModCount: number
  canWrite: boolean
  blockedReason: string | null
  requiresEmptyConfirmation: boolean
  requiresUnmanagedConfirmation: boolean
  hardBlocked: boolean
}

export interface Timings {
  startupMs: number
  detectionMs: number
  scanMs: number
  loadOrderMs: number
  totalMs: number
}

export interface ModListSnapshot {
  mods: ModSummary[]
  enabledCount: number
  activeProfileId: string
  loadOrder: LoadOrderReadReport
  timings: Timings
  warnings: string[]
}

export interface Profile {
  id: string
  name: string
  enabledModIds: string[]
  createdAt: string
  updatedAt: string
}

export interface ProfilesState {
  profiles: Profile[]
  activeProfileId: string
}

export interface Tag {
  id: string
  name: string
  color: string
}

export type Density = 'compact' | 'comfortable' | 'roomy'

export interface UiPreferences {
  density: Density
  showAuthors: boolean
  showThumbnails: boolean
  lastScrollTop: number
}

export type ResetLoadOrderOutcome = 'written' | 'no_game_path' | 'blocked'

export interface ResetDefaultsReport {
  loadOrderWritten: boolean
  loadOrderOutcome: ResetLoadOrderOutcome
  loadOrderBlockedReason: string | null
}

export interface FileConflict {
  path: string
  winnerModId: string
  loserModIds: string[]
}

export interface MissingDependency {
  modId: string
  missing: string[]
}

export interface DuplicatePackName {
  name: string
  modIds: string[]
}

export interface DisabledDependency {
  modId: string
  dependency: string
  providerModId: string
}

export interface BaseTableShadow {
  modId: string
  path: string
  basePack: string
}

export interface ConflictModSummary {
  modId: string
  name: string
  overrides: number
  overriddenOn: number
  baseTableOverrides: number
  fileCount: number
}

export interface ConflictReport {
  conflicts: FileConflict[]
  missingDependencies: MissingDependency[]
  duplicatePackNames: DuplicatePackName[]
  disabledDependencies: DisabledDependency[]
  shadowedBaseTables: BaseTableShadow[]
  shadowedBaseTableCount: number
  modSummaries: ConflictModSummary[]
  warnings: string[]
}

export type WorkshopState = 'subscribed' | 'installed' | 'update_pending' | 'unknown'
export type WorkshopAction = 'open' | 'subscribe' | 'unsubscribe' | 'update'

export interface WorkshopItem {
  workshopId: string
  title: string
  state: WorkshopState
  updatedAt: string | null
}

export interface SteamActionResult {
  action: WorkshopAction
  workshopId: string
  opened: boolean
  message: string
}

export interface LaunchOptions {
  skipIntro: boolean
  scriptLogging: boolean
}

export type LaunchMethod = 'steam' | 'direct'

export interface LaunchResult {
  launched: boolean
  method: LaunchMethod
  message: string | null
}

/** Normalized rejection thrown by every command wrapper. */
export class IpcError extends Error {
  readonly code: ErrorCode
  readonly details: string | null
  readonly retryable: boolean

  constructor(payload: AppErrorPayload) {
    super(payload.message)
    this.name = 'IpcError'
    this.code = payload.code
    this.details = payload.details
    this.retryable = payload.retryable
  }
}

function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value)
}

function isErrorPayload(value: unknown): value is AppErrorPayload {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.code === 'string' &&
    isErrorCode(candidate.code) &&
    typeof candidate.message === 'string' &&
    (candidate.details === null || typeof candidate.details === 'string') &&
    typeof candidate.retryable === 'boolean'
  )
}

/**
 * Converts anything Tauri may reject with into a stable `IpcError`.
 * Tauri rejects with the serialized `AppError`; panics and bridge failures can
 * surface as strings or `Error` instances instead.
 */
export function toIpcError(cause: unknown): IpcError {
  if (cause instanceof IpcError) return cause
  if (isErrorPayload(cause)) return new IpcError(cause)
  if (cause instanceof Error) {
    return new IpcError({
      code: 'internal',
      message: cause.message,
      details: null,
      retryable: false,
    })
  }
  return new IpcError({
    code: 'internal',
    message: typeof cause === 'string' ? cause : 'Unknown IPC failure',
    details: null,
    retryable: false,
  })
}

export type CommandName =
  | 'app_info'
  | 'detect_game'
  | 'set_game_path'
  | 'list_mods'
  | 'set_mod_enabled'
  | 'set_mods_enabled'
  | 'set_load_order'
  | 'list_profiles'
  | 'save_profile'
  | 'duplicate_profile'
  | 'delete_profile'
  | 'apply_profile'
  | 'list_tags'
  | 'create_tag'
  | 'delete_tag'
  | 'set_mod_tags'
  | 'get_ui_preferences'
  | 'update_ui_preferences'
  | 'reset_to_defaults'
  | 'read_load_order'
  | 'preview_load_order'
  | 'write_load_order'
  | 'restore_load_order'
  | 'get_conflicts'
  | 'list_workshop_items'
  | 'workshop_action'
  | 'get_launch_options'
  | 'set_launch_options'
  | 'launch_game'

export async function invokeCommand<T>(
  command: CommandName,
  args: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (cause) {
    throw toIpcError(cause)
  }
}

export async function appInfo(): Promise<AppInfo> {
  return invokeCommand<AppInfo>('app_info')
}

export async function detectGame(): Promise<GameLocation> {
  return invokeCommand<GameLocation>('detect_game')
}

export async function setGamePath(gamePath: string | null): Promise<GameLocation> {
  return invokeCommand<GameLocation>('set_game_path', { gamePath })
}

export async function listMods(): Promise<ModListSnapshot> {
  return invokeCommand<ModListSnapshot>('list_mods')
}

export async function setModEnabled(modId: string, enabled: boolean): Promise<ModListSnapshot> {
  return invokeCommand<ModListSnapshot>('set_mod_enabled', { modId, enabled })
}

export async function setModsEnabled(modIds: string[], enabled: boolean): Promise<ModListSnapshot> {
  return invokeCommand<ModListSnapshot>('set_mods_enabled', { modIds, enabled })
}

export async function setLoadOrder(orderedModIds: string[]): Promise<ModListSnapshot> {
  return invokeCommand<ModListSnapshot>('set_load_order', { orderedModIds })
}

export async function listProfiles(): Promise<ProfilesState> {
  return invokeCommand<ProfilesState>('list_profiles')
}

export async function saveProfile(
  name: string,
  enabledModIds: string[],
  profileId?: string,
): Promise<Profile> {
  return invokeCommand<Profile>('save_profile', { profileId, name, enabledModIds })
}

export async function duplicateProfile(profileId: string, name: string): Promise<Profile> {
  return invokeCommand<Profile>('duplicate_profile', { profileId, name })
}

export async function deleteProfile(profileId: string): Promise<ProfilesState> {
  return invokeCommand<ProfilesState>('delete_profile', { profileId })
}

export async function applyProfile(profileId: string): Promise<ModListSnapshot> {
  return invokeCommand<ModListSnapshot>('apply_profile', { profileId })
}

export async function listTags(): Promise<Tag[]> {
  return invokeCommand<Tag[]>('list_tags')
}

export async function createTag(name: string, color: string): Promise<Tag[]> {
  return invokeCommand<Tag[]>('create_tag', { name, color })
}

export async function deleteTag(tagId: string): Promise<Tag[]> {
  return invokeCommand<Tag[]>('delete_tag', { tagId })
}

export async function setModTags(modId: string, tagIds: string[]): Promise<ModListSnapshot> {
  return invokeCommand<ModListSnapshot>('set_mod_tags', { modId, tagIds })
}

export async function getUiPreferences(): Promise<UiPreferences> {
  return invokeCommand<UiPreferences>('get_ui_preferences')
}

export async function updateUiPreferences(preferences: UiPreferences): Promise<UiPreferences> {
  return invokeCommand<UiPreferences>('update_ui_preferences', { preferences })
}

export async function resetToDefaults(confirm: boolean): Promise<ResetDefaultsReport> {
  return invokeCommand<ResetDefaultsReport>('reset_to_defaults', { confirm })
}

export async function readLoadOrder(): Promise<LoadOrderReadReport> {
  return invokeCommand<LoadOrderReadReport>('read_load_order')
}

export async function previewLoadOrder(): Promise<LoadOrderWriteReport> {
  return invokeCommand<LoadOrderWriteReport>('preview_load_order')
}

export async function writeLoadOrder(
  allowEmpty: boolean,
  confirmUnmanagedLoss: boolean,
): Promise<LoadOrderWriteReport> {
  return invokeCommand<LoadOrderWriteReport>('write_load_order', {
    allowEmpty,
    confirmUnmanagedLoss,
  })
}

export async function restoreLoadOrder(): Promise<LoadOrderReadReport> {
  return invokeCommand<LoadOrderReadReport>('restore_load_order')
}

export async function getConflicts(): Promise<ConflictReport> {
  return invokeCommand<ConflictReport>('get_conflicts')
}

export async function listWorkshopItems(): Promise<WorkshopItem[]> {
  return invokeCommand<WorkshopItem[]>('list_workshop_items')
}

export async function workshopAction(
  action: WorkshopAction,
  workshopId: string,
): Promise<SteamActionResult> {
  return invokeCommand<SteamActionResult>('workshop_action', { action, workshopId })
}

export async function getLaunchOptions(): Promise<LaunchOptions> {
  return invokeCommand<LaunchOptions>('get_launch_options')
}

export async function setLaunchOptions(options: LaunchOptions): Promise<LaunchOptions> {
  return invokeCommand<LaunchOptions>('set_launch_options', { options })
}

export async function launchGame(skipIntro: boolean, scriptLogging: boolean): Promise<LaunchResult> {
  return invokeCommand<LaunchResult>('launch_game', { skipIntro, scriptLogging })
}

/**
 * The only place the frontend turns a local path into a displayable URL.
 * Falls back to the path when the Tauri asset bridge is unavailable (tests,
 * plain Vite dev without the shell).
 */
export function fileUrl(path: string): string {
  try {
    return convertFileSrc(path)
  } catch {
    return path
  }
}

/** Typed facade used by components; one method per registered Rust command. */
export const ipc = {
  appInfo,
  detectGame,
  setGamePath,
  listMods,
  setModEnabled,
  setModsEnabled,
  setLoadOrder,
  listProfiles,
  saveProfile,
  duplicateProfile,
  deleteProfile,
  applyProfile,
  listTags,
  createTag,
  deleteTag,
  setModTags,
  getUiPreferences,
  updateUiPreferences,
  resetToDefaults,
  readLoadOrder,
  previewLoadOrder,
  writeLoadOrder,
  restoreLoadOrder,
  getConflicts,
  listWorkshopItems,
  workshopAction,
  getLaunchOptions,
  setLaunchOptions,
  launchGame,
}

export type IpcClient = typeof ipc
