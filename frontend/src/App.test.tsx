import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { IpcError, ipc, type AppInfo } from './lib/ipc'

vi.mock('./lib/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/ipc')>()
  return {
    ...actual,
    ipc: {
      appInfo: vi.fn(),
    },
  }
})

const appInfoMock = vi.mocked(ipc.appInfo)

const APP_INFO: AppInfo = {
  name: 'WH3 Mod Manager',
  version: '0.1.0',
  coreVersion: '0.1.0',
  platform: 'windows',
  arch: 'x86_64',
}

describe('App', () => {
  beforeEach(() => {
    appInfoMock.mockReset()
  })

  it('renders the shell and the app_info round trip', async () => {
    appInfoMock.mockResolvedValue(APP_INFO)

    render(<App />)

    expect(screen.getByRole('heading', { name: /warhammer iii/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /load order/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('IPC live')).toBeInTheDocument()
    })

    const backendPanel = screen.getByRole('heading', { name: 'Rust core' }).closest('section')
    expect(backendPanel).not.toBeNull()
    expect(within(backendPanel as HTMLElement).getByText(/wh3mm-core/)).toBeInTheDocument()
    expect(within(backendPanel as HTMLElement).getByText(/windows/)).toBeInTheDocument()
  })

  it('shows structured backend errors', async () => {
    appInfoMock.mockRejectedValue(
      new IpcError({
        code: 'game_not_found',
        message: 'Could not locate WH3',
        details: 'checked 3 Steam libraries',
        retryable: true,
      }),
    )

    render(<App />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('game_not_found')
    expect(alert).toHaveTextContent('Could not locate WH3')
    expect(alert).toHaveTextContent('checked 3 Steam libraries')
  })
})
