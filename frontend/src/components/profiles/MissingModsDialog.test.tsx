import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MISSING_OUTCOME } from '../../test/mocks'
import { MissingModsDialog } from './MissingModsDialog'

function missingOutcome() {
  if (MISSING_OUTCOME.status !== 'missingMods') {
    throw new Error('the fixture must be a missingMods outcome')
  }
  return MISSING_OUTCOME
}

function opened() {
  return vi.fn(async () => ({ ok: true, message: 'Steam opened the Workshop page.' }))
}

describe('MissingModsDialog', () => {
  it('explains that no profile was created and lists every missing pack', () => {
    render(<MissingModsDialog outcome={missingOutcome()} onClose={vi.fn()} onOpenWorkshop={opened()} />)

    const dialog = screen.getByRole('dialog', { name: 'Mods required for "Campaign"' })
    expect(within(dialog).getByText(/No profile was created/)).toBeInTheDocument()
    expect(within(dialog).getByText(/2 mods and 2 are not installed/)).toBeInTheDocument()
    expect(within(dialog).getByText('Missing Mod')).toBeInTheDocument()
    expect(within(dialog).getByText('missing.pack')).toBeInTheDocument()
    expect(within(dialog).getByText('local_missing.pack')).toBeInTheDocument()
    expect(
      within(dialog).getByText('https://steamcommunity.com/sharedfiles/filedetails/?id=2921395471'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText(/No download link was included/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('link')).toBeNull()
  })

  it('opens the Workshop page for an entry that carries an id', async () => {
    const onOpenWorkshop = opened()
    render(
      <MissingModsDialog
        outcome={missingOutcome()}
        onClose={vi.fn()}
        onOpenWorkshop={onOpenWorkshop}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Workshop page' }))

    await waitFor(() => expect(onOpenWorkshop).toHaveBeenCalledWith('2921395471'))
  })

  it('shows a Steam failure inline and keeps the dialog open', async () => {
    const onOpenWorkshop = vi.fn(async () => ({ ok: false, message: 'Steam was not found' }))
    render(
      <MissingModsDialog
        outcome={missingOutcome()}
        onClose={vi.fn()}
        onOpenWorkshop={onOpenWorkshop}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Workshop page' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Steam was not found')
    expect(screen.getByRole('button', { name: 'Open Workshop page' })).toBeEnabled()
  })

  it('closes from the footer button', () => {
    const onClose = vi.fn()
    render(
      <MissingModsDialog
        outcome={missingOutcome()}
        onClose={onClose}
        onOpenWorkshop={opened()}
      />,
    )

    fireEvent.click(screen.getByText('Close'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
