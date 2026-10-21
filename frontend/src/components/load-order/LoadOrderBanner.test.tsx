import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LoadOrderBanner } from './LoadOrderBanner'
import { EMPTY_LOAD_ORDER } from '../../test/mocks'

function renderBanner(overrides: Partial<Parameters<typeof LoadOrderBanner>[0]>, busy = false) {
  const props: Parameters<typeof LoadOrderBanner>[0] = {
    loadOrder: { ...EMPTY_LOAD_ORDER, ...overrides.loadOrder },
    busy,
    onRestore: overrides.onRestore ?? vi.fn(),
    onOpenWrite: overrides.onOpenWrite ?? vi.fn(),
  }
  render(<LoadOrderBanner {...props} />)
  return props
}

describe('LoadOrderBanner', () => {
  it('reports an unreadable used_mods.txt without offering a silent repair', () => {
    const props = renderBanner({
      loadOrder: {
        ...EMPTY_LOAD_ORDER,
        unreadable: 'Could not read used_mods.txt: access denied',
        backupAvailable: false,
      },
    })

    expect(screen.getByRole('alert')).toHaveTextContent('used_mods.txt cannot be read')
    expect(screen.getByRole('alert')).toHaveTextContent('access denied')
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Review write' })).toBeEnabled()
    expect(props.onRestore).not.toHaveBeenCalled()
  })

  it('enables explicit backup restore only when a backup exists', () => {
    const props = renderBanner({
      loadOrder: { ...EMPTY_LOAD_ORDER, corrupt: true, backupAvailable: true, message: 'mod "broken;' },
    })

    expect(screen.getByRole('alert')).toHaveTextContent('used_mods.txt needs recovery')
    fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }))
    expect(props.onRestore).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Review write' }))
    expect(props.onOpenWrite).toHaveBeenCalledTimes(1)
  })

  it('warns about unresolved names, duplicates, and unmanaged directives', () => {
    renderBanner({
      loadOrder: {
        ...EMPTY_LOAD_ORDER,
        missingNames: ['gone.pack', 'also_gone.pack'],
        duplicates: ['dupe.pack'],
        unmanagedDirectives: ['add_working_directory "C:/x";'],
      },
    })

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('2 saved mods no longer resolve')
    expect(status).toHaveTextContent('1 duplicate name')
    expect(status).toHaveTextContent('1 unmanaged directive')
  })

  it('renders nothing when the load order is healthy', () => {
    const { container } = render(
      <LoadOrderBanner
        loadOrder={{ ...EMPTY_LOAD_ORDER }}
        busy={false}
        onRestore={vi.fn()}
        onOpenWrite={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('disables both recovery actions while a write is in flight', () => {
    renderBanner(
      {
        loadOrder: {
          ...EMPTY_LOAD_ORDER,
          corrupt: true,
          backupAvailable: true,
          message: 'broken',
        },
      },
      true,
    )
    expect(screen.getByRole('button', { name: 'Restore backup' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Review write' })).toBeDisabled()
  })
})
