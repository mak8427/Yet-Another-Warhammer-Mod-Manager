import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IpcError } from '../../lib/ipc'
import { CONFLICT_REPORT } from '../../test/mocks'
import { ConflictScreen } from './ConflictScreen'

describe('ConflictScreen', () => {
  it('renders the winner, loser, dependency, and per-mod summary', () => {
    render(
      <ConflictScreen
        report={CONFLICT_REPORT}
        loading={false}
        error={null}
        onRefresh={() => {}}
        onDismissError={() => {}}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Conflicts' })).toBeInTheDocument()
    const fileTable = screen.getAllByRole('table')[0]
    expect(within(fileTable).getByText('db/units_tables/units')).toBeInTheDocument()
    expect(within(fileTable).getByText('beta.pack')).toBeInTheDocument()
    expect(screen.getByText(/missing\.pack/)).toBeInTheDocument()
    expect(screen.getAllByText('beta.pack').length).toBeGreaterThan(0)
    expect(screen.getByText(/1 shared paths/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand losers' }))
    expect(within(fileTable).getByText('Loses: alpha.pack')).toBeInTheDocument()
  })

  it('shows a structured error and refreshes on demand', () => {
    const onRefresh = vi.fn()
    const error = new IpcError({
      code: 'pack_parse_failed',
      message: 'A pack index could not be read',
      details: 'bad.pack',
      retryable: false,
    })
    render(
      <ConflictScreen
        report={null}
        loading={false}
        error={error}
        onRefresh={onRefresh}
        onDismissError={() => {}}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('A pack index could not be read')
    fireEvent.click(screen.getAllByRole('button', { name: 'Rescan' })[0])
    expect(onRefresh).toHaveBeenCalled()
  })
})
