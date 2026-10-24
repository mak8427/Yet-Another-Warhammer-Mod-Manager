import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PROFILE_CAMPAIGN, PROFILES } from '../../test/mocks'
import { ProfilesScreen } from './ProfilesScreen'

type Props = ComponentProps<typeof ProfilesScreen>

function renderScreen(overrides: Partial<Props> = {}): Props {
  const props: Props = {
    profiles: PROFILES,
    busy: false,
    onApply: vi.fn(),
    onCreate: vi.fn(async () => true),
    onRename: vi.fn(async () => true),
    onDuplicate: vi.fn(async () => true),
    onDelete: vi.fn(async () => true),
    onImport: vi.fn(),
    onExport: vi.fn(),
    ...overrides,
  }
  render(<ProfilesScreen {...props} />)
  return props
}

describe('ProfilesScreen share actions', () => {
  it('renders Import Profile and Export Profile in the profile toolbar', () => {
    renderScreen()

    expect(screen.getByRole('button', { name: 'Import Profile' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Export Profile' })).toBeEnabled()
  })

  it('starts the import flow', () => {
    const props = renderScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Import Profile' }))

    expect(props.onImport).toHaveBeenCalledTimes(1)
  })

  it('exports exactly the selected profile', () => {
    const props = renderScreen()
    const row = screen.getByText(PROFILE_CAMPAIGN.name).closest('tr')

    fireEvent.click(row as HTMLTableRowElement)
    fireEvent.click(screen.getByRole('button', { name: 'Export Profile' }))

    expect(props.onExport).toHaveBeenCalledWith(PROFILE_CAMPAIGN.id)
  })

  it('disables both share actions while the manager is busy', () => {
    renderScreen({ busy: true })

    expect(screen.getByRole('button', { name: 'Import Profile' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Export Profile' })).toBeDisabled()
  })

  it('selects the profile created by an import', () => {
    const props = renderScreen({ highlightProfileId: PROFILE_CAMPAIGN.id })
    const row = screen.getByText(PROFILE_CAMPAIGN.name).closest('tr')

    expect(row).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Export Profile' }))

    expect(props.onExport).toHaveBeenCalledWith(PROFILE_CAMPAIGN.id)
  })
})
