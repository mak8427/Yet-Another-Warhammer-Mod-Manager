import type { ReactNode } from 'react'
import type { View } from '../../store'

const SECTION_FACTION: Record<View, string> = {
  mods: 'brass',
  profiles: 'azure',
  conflicts: 'ember',
  workshop: 'copper',
  settings: 'jade',
}

interface SectionRailProps {
  view: View
  modCount: number
  enabledCount: number
  profileCount: number
  conflictCount: number
  workshopCount: number
  loading?: boolean
  onSelect: (view: View) => void
}

interface RailItem {
  view: View
  label: string
  shortcut: string
  count?: number
  icon: ReactNode
}

function icon(path: string) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

export function SectionRail({
  view,
  modCount,
  enabledCount,
  profileCount,
  conflictCount,
  workshopCount,
  loading = false,
  onSelect,
}: SectionRailProps) {
  const groups: Array<{ label: string; items: RailItem[] }> = [
    {
      label: 'Collection',
      items: [
        {
          view: 'mods',
          label: 'Mods',
          shortcut: 'Ctrl+1',
          count: modCount,
          icon: icon('M2.5 3.5h11v2h-11zM2.5 7.5h11v2h-11zM2.5 11.5h11v2h-11z'),
        },
        {
          view: 'profiles',
          label: 'Profiles',
          shortcut: 'Ctrl+2',
          count: profileCount,
          icon: icon('M2.5 3.5h11v3h-11zM2.5 9.5h11v3h-11z'),
        },
        {
          view: 'conflicts',
          label: 'Conflicts',
          shortcut: 'Ctrl+3',
          count: conflictCount,
          icon: icon('M8 2.5 13.5 13h-11z'),
        },
      ],
    },
    {
      label: 'Game',
      items: [
        {
          view: 'workshop',
          label: 'Workshop',
          shortcut: 'Ctrl+4',
          count: workshopCount,
          icon: icon('M2.5 4.5h11v7h-11zM6 2.5h4v2H6z'),
        },
        {
          view: 'settings',
          label: 'Settings',
          shortcut: 'Ctrl+5',
          icon: icon('M2.5 3.5h11v2h-11zM2.5 7.5h11v2h-11zM2.5 11.5h11v2h-11z'),
        },
      ],
    },
  ]

  return (
    <nav className="section-rail" aria-label="Sections" data-region="rail">
      {groups.map((group) => (
        <div className="rail-section" key={group.label}>
          <span className="rail-group">{group.label}</span>
          {group.items.map((item) => {
            const active = view === item.view
            return (
              <button
                key={item.view}
                type="button"
                className={`rail-item${active ? ' rail-item-active' : ''}`}
                data-faction={SECTION_FACTION[item.view]}
                aria-current={active ? 'page' : undefined}
                aria-keyshortcuts={item.shortcut}
                title={`${item.label} (${item.shortcut})`}
                onClick={() => onSelect(item.view)}
              >
                <span className="rail-icon">{item.icon}</span>
                <span className="rail-label">{item.label}</span>
                {!loading && item.count !== undefined && (
                  <span className="rail-count" aria-hidden="true">
                    {item.view === 'mods' ? `${enabledCount}/${item.count}` : item.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ))}
      <div className="rail-note">
        <span className="rail-group">Load order</span>
        <p>Top loads first. The bottom of the list wins file conflicts.</p>
        <p className="rail-hint">
          <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> moves the selection.
        </p>
      </div>
    </nav>
  )
}
