import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IpcError } from '../../lib/ipc'
import { WORKSHOP_ITEMS } from '../../test/mocks'
import { WorkshopScreen } from './WorkshopScreen'

describe('WorkshopScreen', () => {
  it('renders subscriptions and dispatches a Steam action', () => {
    const onAction = vi.fn()
    render(
      <WorkshopScreen
        items={WORKSHOP_ITEMS}
        loading={false}
        busy={false}
        error={null}
        onRefresh={() => {}}
        onDismissError={() => {}}
        onAction={onAction}
      />,
    )

    expect(screen.getByText('Installed Mod')).toBeInTheDocument()
    expect(screen.getByText('Update pending')).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    fireEvent.click(screen.getAllByRole('button', { name: 'Unsubscribe' })[0])
    expect(onAction).toHaveBeenCalledWith('unsubscribe', '111')
    expect(rows.length).toBeGreaterThan(1)
  })

  it('shows the Steam-unavailable error state', () => {
    const error = new IpcError({
      code: 'steam_not_found',
      message: 'Steam Workshop metadata was not found',
      details: 'Checked appworkshop_3247630.acf',
      retryable: false,
    })
    render(
      <WorkshopScreen
        items={null}
        loading={false}
        busy={false}
        error={error}
        onRefresh={() => {}}
        onDismissError={() => {}}
        onAction={() => {}}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Steam Workshop metadata was not found')
    expect(screen.queryByText(/No Workshop subscriptions found/)).not.toBeInTheDocument()
  })
})
