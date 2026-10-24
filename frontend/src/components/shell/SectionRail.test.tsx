import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SectionRail } from './SectionRail'

function renderRail(view: 'mods' | 'profiles' = 'mods') {
  render(
    <SectionRail
      view={view}
      modCount={63}
      enabledCount={26}
      profileCount={4}
      conflictCount={3}
      workshopCount={8}
      onSelect={vi.fn()}
    />,
  )
}

describe('SectionRail faction framing (WAR-147)', () => {
  it('assigns a stable faction accent to every section and marks only the active one', () => {
    renderRail()

    const rail = screen.getByRole('navigation', { name: 'Sections' })
    const accents: Record<string, string> = {
      Mods: 'brass',
      Profiles: 'azure',
      Conflicts: 'ember',
      Workshop: 'copper',
      Settings: 'jade',
    }

    for (const [label, faction] of Object.entries(accents)) {
      expect(within(rail).getByRole('button', { name: label })).toHaveAttribute(
        'data-faction',
        faction,
      )
    }

    expect(within(rail).getByRole('button', { name: 'Mods' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(rail).getByRole('button', { name: 'Profiles' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('keeps the faction accent on the active section when the view changes', () => {
    renderRail('profiles')

    const rail = screen.getByRole('navigation', { name: 'Sections' })
    expect(within(rail).getByRole('button', { name: 'Profiles' })).toHaveAttribute(
      'data-faction',
      'azure',
    )
    expect(within(rail).getByRole('button', { name: 'Profiles' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
