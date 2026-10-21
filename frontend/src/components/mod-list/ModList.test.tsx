import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModList } from './ModList'
import { makeMod } from '../../test/mocks'

const MODS = Array.from({ length: 500 }, (_, index) => {
  const enabled = index < 20
  return makeMod({
    id: `mod-${index}`,
    name: `mod_${String(index).padStart(3, '0')}.pack`,
    isEnabled: enabled,
    loadOrder: enabled ? index : index,
  })
})

function renderList(overrides: Partial<Parameters<typeof ModList>[0]> = {}) {
  const props: Parameters<typeof ModList>[0] = {
    mods: MODS,
    tags: [],
    selection: [],
    sort: 'load-order',
    density: 'compact',
    showAuthors: true,
    showThumbnails: true,
    initialScrollTop: 0,
    conflictSummaries: new Map(),
    missingByMod: new Map(),
    emptyTitle: 'No mods match this filter',
    emptyMessage: 'Change the search or filters.',
    viewportHeightOverride: 320,
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    onSelectAll: vi.fn(),
    onInspect: vi.fn(),
    onSort: vi.fn(),
    onClearSelection: vi.fn(),
    onMove: vi.fn(),
    onReorder: vi.fn(),
    onScrollTop: vi.fn(),
    ...overrides,
  }
  render(<ModList {...props} />)
  return props
}

describe('ModList', () => {
  it('mounts only the virtualized window, not all 500 rows', () => {
    renderList()
    const rows = screen.getAllByRole('option')
    expect(rows.length).toBeGreaterThan(5)
    expect(rows.length).toBeLessThan(60)
    expect(screen.getByRole('option', { name: /mod_000/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /mod_400/ })).not.toBeInTheDocument()
  })

  it('mounts the scrolled-to rows and keeps the virtualization contract', async () => {
    const props = renderList()
    const listbox = screen.getByRole('listbox', { name: 'Mods' })
    fireEvent.scroll(listbox, { target: { scrollTop: 30 * 100 } })
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /mod_100/ })).toBeInTheDocument()
    })
    expect(screen.getAllByRole('option').length).toBeLessThan(60)
    expect(props.onScrollTop).toHaveBeenCalled()
  })

  it('toggles a row through its checkbox without changing selection', () => {
    const props = renderList()
    fireEvent.click(screen.getByLabelText('Disable mod_000'))
    expect(props.onToggle).toHaveBeenCalledWith('mod-0')
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('selects with ctrl-click and moves with Alt+Arrow', () => {
    const props = renderList()
    const row = screen.getByRole('option', { name: /mod_000/ })
    fireEvent.click(row, { ctrlKey: true })
    expect(props.onSelect).toHaveBeenCalledWith('mod-0', 'toggle')

    const listbox = screen.getByRole('listbox', { name: 'Mods' })
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    fireEvent.keyDown(listbox, { key: 'ArrowDown', altKey: true })
    expect(props.onMove).toHaveBeenCalledWith('down')
  })

  it('selects all with Ctrl+A and clears with Escape', () => {
    const props = renderList()
    const listbox = screen.getByRole('listbox', { name: 'Mods' })
    fireEvent.keyDown(listbox, { key: 'a', ctrlKey: true })
    expect(props.onSelectAll).toHaveBeenCalled()
    fireEvent.keyDown(listbox, { key: 'Escape' })
    expect(props.onClearSelection).toHaveBeenCalled()
  })

  it('renders an empty state when the filter has no matches', () => {
    renderList({ mods: [] })
    expect(screen.getByText('No mods match this filter')).toBeInTheDocument()
  })
})
