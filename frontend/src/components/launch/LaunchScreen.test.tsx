import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IpcError } from '../../lib/ipc'
import { GAME, LAUNCH_OPTIONS, LAUNCH_RESULT } from '../../test/mocks'
import { LaunchScreen } from './LaunchScreen'

describe('LaunchScreen', () => {
  it('changes a launch option and requests a launch', () => {
    const onToggle = vi.fn()
    const onLaunch = vi.fn()
    render(
      <LaunchScreen
        game={GAME}
        options={LAUNCH_OPTIONS}
        result={null}
        error={null}
        busy={false}
        onToggle={onToggle}
        onLaunch={onLaunch}
        onDismissError={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /Skip intro movies/ }))
    expect(onToggle).toHaveBeenCalledWith('skipIntro', true)
    fireEvent.click(screen.getByRole('button', { name: 'Launch game' }))
    expect(onLaunch).toHaveBeenCalled()
    expect(screen.getByText(GAME.gamePath)).toBeInTheDocument()
  })

  it('shows a launch failure and the request result', () => {
    const error = new IpcError({
      code: 'steam_not_found',
      message: 'Steam was not found',
      details: null,
      retryable: false,
    })
    const { rerender } = render(
      <LaunchScreen
        game={GAME}
        options={LAUNCH_OPTIONS}
        result={null}
        error={error}
        busy={false}
        onToggle={() => {}}
        onLaunch={() => {}}
        onDismissError={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Steam was not found')

    rerender(
      <LaunchScreen
        game={GAME}
        options={LAUNCH_OPTIONS}
        result={LAUNCH_RESULT}
        error={null}
        busy={false}
        onToggle={() => {}}
        onLaunch={() => {}}
        onDismissError={() => {}}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('launch requested through Steam')
  })
})
