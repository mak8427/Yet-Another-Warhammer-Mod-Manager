import { useSyncExternalStore } from 'react'
import {
  IpcError,
  ipc,
  toIpcError,
  type AppInfo,
  type ConflictReport,
  type Density,
  type GameLocation,
  type IpcClient,
  type LaunchOptions,
  type LaunchResult,
  type LoadOrderWriteReport,
  type ModListSnapshot,
  type ModSummary,
  type ProfilesState,
  type ResetDefaultsReport,
  type SteamActionResult,
  type Tag,
  type UiPreferences,
  type WorkshopAction,
  type WorkshopItem,
} from './lib/ipc'
import { clampZoom, stepZoom, ZOOM_DEFAULT } from './lib/zoom'

export type AppStatus = 'loading' | 'ready' | 'no-game' | 'error'
export type View = 'mods' | 'profiles' | 'conflicts' | 'workshop' | 'settings'
export type SortMode = 'load-order' | 'name' | 'updated'
export type SelectMode = 'single' | 'toggle' | 'range'
export type MoveTarget = 'up' | 'down' | 'top' | 'bottom'

export interface Notice {
  kind: 'info' | 'success' | 'warning' | 'error'
  message: string
}

export interface AppState {
  status: AppStatus
  initialized: boolean
  appInfo: AppInfo | null
  game: GameLocation | null
  snapshot: ModListSnapshot | null
  profiles: ProfilesState | null
  tags: Tag[]
  ui: UiPreferences
  query: string
  activeTagIds: string[]
  selection: string[]
  anchorId: string | null
  view: View
  busy: string | null
  error: IpcError | null
  notice: Notice | null
  preview: LoadOrderWriteReport | null
  previewOpen: boolean
  launchOpen: boolean
  inspectorOpen: boolean
  sort: SortMode
  dirty: boolean
  lastWriteAt: string | null
  conflicts: ConflictReport | null
  conflictLoading: boolean
  conflictError: IpcError | null
  workshop: WorkshopItem[] | null
  workshopLoading: boolean
  workshopError: IpcError | null
  launchOptions: LaunchOptions
  launchLoading: boolean
  launchError: IpcError | null
  launchResult: LaunchResult | null
}

export const DEFAULT_UI: UiPreferences = {
  density: 'comfortable',
  showThumbnails: true,
  lastScrollTop: 0,
  zoom: ZOOM_DEFAULT,
}

export function initialState(): AppState {
  return {
    status: 'loading',
    initialized: false,
    appInfo: null,
    game: null,
    snapshot: null,
    profiles: null,
    tags: [],
    ui: DEFAULT_UI,
    query: '',
    activeTagIds: [],
    selection: [],
    anchorId: null,
    view: 'mods',
    busy: null,
    error: null,
    notice: null,
    preview: null,
    previewOpen: false,
    launchOpen: false,
    inspectorOpen: false,
    sort: 'load-order',
    dirty: false,
    lastWriteAt: null,
    conflicts: null,
    conflictLoading: false,
    conflictError: null,
    workshop: null,
    workshopLoading: false,
    workshopError: null,
    launchOptions: { skipIntro: false, scriptLogging: false },
    launchLoading: false,
    launchError: null,
    launchResult: null,
  }
}

export function visibleMods(state: AppState): ModSummary[] {
  const mods = state.snapshot?.mods ?? []
  const query = state.query.trim().toLowerCase()
  const filtered = mods.filter((mod) => {
    if (state.activeTagIds.length > 0) {
      const tags = new Set(mod.tags)
      if (!state.activeTagIds.every((tagId) => tags.has(tagId))) return false
    }
    if (query === '') return true
    return (
      mod.name.toLowerCase().includes(query) ||
      mod.humanName.toLowerCase().includes(query) ||
      (mod.workshopId ?? '').includes(query)
    )
  })
  if (state.sort === 'load-order') return filtered
  const sorted = filtered.slice()
  const byId = (left: ModSummary, right: ModSummary) => left.id.localeCompare(right.id)
  if (state.sort === 'name') {
    sorted.sort(
      (a, b) =>
        a.humanName.localeCompare(b.humanName, undefined, { sensitivity: 'base' }) || byId(a, b),
    )
  } else {
    sorted.sort((a, b) => {
      const left = a.updatedAt ? Date.parse(a.updatedAt) : Number.NEGATIVE_INFINITY
      const right = b.updatedAt ? Date.parse(b.updatedAt) : Number.NEGATIVE_INFINITY
      return right - left || byId(a, b)
    })
  }
  return sorted
}

