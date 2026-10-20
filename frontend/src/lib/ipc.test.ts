import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcError, ipc, toIpcError, type AppInfo } from './ipc'

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

  it('rejects malformed error payloads instead of trusting them', () => {
    const error = toIpcError({ code: 'made_up', message: 'nope', retryable: true })

    expect(error.code).toBe('internal')
    expect(error.message).toBe('Unknown IPC failure')
  })
})
