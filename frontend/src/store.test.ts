import { describe, expect, it, vi } from 'vitest'
import { IpcError } from './lib/ipc'
import { AppStore, moveEnabled, visibleMods } from './store'
import {
  GAME,
  EMPTY_CONFLICTS,
  PROFILE_CAMPAIGN,
  PROFILES,
  RESET_REPORT,
  UI,
  makeClient,
  makeMod,
  makeSnapshot,
} from './test/mocks'

const MOD_A = makeMod({ id: 'mod-a', name: 'alpha.pack', isEnabled: true, loadOrder: 0 })
const MOD_B = makeMod({ id: 'mod-b', name: 'beta.pack', isEnabled: true, loadOrder: 1 })
const MOD_C = makeMod({ id: 'mod-c', name: 'gamma.pack', isEnabled: false, loadOrder: 2 })

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

describe('AppStore', () => {
  it('boots into the ready state with the workspace data', async () => {
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B, MOD_C])),
    })
    const store = new AppStore(client)
    await store.init()
    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.game).toEqual(GAME)
    expect(state.snapshot?.mods).toHaveLength(3)
    expect(state.profiles).toEqual(PROFILES)
    expect(state.ui).toEqual(UI)
  })

  it('shows the explicit no-game state instead of an error screen', async () => {
    const client = makeClient({
      detectGame: vi.fn(async () => {
        throw new IpcError({
          code: 'game_not_found',
          message: 'Could not find WH3',
          details: 'checked 2 libraries',
          retryable: false,
        })
      }),
    })
    const store = new AppStore(client)
    await store.init()
    const state = store.getState()
    expect(state.status).toBe('no-game')
    expect(state.error?.code).toBe('game_not_found')
    expect(client.listMods).not.toHaveBeenCalled()
  })

  it('toggles a mod through the backend and refreshes the profile counts', async () => {
    const enabled = makeSnapshot([
      { ...MOD_A, isEnabled: true },
      { ...MOD_B, isEnabled: true },
      MOD_C,
    ])
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B, MOD_C])),
      setModEnabled: vi.fn(async () => enabled),
    })
    const store = new AppStore(client)
    await store.init()
    await store.toggleMod('mod-a')
    expect(client.setModEnabled).toHaveBeenCalledWith('mod-a', false)
    expect(store.getState().snapshot?.enabledCount).toBe(2)
    expect(client.listProfiles).toHaveBeenCalled()
  })

  it('moves the selected enabled mods and sends the complete order', async () => {
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B, MOD_C])),
      setLoadOrder: vi.fn(async () => makeSnapshot([MOD_B, MOD_A, MOD_C])),
    })
    const store = new AppStore(client)
    await store.init()
    store.select('mod-a', 'single')
    await store.moveSelection('down')
    expect(client.setLoadOrder).toHaveBeenCalledWith(['mod-b', 'mod-a'])
    const enabled = store
      .getState()
      .snapshot?.mods.filter((mod) => mod.isEnabled)
      .map((mod) => mod.name)
    expect(enabled).toEqual(['beta.pack', 'alpha.pack'])
  })

  it('updates checkboxes immediately and serializes rapid toggles without stale responses', async () => {
    const first = deferred<ReturnType<typeof makeSnapshot>>()
    const second = deferred<ReturnType<typeof makeSnapshot>>()
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B, MOD_C])),
      setModEnabled: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    })
    const store = new AppStore(client)
    await store.init()
    const disable = store.toggleMod('mod-a')
    expect(store.getState().snapshot?.enabledCount).toBe(1)
    expect(store.getState().snapshot?.mods.find((mod) => mod.id === 'mod-a')?.isEnabled).toBe(false)
    const enable = store.toggleMod('mod-a')
    expect(store.getState().snapshot?.enabledCount).toBe(2)
    expect(client.setModEnabled).toHaveBeenCalledTimes(1)
    first.resolve(makeSnapshot([MOD_B, { ...MOD_A, isEnabled: false }, MOD_C]))
    await vi.waitFor(() => expect(client.setModEnabled).toHaveBeenCalledTimes(2))
    expect(client.setModEnabled).toHaveBeenLastCalledWith('mod-a', true)
    expect(store.getState().snapshot?.mods.find((mod) => mod.id === 'mod-a')?.isEnabled).toBe(true)
    second.resolve(makeSnapshot([MOD_B, MOD_A, MOD_C]))
    await Promise.all([disable, enable])
    expect(store.getState().busy).toBeNull()
  })

  it('rolls back failed saves while preserving later queued edits', async () => {
    const first = deferred<ReturnType<typeof makeSnapshot>>()
    const second = deferred<ReturnType<typeof makeSnapshot>>()
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B, MOD_C])),
      setModEnabled: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    })
    const store = new AppStore(client)
    await store.init()
    const disable = store.toggleMod('mod-a')
    const enable = store.toggleMod('mod-c')
    first.reject(new Error('Disk unavailable'))
    await vi.waitFor(() => expect(client.setModEnabled).toHaveBeenCalledTimes(2))
    expect(store.getState().snapshot?.enabledCount).toBe(3)
    expect(store.getState().error?.message).toContain('Disk unavailable')
    second.resolve(makeSnapshot([MOD_A, MOD_B, { ...MOD_C, isEnabled: true }]))
    await Promise.all([disable, enable])
    expect(store.getState().snapshot?.enabledCount).toBe(3)
    expect(store.getState().dirty).toBe(true)
  })

  it('restores the snapshot and dirty state when a save fails', async () => {
    const saved = deferred<ReturnType<typeof makeSnapshot>>()
    const original = makeSnapshot([MOD_A, MOD_B, MOD_C])
    const store = new AppStore(makeClient({
      listMods: vi.fn(async () => original),
      setModEnabled: vi.fn(() => saved.promise),
    }))
    await store.init()
    const saving = store.toggleMod('mod-a')
    saved.reject(new Error('Disk unavailable'))
    await saving
    expect(store.getState().snapshot).toBe(original)
    expect(store.getState().dirty).toBe(false)
    expect(store.getState().busy).toBeNull()
  })

  it('reorders immediately and bases repeated moves on the visible order', async () => {
    const first = deferred<ReturnType<typeof makeSnapshot>>()
    const second = deferred<ReturnType<typeof makeSnapshot>>()
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B, MOD_C])),
      setLoadOrder: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    })
    const store = new AppStore(client)
    await store.init()
    store.select('mod-a', 'single')
    const down = store.moveSelection('down')
    expect(store.getState().snapshot?.mods.map((mod) => mod.id)).toEqual(['mod-b', 'mod-a', 'mod-c'])
    const up = store.moveSelection('up')
    expect(store.getState().snapshot?.mods.map((mod) => mod.id)).toEqual(['mod-a', 'mod-b', 'mod-c'])
    first.resolve(makeSnapshot([{ ...MOD_B, loadOrder: 0 }, { ...MOD_A, loadOrder: 1 }, MOD_C]))
    await vi.waitFor(() => expect(client.setLoadOrder).toHaveBeenCalledTimes(2))
    expect(client.setLoadOrder).toHaveBeenLastCalledWith(['mod-a', 'mod-b'])
    expect(store.getState().snapshot?.mods[0].id).toBe('mod-a')
    second.resolve(makeSnapshot([MOD_A, MOD_B, MOD_C]))
    await Promise.all([down, up])
    expect(client.listProfiles).toHaveBeenCalledTimes(2)
    expect(client.getConflicts).toHaveBeenCalledTimes(2)
  })

  it('ignores a save response after the store is reset', async () => {
    const saved = deferred<ReturnType<typeof makeSnapshot>>()
    const store = new AppStore(makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B, MOD_C])),
      setModEnabled: vi.fn(() => saved.promise),
    }))
    await store.init()
    const saving = store.toggleMod('mod-a')
    store.reset()
    saved.resolve(makeSnapshot([MOD_B, { ...MOD_A, isEnabled: false }, MOD_C]))
    await saving
    expect(store.getState().snapshot).toBeNull()
    expect(store.getState().dirty).toBe(false)
  })

  it('refreshes conflicts after an older scan finishes during rapid edits', async () => {
    const scan = deferred<typeof EMPTY_CONFLICTS>()
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B, MOD_C])),
      setModEnabled: vi.fn(async () => makeSnapshot([MOD_B, { ...MOD_A, isEnabled: false }, MOD_C])),
      getConflicts: vi.fn().mockReturnValueOnce(scan.promise).mockResolvedValue(EMPTY_CONFLICTS),
    })
    const store = new AppStore(client)
    await store.init()
    await store.toggleMod('mod-a')
    expect(client.getConflicts).toHaveBeenCalledTimes(1)
    scan.resolve(EMPTY_CONFLICTS)
    await vi.waitFor(() => expect(client.getConflicts).toHaveBeenCalledTimes(2))
    expect(store.getState().conflictLoading).toBe(false)
  })

  it('drops dragged enabled rows before the target row', async () => {
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B, MOD_C])),
      setLoadOrder: vi.fn(async () => makeSnapshot([MOD_B, MOD_A, MOD_C])),
    })
    const store = new AppStore(client)
    await store.init()
    await store.reorder(['mod-b'], 'mod-a')
    expect(client.setLoadOrder).toHaveBeenCalledWith(['mod-b', 'mod-a'])
  })

  it('ignores dropped disabled rows', async () => {
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B, MOD_C])),
    })
    const store = new AppStore(client)
    await store.init()
    await store.reorder(['mod-c'], 'mod-a')
    expect(client.setLoadOrder).not.toHaveBeenCalled()
  })

  it('renames a non-active profile with its saved set, not the visible one', async () => {
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B, MOD_C])),
      saveProfile: vi.fn(async () => ({ ...PROFILE_CAMPAIGN, name: 'Campaign renamed' })),
    })
    const store = new AppStore(client)
    await store.init()
    await store.renameProfile('profile-campaign', 'Campaign renamed')
    expect(client.saveProfile).toHaveBeenCalledWith(
      'Campaign renamed',
      PROFILE_CAMPAIGN.enabledModIds,
      'profile-campaign',
    )
    expect(store.getState().notice?.message).toBe('Profile renamed')
  })

  it('creates a profile from the visible enabled set', async () => {
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B, MOD_C])),
    })
    const store = new AppStore(client)
    await store.init()
    await store.saveProfile('Emperor')
    expect(client.saveProfile).toHaveBeenCalledWith('Emperor', ['mod-a', 'mod-b'], undefined)
  })

  it('refuses to rename a profile that is no longer loaded', async () => {
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B, MOD_C])),
    })
    const store = new AppStore(client)
    await store.init()
    await store.renameProfile('profile-gone', 'Nope')
    expect(client.saveProfile).not.toHaveBeenCalled()
    expect(store.getState().error?.code).toBe('not_found')
  })

  it('applies profiles and keeps the active id in the snapshot', async () => {
    const campaignSnapshot = makeSnapshot([MOD_A, MOD_B, MOD_C], {
      activeProfileId: 'profile-campaign',
      enabledCount: 1,
    })
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B, MOD_C])),
      applyProfile: vi.fn(async () => campaignSnapshot),
    })
    const store = new AppStore(client)
    await store.init()
    await store.applyProfile('profile-campaign')
    expect(client.applyProfile).toHaveBeenCalledWith('profile-campaign')
    expect(store.getState().snapshot?.activeProfileId).toBe('profile-campaign')
  })

  it('previews and writes the load order, then reports the result', async () => {
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, MOD_B])),
    })
    const store = new AppStore(client)
    await store.init()
    await store.openLoadOrderDialog()
    expect(store.getState().previewOpen).toBe(true)
    expect(store.getState().preview?.written).toBe(2)
    await store.writeLoadOrder(false, false)
    expect(client.writeLoadOrder).toHaveBeenCalledWith(false, false)
    expect(store.getState().previewOpen).toBe(false)
    expect(store.getState().notice?.kind).toBe('success')
  })

  it('re-detects the game after a reset so the source returns to automatic', async () => {
    const manual = { ...GAME, source: 'manual' as const }
    const auto = { ...GAME, source: 'auto' as const }
    const client = makeClient({
      detectGame: vi.fn().mockResolvedValueOnce(manual).mockResolvedValue(auto),
    })
    const store = new AppStore(client)
    await store.init()
    expect(store.getState().game?.source).toBe('manual')

    await store.resetToDefaults()

    expect(client.detectGame).toHaveBeenCalledTimes(2)
    expect(store.getState().game?.source).toBe('auto')
  })

  it('reports the real load-order reason when a reset is blocked', async () => {
    const blocked = {
      ...RESET_REPORT,
      loadOrder: {
        status: 'failed' as const,
        message: 'used_mods.txt is corrupt; restore the backup before writing again',
        unmanagedDirectives: [],
        requiresUnmanagedConfirmation: false,
      },
    }
    const client = makeClient({ resetToDefaults: vi.fn(async () => blocked) })
    const store = new AppStore(client)
    await store.init()

    await store.resetToDefaults()

    const notice = store.getState().notice
    expect(notice?.kind).toBe('error')
    expect(notice?.message).toContain('used_mods.txt is corrupt')
    expect(notice?.message).not.toContain('no game path')
  })

  it('sorts deterministically with an id tie-break in every non-drag mode', async () => {
    const mods = [
      makeMod({
        id: 'mod-z',
        name: 'z.pack',
        humanName: 'Same',
        updatedAt: '2026-10-20T12:00:00Z',
      }),
      makeMod({
        id: 'mod-a',
        name: 'a.pack',
        humanName: 'Same',
        updatedAt: '2026-10-20T12:00:00Z',
      }),
      makeMod({
        id: 'mod-m',
        name: 'm.pack',
        humanName: 'Alpha',
        updatedAt: '2026-10-21T12:00:00Z',
      }),
    ]
    const store = new AppStore(makeClient({ listMods: vi.fn(async () => makeSnapshot(mods)) }))
    await store.init()
    const order = () => visibleMods(store.getState()).map((mod) => mod.id)

    const sourceOrder = () =>
      store.getState().snapshot?.mods.map((mod) => mod.id)

    store.setSort('name')
    const sortedByName = order()
    expect(sortedByName).toEqual(['mod-m', 'mod-a', 'mod-z'])

    // Re-sorting after another mode must reproduce the identical order.
    store.setSort('updated')
    store.setSort('name')
    expect(order()).toEqual(sortedByName)
    expect(sourceOrder()).toEqual(['mod-z', 'mod-a', 'mod-m'])

    store.setSort('updated')
    expect(order()).toEqual(['mod-m', 'mod-a', 'mod-z'])

    store.setSort('load-order')
    expect(order()).toEqual(['mod-z', 'mod-a', 'mod-m'])
  })

  it('filters by search and tags without an author dimension', async () => {
    const tagged = { ...MOD_B, tags: ['tag-visual'] }
    // Seed state through the public init flow.
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, tagged, MOD_C])),
    })
    const seeded = new AppStore(client)
    await seeded.init()
    seeded.setQuery('beta')
    expect(visibleMods(seeded.getState()).map((mod) => mod.id)).toEqual(['mod-b'])
    seeded.setQuery('gelt')
    expect(visibleMods(seeded.getState())).toHaveLength(0)
    seeded.setQuery('')
    seeded.toggleTagFilter('tag-visual')
    expect(visibleMods(seeded.getState()).map((mod) => mod.id)).toEqual(['mod-b'])
    seeded.clearTagFilters()
    expect(visibleMods(seeded.getState())).toHaveLength(3)
  })
})

describe('moveEnabled', () => {
  it('moves a contiguous selection by one and to the edges', () => {
    expect(moveEnabled(['a', 'b', 'c', 'd'], ['b', 'c'], 'up')).toEqual(['b', 'c', 'a', 'd'])
    expect(moveEnabled(['a', 'b', 'c', 'd'], ['b', 'c'], 'down')).toEqual(['a', 'd', 'b', 'c'])
    expect(moveEnabled(['a', 'b', 'c', 'd'], ['c', 'a'], 'top')).toEqual(['a', 'c', 'b', 'd'])
    expect(moveEnabled(['a', 'b', 'c', 'd'], ['a', 'c'], 'bottom')).toEqual(['b', 'd', 'a', 'c'])
  })
})
