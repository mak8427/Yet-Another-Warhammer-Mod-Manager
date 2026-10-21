import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  IpcError,
  ipc,
  toIpcError,
  type AppInfo,
  type LoadOrderWriteReport,
  type LoadOrderWriteRequest,
} from './ipc'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const invokeMock = vi.mocked(invoke)

const APP_INFO: AppInfo = {
  name: 'WH3 Mod Manager',
  version: '0.1.0',
  coreVersion: '0.1.0',
  platform: 'windows',
  arch: 'x86_64',
}

const WRITE_REQUEST: LoadOrderWriteRequest = {
  allowEmpty: false,
  confirmUnmanagedLoss: false,
}

const WRITE_REPORT: LoadOrderWriteReport = {
  path: 'C:/game/used_mods.txt',
  backupPath: 'C:/game/used_mods.txt.bak',
  written: 2,
  skipped: ['missing.pack'],
  unmanagedDirectives: ['add_working_directory "C:/mods";'],
}

describe('ipc', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('round-trips app_info through the Tauri invoke bridge', async () => {
    invokeMock.mockResolvedValue(APP_INFO)

    await expect(ipc.appInfo()).resolves.toEqual(APP_INFO)
    expect(invokeMock).toHaveBeenCalledWith('app_info', {})
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

  it('previews the load order without a request payload', async () => {
    invokeMock.mockResolvedValue(WRITE_REPORT)

    await expect(ipc.previewLoadOrder()).resolves.toEqual(WRITE_REPORT)
    expect(invokeMock).toHaveBeenCalledWith('preview_load_order', {})
  })

  it('forwards the load-order write confirmation flags', async () => {
    invokeMock.mockResolvedValue(WRITE_REPORT)
    const request: LoadOrderWriteRequest = {
      allowEmpty: true,
      confirmUnmanagedLoss: true,
    }

    await expect(ipc.writeLoadOrder(request)).resolves.toEqual(WRITE_REPORT)
    expect(invokeMock).toHaveBeenCalledWith('write_load_order', request)
  })

  it('surfaces the unmanaged-directive refusal as validation', async () => {
    invokeMock.mockRejectedValue({
      code: 'validation',
      message: 'Writing the load order would drop unmanaged directives.',
      details:
        '1 unmanaged directive(s) would be removed; pass confirmUnmanagedLoss: true to proceed: add_working_directory "C:/mods";',
      retryable: false,
    })

    await expect(ipc.writeLoadOrder(WRITE_REQUEST)).rejects.toMatchObject({
      name: 'IpcError',
      code: 'validation',
      message: 'Writing the load order would drop unmanaged directives.',
      details:
        '1 unmanaged directive(s) would be removed; pass confirmUnmanagedLoss: true to proceed: add_working_directory "C:/mods";',
      retryable: false,
    })
  })

  it('surfaces the empty-load-order refusal as validation', async () => {
    invokeMock.mockRejectedValue({
      code: 'validation',
      message: 'Writing would empty a non-empty load order.',
      details:
        'The existing file has 3 managed mod line(s); pass allowEmpty: true to write an empty list.',
      retryable: false,
    })

    await expect(ipc.writeLoadOrder(WRITE_REQUEST)).rejects.toMatchObject({
      name: 'IpcError',
      code: 'validation',
      message: 'Writing would empty a non-empty load order.',
      details:
        'The existing file has 3 managed mod line(s); pass allowEmpty: true to write an empty list.',
      retryable: false,
    })
  })

  it('rejects malformed error payloads instead of trusting them', () => {
    const error = toIpcError({ code: 'made_up', message: 'nope', retryable: true })

    expect(error.code).toBe('internal')
    expect(error.message).toBe('Unknown IPC failure')
  })
})
