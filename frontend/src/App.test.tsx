import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { IpcError, ipc } from './lib/ipc'
import { store } from './store'
import {
  APP_INFO,
  PROFILES,
  TAGS,
  UI,
  makeMod,
  makeSnapshot,
} from './test/mocks'

vi.mock('./lib/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/ipc')>()
  const { makeClient } = await import('./test/mocks')
  return { ...actual, ipc: makeClient() }
})

const MOD_A = makeMod({ id: 'mod-a', name: 'alpha.pack', humanName: 'Alpha Legion', isEnabled: true, loadOrder: 0, tags: ['tag-overhaul'] })
const MOD_B = makeMod({ id: 'mod-b', name: 'beta.pack', humanName: 'Beta Bastion', author: 'Gelt', isEnabled: false, loadOrder: 1 })
const SNAPSHOT = makeSnapshot([MOD_A, MOD_B])

function mockReady(snapshot = SNAPSHOT) {
  vi.mocked(ipc.appInfo).mockResolvedValue(APP_INFO)
  vi.mocked(ipc.detectGame).mockResolvedValue({
    gamePath: 'C:/Steam/steamapps/common/Total War WARHAMMER III',
    dataPath: 'C:/Steam/steamapps/common/Total War WARHAMMER III/data',
    workshopPath: 'C:/Steam/steamapps/workshop/content/1142710',
    steamRoot: 'C:/Steam',
    protonPrefix: null,
    source: 'auto',
  })
  vi.mocked(ipc.listMods).mockResolvedValue(snapshot)
  vi.mocked(ipc.listProfiles).mockResolvedValue(PROFILES)
  vi.mocked(ipc.listTags).mockResolvedValue(TAGS)
  vi.mocked(ipc.getUiPreferences).mockResolvedValue(UI)
}

describe('App', () => {
  beforeEach(() => {
    store.reset()
    vi.clearAllMocks()
  })

  it('starts with the explicit game-not-found state and a manual path form', async () => {
    vi.mocked(ipc.appInfo).mockResolvedValue(APP_INFO)
    vi.mocked(ipc.detectGame).mockRejectedValue(
      new IpcError({
        code: 'game_not_found',
        message: 'Could not find a Total War: Warhammer III installation',
        details: 'Checked 2 Steam libraries',
        retryable: false,
      }),
    )

    render(<App />)

    expect(
      await screen.findByRole('heading', { name: /no total war: warhammer iii installation found/i }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Game folder')).toBeInTheDocument()
    expect(screen.getByText('Checked 2 Steam libraries')).toBeInTheDocument()
    expect(ipc.listMods).not.toHaveBeenCalled()
  })

  it('renders the mod list, counts, tags, and the active profile after boot', async () => {
    mockReady()
    render(<App />)

    const list = await screen.findByRole('listbox', { name: 'Mods' })
    expect(await within(list).findByText('Alpha Legion')).toBeInTheDocument()
    expect(within(list).getByText('Beta Bastion')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Load order' })).toBeInTheDocument()
    expect(screen.getByLabelText('Active profile')).toHaveValue('profile-default')
    expect(document.querySelector('.toolbar-count')?.textContent).toBe('1/2 enabled')
  })

  it('filters the list from the search box', async () => {
    mockReady()
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    fireEvent.change(screen.getByLabelText('Search mods'), { target: { value: 'beta' } })

    expect(await screen.findByRole('option', { name: /Beta Bastion/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Alpha Legion/ })).not.toBeInTheDocument()
  })

  it('toggles a mod and sends the boolean inverted from the row state', async () => {
    mockReady()
    vi.mocked(ipc.setModEnabled).mockResolvedValue(
      makeSnapshot([{ ...MOD_A, isEnabled: false }, MOD_B]),
    )
    render(<App />)

    const toggle = await screen.findByLabelText('Disable Alpha Legion')
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(ipc.setModEnabled).toHaveBeenCalledWith('mod-a', false)
    })
    expect(ipc.listProfiles).toHaveBeenCalled()
  })

  it('switches profiles and applies the returned enabled set', async () => {
    mockReady()
    vi.mocked(ipc.applyProfile).mockResolvedValue(
      makeSnapshot([MOD_A, { ...MOD_B, isEnabled: true }], {
        activeProfileId: 'profile-campaign',
        enabledCount: 2,
      }),
    )
    render(<App />)

    const select = await screen.findByLabelText('Active profile')
    fireEvent.change(select, { target: { value: 'profile-campaign' } })

    await waitFor(() => {
      expect(ipc.applyProfile).toHaveBeenCalledWith('profile-campaign')
    })
    expect(await screen.findByText(/2 of 2 enabled/)).toBeInTheDocument()
  })

  it('opens the load-order preview before allowing a write', async () => {
    mockReady()
    vi.mocked(ipc.previewLoadOrder).mockResolvedValue({
      path: 'C:/game/used_mods.txt',
      backupPath: 'C:/game/used_mods.txt.bak',
      written: 1,
      skipped: [],
      unmanagedDirectives: [],
      wouldDropUnmanaged: false,
      existingModCount: 0,
      resultingModCount: 1,
      canWrite: true,
      blockedReason: null,
      requiresEmptyConfirmation: false,
      requiresUnmanagedConfirmation: false,
      hardBlocked: false,
    })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Write load order' }))

    expect(await screen.findByRole('dialog', { name: 'Write used_mods.txt' })).toBeInTheDocument()
    expect(ipc.previewLoadOrder).toHaveBeenCalled()
    expect(screen.getByText('C:/game/used_mods.txt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Write 1 mod/ })).toBeEnabled()
  })

  it('shows a structured error screen when the workspace cannot load', async () => {
    vi.mocked(ipc.appInfo).mockResolvedValue(APP_INFO)
    vi.mocked(ipc.detectGame).mockResolvedValue({
      gamePath: 'C:/game',
      dataPath: 'C:/game/data',
      workshopPath: 'C:/workshop',
      steamRoot: 'C:/steam',
      protonPrefix: null,
      source: 'auto',
    })
    vi.mocked(ipc.listMods).mockRejectedValue(
      new IpcError({ code: 'io', message: 'The mod roll is locked', details: null, retryable: true }),
    )
    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('The mod roll is locked')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
