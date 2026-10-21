import { describe, expect, it, vi } from 'vitest'
import { IpcError } from './lib/ipc'
import { AppStore, moveEnabled, visibleMods } from './store'
import {
  GAME,
  PROFILES,
  UI,
  makeClient,
  makeMod,
  makeSnapshot,
} from './test/mocks'

const MOD_A = makeMod({ id: 'mod-a', name: 'alpha.pack', isEnabled: true, loadOrder: 0 })
const MOD_B = makeMod({ id: 'mod-b', name: 'beta.pack', isEnabled: true, loadOrder: 1 })
const MOD_C = makeMod({ id: 'mod-c', name: 'gamma.pack', isEnabled: false, loadOrder: 2 })

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

  it('filters by search, author, and tags', async () => {
    const tagged = { ...MOD_B, author: 'Gelt', tags: ['tag-visual'] }
    // Seed state through the public init flow.
    const client = makeClient({
      listMods: vi.fn(async () => makeSnapshot([MOD_A, tagged, MOD_C])),
    })
    const seeded = new AppStore(client)
    await seeded.init()
    seeded.setQuery('gelt')
    expect(visibleMods(seeded.getState()).map((mod) => mod.id)).toEqual(['mod-b'])
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
