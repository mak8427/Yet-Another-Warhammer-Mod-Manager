import type { View } from '../../store'

interface SectionRailProps {
  view: View
  modCount: number
  enabledCount: number
  profileCount: number
  conflictCount: number
  workshopCount: number
  onSelect: (view: View) => void
}

export function SectionRail({
  view,
  modCount,
  enabledCount,
  profileCount,
  conflictCount,
  workshopCount,
  onSelect,
}: SectionRailProps) {
  return (
    <nav className="section-rail" aria-label="Sections">
      <span className="rail-group">Muster</span>
      <button
        type="button"
        className={`rail-item ${view === 'mods' ? 'rail-item-active' : ''}`}
        aria-current={view === 'mods' ? 'page' : undefined}
        onClick={() => onSelect('mods')}
      >
        <span>Load order</span>
        <span className="rail-count">
          {enabledCount}/{modCount}
        </span>
      </button>
      <button
        type="button"
        className={`rail-item ${view === 'profiles' ? 'rail-item-active' : ''}`}
        aria-current={view === 'profiles' ? 'page' : undefined}
        onClick={() => onSelect('profiles')}
      >
        <span>Profiles</span>
        <span className="rail-count">{profileCount}</span>
      </button>
      <button
        type="button"
        className={`rail-item ${view === 'conflicts' ? 'rail-item-active' : ''}`}
        aria-current={view === 'conflicts' ? 'page' : undefined}
        onClick={() => onSelect('conflicts')}
      >
        <span>Conflicts</span>
        <span className="rail-count">{conflictCount}</span>
      </button>
      <button
        type="button"
        className={`rail-item ${view === 'workshop' ? 'rail-item-active' : ''}`}
        aria-current={view === 'workshop' ? 'page' : undefined}
        onClick={() => onSelect('workshop')}
      >
        <span>Workshop</span>
        <span className="rail-count">{workshopCount}</span>
      </button>
      <button
        type="button"
        className={`rail-item ${view === 'launch' ? 'rail-item-active' : ''}`}
        aria-current={view === 'launch' ? 'page' : undefined}
        onClick={() => onSelect('launch')}
      >
        <span>Launch</span>
      </button>
      <span className="rail-item rail-item-planned" aria-disabled="true" title="Arrives in M4">
        Settings
      </span>
      <div className="rail-note">
        <span className="rail-group">Reference</span>
        <p>
          Top of the list loads first. The bottom of the list wins file conflicts. Drag enabled
          rows, or use Alt+Arrow to move the selection.
        </p>
      </div>
    </nav>
  )
}
