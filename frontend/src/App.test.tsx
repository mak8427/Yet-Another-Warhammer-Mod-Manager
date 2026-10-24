import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { IpcError, ipc, type ModListSnapshot } from './lib/ipc'
import { store } from './store'
import {
  APP_INFO,
  CONFLICT_REPORT,
  PROFILE_CAMPAIGN,
  PROFILES,
  PROTON_LAUNCH_RESULT,
  TAGS,
  UI,
  WRITE_REPORT,
  makeMod,
  makeSnapshot,
} from './test/mocks'

vi.mock('./lib/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/ipc')>()
  const { makeClient } = await import('./test/mocks')
  return { ...actual, ipc: makeClient() }
})

const MOD_A = makeMod({ id: 'mod-a', name: 'alpha.pack', humanName: 'Alpha Legion', isEnabled: true, loadOrder: 0, tags: ['tag-overhaul'] })
const MOD_B = makeMod({ id: 'mod-b', name: 'beta.pack', humanName: 'Beta Bastion', isEnabled: false, loadOrder: 1 })
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

function mockViewportOverlay(overlay: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: overlay,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

describe('App', () => {
  beforeEach(() => {
    store.reset()
    vi.clearAllMocks()
    mockViewportOverlay(false)
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
      await screen.findByRole('heading', { name: /warhammer iii was not found/i }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Game folder')).toBeInTheDocument()
    expect(screen.getByText('Checked 2 Steam libraries')).toBeInTheDocument()
    expect(ipc.listMods).not.toHaveBeenCalled()
  })

  it('shows a Linux game-folder placeholder when the app runs on Linux', async () => {
    vi.mocked(ipc.appInfo).mockResolvedValue({ ...APP_INFO, platform: 'linux' })
    vi.mocked(ipc.detectGame).mockRejectedValue(
      new IpcError({
        code: 'game_not_found',
        message: 'Could not find a Total War: Warhammer III installation',
        details: null,
        retryable: false,
      }),
    )

    render(<App />)

    const input = await screen.findByLabelText('Game folder')
    expect(input).toHaveAttribute(
      'placeholder',
      '/mnt/games/SteamLibrary/steamapps/common/Total War WARHAMMER III',
    )
  })

  it('renders the mod list, counts, tags, and the active profile after boot', async () => {
    mockReady()
    render(<App />)

    const list = await screen.findByRole('listbox', { name: 'Mods' })
    expect(await within(list).findByText('Alpha Legion')).toBeInTheDocument()
    expect(within(list).getByText('Beta Bastion')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mods' })).toBeInTheDocument()
    expect(screen.getByLabelText('Active profile')).toHaveValue('profile-default')
    expect(document.querySelector('.toolbar-count')?.textContent).toBe('2 mods')
    expect(screen.getByText(/Ready · 2 mods · 1 enabled/)).toBeInTheDocument()
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
    expect(await screen.findByLabelText('Enable Alpha Legion')).not.toBeChecked()
    expect(await screen.findByText('Ready · 2 mods · 0 enabled')).toBeInTheDocument()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(ipc.listProfiles).toHaveBeenCalledTimes(2)
  })

  it('keeps profile switching blocked until a mod save finishes', async () => {
    mockReady()
    let finishSave!: (snapshot: ModListSnapshot) => void
    vi.mocked(ipc.setModEnabled).mockReturnValueOnce(new Promise((resolve) => {
      finishSave = resolve
    }))
    render(<App />)
    fireEvent.click(await screen.findByLabelText('Disable Alpha Legion'))

    expect(screen.getByLabelText('Active profile')).toBeDisabled()
    await act(async () => {
      finishSave(makeSnapshot([{ ...MOD_A, isEnabled: false }, MOD_B]))
    })
    expect(await screen.findByLabelText('Enable Alpha Legion')).not.toBeChecked()
    expect(screen.getByLabelText('Active profile')).toBeEnabled()
    expect(screen.getByText('Ready · 2 mods · 0 enabled')).toBeInTheDocument()
  })

  it('shows a failed mod save, preserves the enabled state, and allows retry', async () => {
    mockReady()
    vi.mocked(ipc.setModEnabled)
      .mockRejectedValueOnce(new IpcError({
        code: 'io',
        message: 'Could not save the mod configuration',
        details: 'Disk is full',
        retryable: true,
      }))
      .mockResolvedValueOnce(makeSnapshot([{ ...MOD_A, isEnabled: false }, MOD_B]))
    render(<App />)
    fireEvent.click(await screen.findByLabelText('Disable Alpha Legion'))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Could not save the mod configuration')).toBeInTheDocument()
    expect(within(alert).getByText('Disk is full')).toBeInTheDocument()
    expect(screen.getByLabelText('Disable Alpha Legion')).toBeChecked()
    expect(screen.getByLabelText('Active profile')).toBeEnabled()
    expect(screen.getByText('Ready · 2 mods · 1 enabled')).toBeInTheDocument()
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Disable Alpha Legion'))
    expect(await screen.findByLabelText('Enable Alpha Legion')).not.toBeChecked()
    expect(await screen.findByText('Ready · 2 mods · 0 enabled')).toBeInTheDocument()
    expect(ipc.setModEnabled).toHaveBeenNthCalledWith(1, 'mod-a', false)
    expect(ipc.setModEnabled).toHaveBeenNthCalledWith(2, 'mod-a', false)
  })

  it('drags a multi-selection as a group and displays the saved positions', async () => {
    const beta = { ...MOD_B, isEnabled: true }
    const gamma = makeMod({ id: 'mod-c', name: 'gamma.pack', humanName: 'Gamma Guard', isEnabled: true, loadOrder: 2 })
    const disabled = makeMod({ id: 'mod-d', name: 'delta.pack', humanName: 'Delta Dawn', loadOrder: 3 })
    mockReady(makeSnapshot([MOD_A, beta, gamma, disabled]))
    vi.mocked(ipc.setLoadOrder).mockResolvedValueOnce(makeSnapshot([
      { ...beta, loadOrder: 0 },
      { ...gamma, loadOrder: 1 },
      { ...MOD_A, loadOrder: 2 },
      disabled,
    ]))
    render(<App />)
    const list = await screen.findByRole('listbox', { name: 'Mods' })
    const first = within(list).getByRole('option', { name: /Alpha Legion/ })
    const dragged = within(list).getByRole('option', { name: /Beta Bastion/ })
    fireEvent.click(dragged)
    fireEvent.click(within(list).getByRole('option', { name: /Gamma Guard/ }), { ctrlKey: true })
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(dragged, { dataTransfer })
    fireEvent.dragOver(first, { dataTransfer })
    fireEvent.drop(first, { dataTransfer })

    await waitFor(() => {
      expect(within(list).getAllByRole('option').map((row) => row.dataset.modId))
        .toEqual(['mod-b', 'mod-c', 'mod-a', 'mod-d'])
    })
    expect(ipc.setLoadOrder).toHaveBeenCalledExactlyOnceWith(['mod-b', 'mod-c', 'mod-a'])
    expect(within(list).getAllByRole('option').map((row) => row.querySelector('.row-order')?.textContent))
      .toEqual(['1', '2', '3', '–'])
    expect(within(list).getByRole('option', { name: /Beta Bastion/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(list).getByRole('option', { name: /Gamma Guard/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(list).getByLabelText('Enable Delta Dawn')).not.toBeChecked()
    expect(await screen.findByText('Ready · 4 mods · 3 enabled')).toBeInTheDocument()
  })

  it('navigates to the conflict report and shows the winning mod', async () => {
    mockReady()
    vi.mocked(ipc.getConflicts).mockResolvedValue(CONFLICT_REPORT)
    render(<App />)

    await screen.findByRole('listbox', { name: 'Mods' })
    fireEvent.click(screen.getByRole('button', { name: /Conflicts/ }))

    expect(await screen.findByRole('heading', { name: 'Conflicts' })).toBeInTheDocument()
    expect(await screen.findByText('db/units_tables/units')).toBeInTheDocument()
    expect(screen.getAllByText('beta.pack').length).toBeGreaterThan(0)
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
    expect(await screen.findByText(/Ready · 2 mods · 2 enabled/)).toBeInTheDocument()
  })

  it('opens the tag menu without pushing the toolbar (WAR-147)', async () => {
    mockReady()
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    fireEvent.click(screen.getByRole('button', { name: /^Tags/ }))
    const menu = await screen.findByRole('menu', { name: 'Tags' })
    expect(within(menu).getByRole('menuitemcheckbox', { name: /Overhaul/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Tags/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('gives every screen a faction-framed header (WAR-147)', async () => {
    mockReady()
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    const rail = screen.getByRole('navigation', { name: 'Sections' })
    const screens = [
      ['Profiles', '.profiles-screen', 'azure'],
      ['Conflicts', '.conflict-screen', 'ember'],
      ['Workshop', '.workshop-screen', 'copper'],
      ['Settings', '.settings-screen', 'jade'],
    ] as const

    expect(document.querySelector('.mods-screen')).toHaveAttribute('data-faction', 'brass')
    for (const [label, selector, faction] of screens) {
      fireEvent.click(within(rail).getByRole('button', { name: label }))
      await screen.findByRole('heading', { name: label })
      expect(document.querySelector(selector)).toHaveAttribute('data-faction', faction)
    }
  })

  it('renames a non-active profile without replacing its enabled set', async () => {
    mockReady()
    vi.mocked(ipc.saveProfile).mockResolvedValue({ ...PROFILE_CAMPAIGN, name: 'Campaign renamed' })
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    fireEvent.click(screen.getByRole('button', { name: /^Profiles/ }))
    const profileTable = await screen.findByRole('table')
    const profileRow = within(profileTable).getByText(PROFILE_CAMPAIGN.name).closest('tr')
    expect(profileRow).not.toBeNull()
    fireEvent.click(profileRow as HTMLTableRowElement)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    const dialog = await screen.findByRole('dialog', { name: 'Rename profile' })
    fireEvent.change(within(dialog).getByLabelText('Profile name'), {
      target: { value: 'Campaign renamed' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }))

    await waitFor(() => {
      expect(ipc.saveProfile).toHaveBeenCalledWith(
        'Campaign renamed',
        PROFILE_CAMPAIGN.enabledModIds,
        'profile-campaign',
      )
    })
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

    fireEvent.click(await screen.findByRole('button', { name: 'Apply load order' }))

    expect(await screen.findByRole('dialog', { name: 'Write used_mods.txt' })).toBeInTheDocument()
    expect(ipc.previewLoadOrder).toHaveBeenCalled()
    expect(screen.getByText('C:/game/used_mods.txt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Write 1 mod/ })).toBeEnabled()
  })

  it('resets settings and the load order after confirmation', async () => {
    mockReady()
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    const rail = screen.getByRole('navigation', { name: 'Sections' })
    fireEvent.click(within(rail).getByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reset settings and load order' }))

    const dialog = await screen.findByRole('dialog', { name: 'Reset to defaults' })
    expect(dialog).toHaveTextContent(/clear the game-path override/i)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset settings and load order' }))

    await waitFor(() => {
      expect(ipc.resetToDefaults).toHaveBeenCalledWith(true, false)
    })
    expect(ipc.listMods).toHaveBeenCalled()
    expect(await screen.findByText('Settings and load order reset to defaults')).toBeInTheDocument()
  })

  it('asks before dropping unmanaged directives during reset', async () => {
    mockReady()
    vi.mocked(ipc.resetToDefaults).mockResolvedValueOnce({
      loadOrder: {
        status: 'unmanagedDirectives',
        message: 'used_mods.txt contains unmanaged directives that this write would remove',
        unmanagedDirectives: ['custom_directive "C:/tools";'],
        requiresUnmanagedConfirmation: true,
      },
    })
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    const rail = screen.getByRole('navigation', { name: 'Sections' })
    fireEvent.click(within(rail).getByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reset settings and load order' }))

    const dialog = await screen.findByRole('dialog', { name: 'Reset to defaults' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset settings and load order' }))

    const warning = await screen.findByRole('dialog', { name: 'Drop unmanaged directives?' })
    expect(warning).toHaveTextContent('custom_directive "C:/tools";')
    expect(ipc.resetToDefaults).toHaveBeenCalledWith(true, false)
    expect(screen.queryByText('Settings and load order reset to defaults')).not.toBeInTheDocument()

    fireEvent.click(within(warning).getByRole('button', { name: 'Drop directives and reset' }))

    await waitFor(() => {
      expect(ipc.resetToDefaults).toHaveBeenLastCalledWith(true, true)
    })
    expect(await screen.findByText('Settings and load order reset to defaults')).toBeInTheDocument()
  })

  it('shows a failure instead of a success toast when the reset cannot write the order', async () => {
    mockReady()
    vi.mocked(ipc.resetToDefaults).mockResolvedValueOnce({
      loadOrder: {
        status: 'failed',
        message: 'used_mods.txt is corrupt; restore the backup before writing again',
        unmanagedDirectives: [],
        requiresUnmanagedConfirmation: false,
      },
    })
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    const rail = screen.getByRole('navigation', { name: 'Sections' })
    fireEvent.click(within(rail).getByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reset settings and load order' }))

    const dialog = await screen.findByRole('dialog', { name: 'Reset to defaults' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset settings and load order' }))

    expect(
      await screen.findByText('used_mods.txt is corrupt; restore the backup before writing again'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Settings and load order reset to defaults')).not.toBeInTheDocument()
    expect(screen.queryByText('Settings reset; no game path was available for the load order')).not.toBeInTheDocument()
  })

  it('opens the launch dialog and requests a direct launch', async () => {
    mockReady()
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    fireEvent.click(screen.getByRole('button', { name: 'Launch game' }))
    const dialog = await screen.findByRole('dialog', { name: 'Launch Warhammer III' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Launch game' }))

    await waitFor(() => {
      expect(ipc.launchGame).toHaveBeenCalled()
    })
    const status = await within(dialog).findByRole('status')
    expect(status).toHaveTextContent('launch requested directly')
    expect(status).toHaveTextContent('direct')
  })

  it('reports a direct Proton launch result', async () => {
    mockReady()
    vi.mocked(ipc.launchGame).mockResolvedValueOnce(PROTON_LAUNCH_RESULT)
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    fireEvent.click(screen.getByRole('button', { name: 'Launch game' }))
    const dialog = await screen.findByRole('dialog', { name: 'Launch Warhammer III' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Launch game' }))

    const status = await within(dialog).findByRole('status')
    expect(status).toHaveTextContent('launch requested through Proton')
    expect(status).toHaveTextContent('proton')
  })

  it('changes density from settings and persists it', async () => {
    mockReady()
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    const rail = screen.getByRole('navigation', { name: 'Sections' })
    fireEvent.click(within(rail).getByRole('button', { name: 'Settings' }))
    fireEvent.change(await screen.findByLabelText('Density'), { target: { value: 'roomy' } })

    await waitFor(() => {
      expect(ipc.updateUiPreferences).toHaveBeenCalledWith(expect.objectContaining({ density: 'roomy' }))
    })
    expect(document.documentElement.dataset.density).toBe('roomy')
  })

  it('changes zoom from the keyboard even while typing and persists it', async () => {
    mockReady()
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    const search = screen.getByLabelText('Search mods')
    search.focus()
    fireEvent.keyDown(search, { key: '=', ctrlKey: true })

    await waitFor(() => {
      expect(ipc.updateUiPreferences).toHaveBeenCalledWith(expect.objectContaining({ zoom: 110 }))
    })
    expect(await screen.findByText('Zoom 110%')).toBeInTheDocument()

    fireEvent.keyDown(search, { key: '0', ctrlKey: true })
    await waitFor(() => {
      expect(ipc.updateUiPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 100 }))
    })
    expect(await screen.findByText('Zoom 100%')).toBeInTheDocument()

    fireEvent.keyDown(search, { key: '-', ctrlKey: true })
    await waitFor(() => {
      expect(ipc.updateUiPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 90 }))
    })
  })

  it('changes zoom from settings and resets it', async () => {
    mockReady()
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    const rail = screen.getByRole('navigation', { name: 'Sections' })
    fireEvent.click(within(rail).getByRole('button', { name: 'Settings' }))
    await screen.findByRole('heading', { name: 'Settings' })

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByLabelText('Current zoom')).toHaveTextContent('110%')

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByLabelText('Current zoom')).toHaveTextContent('100%')

    await waitFor(() => {
      expect(ipc.updateUiPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 100 }))
    })
  })

  it('zooms with Ctrl and the mouse wheel', async () => {
    mockReady()
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    fireEvent.wheel(window, { deltaY: -120, ctrlKey: true })

    await waitFor(() => {
      expect(ipc.updateUiPreferences).toHaveBeenCalledWith(expect.objectContaining({ zoom: 110 }))
    })
  })

  it('offers no author toggle in settings', async () => {
    mockReady()
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    const rail = screen.getByRole('navigation', { name: 'Sections' })
    fireEvent.click(within(rail).getByRole('button', { name: 'Settings' }))

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByText('Show authors')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Show authors')).not.toBeInTheDocument()
  })

  it('switches sections with Ctrl+1..5 and focuses search with Ctrl+F', async () => {
    mockReady()
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    fireEvent.keyDown(window, { key: '3', ctrlKey: true })
    expect(await screen.findByRole('heading', { name: 'Conflicts' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '1', ctrlKey: true })
    await screen.findByRole('listbox', { name: 'Mods' })

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    expect(screen.getByLabelText('Search mods')).toHaveFocus()
  })

  it('focuses search from another screen with Ctrl+F', async () => {
    mockReady()
    render(<App />)
    await screen.findByRole('listbox', { name: 'Mods' })

    const rail = screen.getByRole('navigation', { name: 'Sections' })
    fireEvent.click(within(rail).getByRole('button', { name: 'Settings' }))
    await screen.findByRole('heading', { name: 'Settings' })

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })

    expect(await screen.findByRole('heading', { name: 'Mods' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText('Search mods')).toHaveFocus()
    })
  })

  it('cycles F6 through the visible regions at 1280px and wider', async () => {
    mockReady()
    render(<App />)
    const list = await screen.findByRole('listbox', { name: 'Mods' })
    const row = within(list).getAllByRole('option')[0]
    row.focus()

    fireEvent.keyDown(window, { key: 'F6' })
    expect(document.activeElement?.closest('[data-region="inspector"]')).not.toBeNull()

    fireEvent.keyDown(window, { key: 'F6' })
    expect(document.activeElement?.closest('[data-region="rail"]')).not.toBeNull()
  })

  it('skips the closed overlay inspector and hidden toolbar content below 1280px', async () => {
    mockReady()
    render(<App />)
    const list = await screen.findByRole('listbox', { name: 'Mods' })
    const row = within(list).getAllByRole('option')[0]
    const title = document.querySelector<HTMLElement>('[data-screen-title]')
    expect(title).not.toBeNull()
    if (title) title.style.display = 'none'
    row.focus()
    mockViewportOverlay(true)

    fireEvent.keyDown(window, { key: 'F6' })
    expect(document.activeElement?.closest('[data-region="rail"]')).not.toBeNull()

    fireEvent.keyDown(window, { key: 'F6' })
    expect(screen.getByLabelText('Search mods')).toHaveFocus()

    fireEvent.keyDown(window, { key: 'F6' })
    expect(document.activeElement?.closest('[data-region="list"]')).not.toBeNull()

    row.focus()
    fireEvent.keyDown(window, { key: 'F6', shiftKey: true })
    expect(screen.getByLabelText('Search mods')).toHaveFocus()
  })

  it('focuses Cancel and marks the write action dangerous when directives are dropped', async () => {
    mockReady()
    vi.mocked(ipc.previewLoadOrder).mockResolvedValue({
      ...WRITE_REPORT,
      unmanagedDirectives: ['mod "legacy.pack";'],
      wouldDropUnmanaged: true,
      requiresUnmanagedConfirmation: true,
    })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Apply load order' }))
    const dialog = await screen.findByRole('dialog', { name: 'Write used_mods.txt' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: /Write 2 mods/ })).toHaveClass('btn-danger')
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
