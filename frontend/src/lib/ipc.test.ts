import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  IpcError,
  fileUrl,
  ipc,
  toIpcError,
  type AppInfo,
  type LoadOrderWriteReport,
  type ModListSnapshot,
} from './ipc'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}))

const invokeMock = vi.mocked(invoke)
const convertFileSrcMock = vi.mocked(convertFileSrc)

const APP_INFO: AppInfo = {
  name: 'WH3 Mod Manager',
  version: '0.1.0',
  coreVersion: '0.1.0',
  platform: 'windows',
  arch: 'x86_64',
}

const SNAPSHOT: ModListSnapshot = {
  mods: [],
  enabledCount: 0,
  activeProfileId: 'profile-1',
  loadOrder: {
    path: 'C:/game/used_mods.txt',
    present: false,
    corrupt: false,
    message: null,
    unreadable: null,
    modNames: [],
    resolvedModIds: [],
    missingNames: [],
    duplicates: [],
    unmanagedDirectives: [],
    backupAvailable: false,
  },
  timings: { startupMs: 1, detectionMs: 1, scanMs: 1, loadOrderMs: 1, totalMs: 1 },
  warnings: [],
}

const WRITE_REPORT: LoadOrderWriteReport = {
  path: 'C:/game/used_mods.txt',
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

describe('ipc', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    convertFileSrcMock.mockClear()
  })

  it('round-trips app_info through the Tauri invoke bridge', async () => {
    invokeMock.mockResolvedValue(APP_INFO)
    await expect(ipc.appInfo()).resolves.toEqual(APP_INFO)
    expect(invokeMock).toHaveBeenCalledWith('app_info', {})
  })

  it('forwards camelCase arguments for mutation commands', async () => {
    invokeMock.mockResolvedValue(SNAPSHOT)
    await ipc.setModsEnabled(['a', 'b'], true)
    expect(invokeMock).toHaveBeenLastCalledWith('set_mods_enabled', {
      modIds: ['a', 'b'],
      enabled: true,
    })

    invokeMock.mockResolvedValue(SNAPSHOT)
    await ipc.setLoadOrder(['b', 'a'])
    expect(invokeMock).toHaveBeenLastCalledWith('set_load_order', { orderedModIds: ['b', 'a'] })

    invokeMock.mockResolvedValue(WRITE_REPORT)
    await ipc.writeLoadOrder(true, false)
    expect(invokeMock).toHaveBeenLastCalledWith('write_load_order', {
      allowEmpty: true,
      confirmUnmanagedLoss: false,
    })

    invokeMock.mockResolvedValue({
      density: 'compact',
      showThumbnails: true,
      lastScrollTop: 42,
    })
    await ipc.updateUiPreferences({
      density: 'compact',
      showThumbnails: true,
      lastScrollTop: 42,
    })
    expect(invokeMock).toHaveBeenLastCalledWith('update_ui_preferences', {
      preferences: { density: 'compact', showThumbnails: true, lastScrollTop: 42 },
    })
  })

  it('forwards null for clearing the manual game path', async () => {
    invokeMock.mockResolvedValue({
      gamePath: 'C:/game',
      dataPath: 'C:/game/data',
      workshopPath: 'C:/workshop',
      steamRoot: 'C:/steam',
      protonPrefix: null,
      source: 'auto',
    })
    await ipc.setGamePath(null)
    expect(invokeMock).toHaveBeenLastCalledWith('set_game_path', { gamePath: null })
  })

  it('normalizes the Rust error envelope into IpcError', async () => {
    invokeMock.mockRejectedValue({
      code: 'game_not_found',
      message: 'Could not locate WH3',
      details: 'checked 3 Steam libraries',
      retryable: true,
    })

    await expect(ipc.appInfo()).rejects.toMatchObject({
      name: 'IpcError',
      code: 'game_not_found',
      message: 'Could not locate WH3',
      details: 'checked 3 Steam libraries',
      retryable: true,
    })
  })

  it('turns unknown rejections into internal IpcError values', () => {
    const error = toIpcError(new Error('bridge closed'))
    expect(error).toBeInstanceOf(IpcError)
    expect(error.code).toBe('internal')
    expect(error.message).toBe('bridge closed')
    expect(error.retryable).toBe(false)
  })

  it('rejects malformed error payloads instead of trusting them', () => {
    const error = toIpcError({ code: 'made_up', message: 'nope', retryable: true })
    expect(error.code).toBe('internal')
    expect(error.message).toBe('Unknown IPC failure')
  })

  it('turns thumbnail paths into asset URLs only in this module', () => {
    expect(fileUrl('C:/game/thumb.png')).toBe('asset://localhost/C%3A%2Fgame%2Fthumb.png')
    convertFileSrcMock.mockImplementationOnce(() => {
      throw new Error('no bridge')
    })
    expect(fileUrl('C:/game/thumb.png')).toBe('C:/game/thumb.png')
  })
})