export function activeProfileName(state: AppState): string {
  if (!state.profiles) return 'Default'
  const active = state.profiles.profiles.find(
    (profile) => profile.id === state.profiles?.activeProfileId,
  )
  return active?.name ?? 'Default'
}

export class AppStore {
  private state: AppState = initialState()
  private readonly listeners = new Set<() => void>()
  private readonly client: IpcClient
  private initPromise: Promise<void> | null = null
  private scrollTimer: ReturnType<typeof setTimeout> | null = null
  private pendingScrollTop = 0

  constructor(client: IpcClient = ipc) {
    this.client = client
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = (): AppState => this.state

  private set(update: Partial<AppState> | ((state: AppState) => Partial<AppState>)): void {
    const patch = typeof update === 'function' ? update(this.state) : update
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  reset(): void {
    if (this.scrollTimer) clearTimeout(this.scrollTimer)
    this.scrollTimer = null
    this.initPromise = null
    this.state = initialState()
    for (const listener of this.listeners) listener()
  }

  init(): Promise<void> {
    if (this.state.initialized) return Promise.resolve()
    if (this.initPromise) return this.initPromise
    this.initPromise = this.bootstrap().finally(() => {
      this.initPromise = null
    })
    return this.initPromise
  }

  private async bootstrap(): Promise<void> {
    this.set({ status: 'loading', busy: 'Starting', error: null })
    try {
      const appInfo = await this.client.appInfo()
      this.set({ appInfo })
      const game = await this.client.detectGame()
      const [snapshot, profiles, tags, ui] = await Promise.all([
        this.client.listMods(),
        this.client.listProfiles(),
        this.client.listTags(),
        this.client.getUiPreferences(),
      ])
      this.set({
        status: 'ready',
        initialized: true,
        appInfo,
        game,
        snapshot,
        profiles,
        tags,
        ui,
        busy: null,
        error: null,
      })
      void this.refreshConflicts()
      void this.refreshWorkshop()
      void this.refreshLaunchOptions()
    } catch (cause) {
      const error = toIpcError(cause)
      if (error.code === 'game_not_found') {
        this.set({
          status: 'no-game',
          initialized: true,
          game: null,
          snapshot: null,
          profiles: null,
          busy: null,
          error,
        })
        return
      }
      this.set({
        status: 'error',
        initialized: true,
        busy: null,
        error,
      })
    }
  }

  retry(): Promise<void> {
    this.reset()
    return this.init()
  }

  async setGamePath(path: string | null): Promise<void> {
    this.set({ busy: 'Detecting the game', error: null })
    try {
      const game = await this.client.setGamePath(path)
      const [snapshot, profiles, tags, ui] = await Promise.all([
        this.client.listMods(),
        this.client.listProfiles(),
        this.client.listTags(),
        this.client.getUiPreferences(),
      ])
      this.set({
        status: 'ready',
        game,
        snapshot,
        profiles,
        tags,
        ui,
        busy: null,
        error: null,
        selection: [],
        anchorId: null,
      })
      void this.refreshConflicts()
      void this.refreshWorkshop()
      void this.refreshLaunchOptions()
    } catch (cause) {
      const error = toIpcError(cause)
      if (error.code === 'game_not_found') {
        this.set({
          status: 'no-game',
          game: null,
          snapshot: null,
          profiles: null,
          busy: null,
          error,
        })
      } else {
        this.set({ busy: null, error })
      }
    }
  }

  private async refreshProfiles(): Promise<ProfilesState | null> {
    try {
      const profiles = await this.client.listProfiles()
      this.set({ profiles })
      return profiles
    } catch (cause) {
      this.set({ error: toIpcError(cause) })
      return null
    }
  }

  private setSnapshot(snapshot: ModListSnapshot): void {
    const known = new Set(snapshot.mods.map((mod) => mod.id))
    const selection = this.state.selection.filter((id) => known.has(id))
    this.set({
      snapshot,
      selection,
      anchorId:
        this.state.anchorId && known.has(this.state.anchorId) ? this.state.anchorId : null,
    })
    void this.refreshConflicts()
  }

  async refreshConflicts(): Promise<void> {
    if (this.state.status !== 'ready' || this.state.conflictLoading) return
    this.set({ conflictLoading: true, conflictError: null })
    try {
      const conflicts = await this.client.getConflicts()
      this.set({ conflicts, conflictLoading: false })
    } catch (cause) {
      this.set({ conflictLoading: false, conflictError: toIpcError(cause) })
    }
  }

  async refreshWorkshop(): Promise<void> {
    if (this.state.status !== 'ready' || this.state.workshopLoading) return
    this.set({ workshopLoading: true, workshopError: null })
    try {
      const workshop = await this.client.listWorkshopItems()
      this.set({ workshop, workshopLoading: false })
    } catch (cause) {
      this.set({ workshopLoading: false, workshopError: toIpcError(cause) })
    }
  }

  async refreshLaunchOptions(): Promise<void> {
    if (this.state.status !== 'ready') return
    try {
      const launchOptions = await this.client.getLaunchOptions()
      this.set({ launchOptions })
    } catch (cause) {
      this.set({ launchError: toIpcError(cause) })
    }
  }

  async runWorkshopAction(action: WorkshopAction, workshopId: string): Promise<void> {
    this.set({ busy: 'Talking to Steam', workshopError: null })
    try {
      const result: SteamActionResult = await this.client.workshopAction(action, workshopId)
      this.set({
        busy: null,
        notice: { kind: 'info', message: result.message },
      })
      await this.refreshWorkshop()
    } catch (cause) {
      this.set({ busy: null, workshopError: toIpcError(cause) })
    }
  }

  async setLaunchOption(key: keyof LaunchOptions, value: boolean): Promise<void> {
    const previous = this.state.launchOptions
    const next = { ...previous, [key]: value }
    this.set({ launchOptions: next, launchError: null, busy: 'Saving launch options' })
    try {
      const saved = await this.client.setLaunchOptions(next)
      this.set({ launchOptions: saved, busy: null })
    } catch (cause) {
      this.set({
        launchOptions: previous,
        busy: null,
        launchError: toIpcError(cause),
      })
    }
  }

  async launchGame(): Promise<void> {
    this.set({ launchLoading: true, launchError: null, launchResult: null, busy: 'Launching' })
    try {
      const result = await this.client.launchGame(
        this.state.launchOptions.skipIntro,
        this.state.launchOptions.scriptLogging,
      )
      this.set({
        launchLoading: false,
        launchResult: result,
        busy: null,
        notice: {
          kind: 'success',
          message: result.message ?? 'Launch requested',
        },
      })
    } catch (cause) {
      this.set({ launchLoading: false, busy: null, launchError: toIpcError(cause) })
    }
  }

  async toggleMod(modId: string): Promise<void> {
    const mod = this.state.snapshot?.mods.find((item) => item.id === modId)
    if (!mod) return
    this.set({ busy: mod.isEnabled ? 'Disabling' : 'Enabling' })
    try {
      const snapshot = await this.client.setModEnabled(modId, !mod.isEnabled)
      this.setSnapshot(snapshot)
      this.set({ busy: null, dirty: true })
      await this.refreshProfiles()
    } catch (cause) {
      this.set({ busy: null, error: toIpcError(cause) })
    }
  }

  async setModsEnabled(modIds: string[], enabled: boolean): Promise<void> {
    if (modIds.length === 0) return
    this.set({ busy: enabled ? 'Enabling' : 'Disabling' })
    try {
      const snapshot = await this.client.setModsEnabled(modIds, enabled)
      this.setSnapshot(snapshot)
      this.set({ busy: null, dirty: true })
      await this.refreshProfiles()
    } catch (cause) {
      this.set({ busy: null, error: toIpcError(cause) })
    }
  }

  async toggleSelectionEnabled(): Promise<void> {
    const mods = this.state.snapshot?.mods ?? []
    const selected = mods.filter((mod) => this.state.selection.includes(mod.id))
    if (selected.length === 0) return
    const target = !selected.every((mod) => mod.isEnabled)
    await this.setModsEnabled(
      selected.map((mod) => mod.id),
      target,
    )
  }

  async moveSelection(target: MoveTarget): Promise<void> {
    const snapshot = this.state.snapshot
    if (!snapshot) return
    const enabled = snapshot.mods.filter((mod) => mod.isEnabled).map((mod) => mod.id)
    const selected = enabled.filter((id) => this.state.selection.includes(id))
    if (selected.length === 0) return
    const next = moveEnabled(enabled, selected, target)
    if (next.join('\u0000') === enabled.join('\u0000')) return
    await this.setLoadOrder(next)
  }

  async setLoadOrder(orderedModIds: string[]): Promise<void> {
    this.set({ busy: 'Saving load order' })
    try {
      const snapshot = await this.client.setLoadOrder(orderedModIds)
      this.setSnapshot(snapshot)
      this.set({ busy: null, dirty: true })
      await this.refreshProfiles()
    } catch (cause) {
      this.set({ busy: null, error: toIpcError(cause) })
    }
  }

  async reorder(draggedIds: string[], targetId: string | null): Promise<void> {
    const snapshot = this.state.snapshot
    if (!snapshot) return
    const enabled = snapshot.mods.filter((mod) => mod.isEnabled).map((mod) => mod.id)
    const dragged = new Set(draggedIds.filter((id) => enabled.includes(id)))
    if (dragged.size === 0) return
    if (targetId && dragged.has(targetId)) return
    const remaining = enabled.filter((id) => !dragged.has(id))
    const insertAt = targetId ? remaining.indexOf(targetId) : -1
    const moved = enabled.filter((id) => dragged.has(id))
    const next =
      insertAt < 0
        ? [...remaining, ...moved]
        : [...remaining.slice(0, insertAt), ...moved, ...remaining.slice(insertAt)]
    await this.setLoadOrder(next)
  }

  async applyProfile(profileId: string): Promise<void> {
    if (!profileId || profileId === this.state.snapshot?.activeProfileId) return
    this.set({ busy: 'Applying profile' })
    try {
      const snapshot = await this.client.applyProfile(profileId)
      this.setSnapshot(snapshot)
      this.set({ busy: null, dirty: true })
      await this.refreshProfiles()
      await this.refreshLaunchOptions()
    } catch (cause) {
      this.set({ busy: null, error: toIpcError(cause) })
    }
  }

  async saveProfile(name: string): Promise<boolean> {
    const enabled =
      this.state.snapshot?.mods.filter((mod) => mod.isEnabled).map((mod) => mod.id) ?? []
    return this.persistProfile(name, enabled, undefined, 'Profile saved')
  }

  async renameProfile(profileId: string, name: string): Promise<boolean> {
    const target = this.state.profiles?.profiles.find((profile) => profile.id === profileId)
    if (!target) {
      this.set({
        error: new IpcError({
          code: 'not_found',
          message: 'The profile no longer exists',
          details: profileId,
          retryable: false,
        }),
      })
      return false
    }
    return this.persistProfile(name, [...target.enabledModIds], profileId, 'Profile renamed')
  }

  private async persistProfile(
    name: string,
    enabled: string[],
    profileId: string | undefined,
    successMessage: string,
  ): Promise<boolean> {
    this.set({ busy: profileId ? 'Renaming profile' : 'Saving profile' })
    try {
      await this.client.saveProfile(name, enabled, profileId)
      const [snapshot, profiles] = await Promise.all([
        this.client.listMods(),
        this.client.listProfiles(),
      ])
      this.set({
        snapshot,
        profiles,
        busy: null,
        notice: { kind: 'success', message: successMessage },
      })
      return true
    } catch (cause) {
      this.set({ busy: null, error: toIpcError(cause) })
      return false
    }
  }

  async duplicateProfile(profileId: string, name: string): Promise<boolean> {
    this.set({ busy: 'Duplicating profile' })
    try {
      await this.client.duplicateProfile(profileId, name)
      this.set({ busy: null, notice: { kind: 'success', message: 'Profile duplicated' } })
      await this.refreshProfiles()
      return true
    } catch (cause) {
      this.set({ busy: null, error: toIpcError(cause) })
      return false
    }
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    this.set({ busy: 'Deleting profile' })
    try {
      const profiles = await this.client.deleteProfile(profileId)
      const snapshot = await this.client.listMods()
      this.setSnapshot(snapshot)
      this.set({
        profiles,
        busy: null,
        notice: { kind: 'success', message: 'Profile deleted' },
      })
      await this.refreshLaunchOptions()
      return true
    } catch (cause) {
      this.set({ busy: null, error: toIpcError(cause) })
      return false
    }
  }

  async createTag(name: string, color: string, assignToModId?: string): Promise<boolean> {
    this.set({ busy: 'Creating tag' })
    try {
      const tags = await this.client.createTag(name, color)
      this.set({ tags })
      if (assignToModId) {
        const mod = this.state.snapshot?.mods.find((item) => item.id === assignToModId)
        const created = tags.find((tag) => !mod?.tags.includes(tag.id))
        if (mod && created) {
          const snapshot = await this.client.setModTags(assignToModId, [...mod.tags, created.id])
          this.setSnapshot(snapshot)
        }
      }
      this.set({ busy: null, notice: { kind: 'success', message: 'Tag created' } })
      return true
    } catch (cause) {
      this.set({ busy: null, error: toIpcError(cause) })
      return false
    }
  }

  async toggleModTag(modId: string, tagId: string): Promise<void> {
    const mod = this.state.snapshot?.mods.find((item) => item.id === modId)
    if (!mod) return
    const tagIds = mod.tags.includes(tagId)
      ? mod.tags.filter((id) => id !== tagId)
      : [...mod.tags, tagId]
    this.set({ busy: 'Saving tags' })
    try {
      const snapshot = await this.client.setModTags(modId, tagIds)
      this.setSnapshot(snapshot)
      this.set({ busy: null })
    } catch (cause) {
      this.set({ busy: null, error: toIpcError(cause) })
    }
  }

  setQuery(query: string): void {
    this.set({ query, selection: [], anchorId: null })
  }

  toggleTagFilter(tagId: string): void {
    const active = this.state.activeTagIds.includes(tagId)
      ? this.state.activeTagIds.filter((id) => id !== tagId)
      : [...this.state.activeTagIds, tagId]
    this.set({ activeTagIds: active, selection: [], anchorId: null })
  }

  clearTagFilters(): void {
    this.set({ activeTagIds: [], selection: [], anchorId: null })
  }

  clearFilters(): void {
    this.set({ query: '', activeTagIds: [], selection: [], anchorId: null })
  }

  setView(view: View): void {
    this.set({ view, inspectorOpen: false })
    if (view === 'conflicts' && !this.state.conflicts) void this.refreshConflicts()
    if (view === 'workshop' && !this.state.workshop) void this.refreshWorkshop()
    if (view === 'settings') {
      void this.refreshLaunchOptions()
      void this.refreshConflicts()
    }
  }

  setSort(sort: SortMode): void {
    this.set({ sort, selection: [], anchorId: null })
  }

  openInspector(): void {
    this.set({ inspectorOpen: true })
  }

  closeInspector(): void {
    this.set({ inspectorOpen: false })
  }

  openLaunch(): void {
    this.set({ launchOpen: true, launchError: null, launchResult: null })
    void this.refreshLaunchOptions()
  }

  closeLaunch(): void {
    this.set({ launchOpen: false, launchError: null, launchResult: null })
  }

  async rescan(): Promise<void> {
    if (this.state.status !== 'ready') return
    this.set({ busy: 'Rescanning mods' })
    try {
      const [snapshot, profiles, tags, ui] = await Promise.all([
        this.client.listMods(),
        this.client.listProfiles(),
        this.client.listTags(),
        this.client.getUiPreferences(),
      ])
      this.setSnapshot(snapshot)
      this.set({ profiles, tags, ui, busy: null, error: null })
      await Promise.all([this.refreshConflicts(), this.refreshWorkshop()])
    } catch (cause) {
      this.set({ busy: null, error: toIpcError(cause) })
    }
  }

  async resetToDefaults(
    confirmUnmanagedLoss = false,
  ): Promise<ResetDefaultsReport | null> {
    this.set({ busy: 'Resetting settings and load order' })
    try {
      const report = await this.client.resetToDefaults(true, confirmUnmanagedLoss)
      let game: GameLocation | null = this.state.game
      try {
        game = await this.client.detectGame()
      } catch (cause) {
        if (toIpcError(cause).code !== 'game_not_found') throw cause
        game = null
      }
      const [snapshot, profiles, tags, ui] = await Promise.all([
        this.client.listMods(),
        this.client.listProfiles(),
        this.client.listTags(),
        this.client.getUiPreferences(),
      ])
      const outcome = report.loadOrder
      const written = outcome.status === 'written'
      this.set({
        status: game ? 'ready' : 'no-game',
        game,
        snapshot,
        profiles,
        tags,
        ui,
        busy: null,
        dirty: written || outcome.status === 'noGamePath' ? false : this.state.dirty,
        lastWriteAt: written
          ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : this.state.lastWriteAt,
        notice: written
          ? { kind: 'success', message: 'Settings and load order reset to defaults' }
          : outcome.status === 'noGamePath'
            ? {
                kind: 'warning',
                message: 'Settings reset; no game path was available for the load order',
              }
            : outcome.status === 'failed'
              ? {
                  kind: 'error',
                  message: outcome.message ?? 'The load order was not reset',
                }
              : null,
      })
      void this.refreshConflicts()
      return report
    } catch (cause) {
      this.set({ busy: null, error: toIpcError(cause) })
      return null
    }
  }

  select(modId: string, mode: SelectMode): void {
    const mods = visibleMods(this.state)
    const current = this.state.selection
    if (mode === 'single') {
      this.set({ selection: [modId], anchorId: modId })
      return
    }
    if (mode === 'toggle') {
      const next = current.includes(modId)
        ? current.filter((id) => id !== modId)
        : [...current, modId]
      this.set({ selection: next, anchorId: modId })
      return
    }
    const anchor = this.state.anchorId ?? modId
    const from = mods.findIndex((mod) => mod.id === anchor)
    const to = mods.findIndex((mod) => mod.id === modId)
    if (from < 0 || to < 0) {
      this.set({ selection: [modId], anchorId: modId })
      return
    }
    const [start, end] = from <= to ? [from, to] : [to, from]
    this.set({ selection: mods.slice(start, end + 1).map((mod) => mod.id) })
  }

  selectAllVisible(): void {
    const ids = visibleMods(this.state).map((mod) => mod.id)
    this.set({ selection: ids, anchorId: ids[0] ?? null })
  }

  clearSelection(): void {
    this.set({ selection: [], anchorId: null })
  }

  setDensity(density: Density): void {
    this.set({ ui: { ...this.state.ui, density } })
    void this.persistUi()
  }

  setShowThumbnails(showThumbnails: boolean): void {
    this.set({ ui: { ...this.state.ui, showThumbnails } })
    void this.persistUi()
  }

  setZoom(zoom: number): void {
    const next = clampZoom(zoom)
    if (next === this.state.ui.zoom) return
    this.set({
      ui: { ...this.state.ui, zoom: next },
      notice: { kind: 'info', message: `Zoom ${next}%` },
    })
    void this.persistUi()
  }

  zoomIn(): void {
    this.setZoom(stepZoom(this.state.ui.zoom, 1))
  }

  zoomOut(): void {
    this.setZoom(stepZoom(this.state.ui.zoom, -1))
  }

  resetZoom(): void {
    this.setZoom(ZOOM_DEFAULT)
  }

  noteScroll(top: number): void {
    this.pendingScrollTop = Math.max(0, Math.floor(top))
    if (this.scrollTimer) clearTimeout(this.scrollTimer)
    this.scrollTimer = setTimeout(() => {
      this.scrollTimer = null
      this.set({ ui: { ...this.state.ui, lastScrollTop: this.pendingScrollTop } })
      void this.persistUi()
    }, 400)
  }

  private async persistUi(): Promise<void> {
    try {
      await this.client.updateUiPreferences(this.state.ui)
    } catch (cause) {
      this.set({ error: toIpcError(cause) })
    }
  }

  async openLoadOrderDialog(): Promise<void> {
    this.set({ previewOpen: true, preview: null, busy: 'Preparing the load-order report' })
    try {
      const preview = await this.client.previewLoadOrder()
      this.set({ preview, busy: null })
    } catch (cause) {
      this.set({ busy: null, error: toIpcError(cause) })
    }
  }

  closeLoadOrderDialog(): void {
    this.set({ previewOpen: false, preview: null })
  }

  async writeLoadOrder(allowEmpty: boolean, confirmUnmanagedLoss: boolean): Promise<void> {
    this.set({ busy: 'Writing used_mods.txt' })
    try {
      const report = await this.client.writeLoadOrder(allowEmpty, confirmUnmanagedLoss)
      const [snapshot, profiles] = await Promise.all([
        this.client.listMods(),
        this.client.listProfiles(),
      ])
      this.set({
        snapshot,
        profiles,
        previewOpen: false,
        preview: null,
        busy: null,
        dirty: false,
        lastWriteAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        notice: {
          kind: 'success',
          message: `Wrote ${report.written} mod${report.written === 1 ? '' : 's'} to used_mods.txt`,
        },
      })
    } catch (cause) {
      this.set({ busy: null, error: toIpcError(cause) })
    }
  }

  async restoreLoadOrder(): Promise<void> {
    this.set({ busy: 'Restoring the load-order backup' })
    try {
      const loadOrder = await this.client.restoreLoadOrder()
      const snapshot = await this.client.listMods()
      this.set({
        snapshot: { ...snapshot, loadOrder },
        busy: null,
        dirty: false,
        lastWriteAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        notice: {
          kind: 'success',
          message: `Restored used_mods.txt (${loadOrder.modNames.length} mods)`,
        },
      })
    } catch (cause) {
      this.set({ busy: null, error: toIpcError(cause) })
    }
  }

  setError(payload: { code: IpcError['code']; message: string; details: string | null; retryable: boolean }): void {
    this.set({ error: new IpcError(payload) })
  }

  dismissError(): void {
    this.set({ error: null })
  }

  dismissNotice(): void {
    this.set({ notice: null })
  }

  dismissConflictError(): void {
    this.set({ conflictError: null })
  }

  dismissWorkshopError(): void {
    this.set({ workshopError: null })
  }

  dismissLaunchError(): void {
    this.set({ launchError: null })
  }
}

export function moveEnabled(enabled: string[], selected: string[], target: MoveTarget): string[] {
  if (selected.length === 0) return enabled
  const selectedSet = new Set(selected)
  const old = enabled.slice()
  if (target === 'top' || target === 'bottom') {
    const moving = enabled.filter((id) => selectedSet.has(id))
    const rest = enabled.filter((id) => !selectedSet.has(id))
    return target === 'top' ? [...moving, ...rest] : [...rest, ...moving]
  }
  if (target === 'up') {
    for (let index = 1; index < old.length; index += 1) {
      if (selectedSet.has(old[index]) && !selectedSet.has(old[index - 1])) {
        ;[old[index - 1], old[index]] = [old[index], old[index - 1]]
      }
    }
  } else {
    for (let index = old.length - 2; index >= 0; index -= 1) {
      if (selectedSet.has(old[index]) && !selectedSet.has(old[index + 1])) {
        ;[old[index], old[index + 1]] = [old[index + 1], old[index]]
      }
    }
  }
  return old
}

export const store = new AppStore()

export function useAppStore(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
