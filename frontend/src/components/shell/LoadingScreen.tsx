import type { View } from '../../store'
import { SectionRail } from './SectionRail'

interface LoadingScreenProps {
  view: View
  busy: string | null
  onSelect: (view: View) => void
}

export function LoadingScreen({ view, busy, onSelect }: LoadingScreenProps) {
  return (
    <div className="workspace">
      <SectionRail
        view={view}
        modCount={0}
        enabledCount={0}
        profileCount={0}
        conflictCount={0}
        workshopCount={0}
        loading
        onSelect={onSelect}
      />
      <main className="main-pane" aria-busy="true" data-region="main">
        <div className="screen-bar">
          <div className="screen-title">
            <h2 className="skeleton-title">Mods</h2>
          </div>
        </div>
        <div className="mod-list-header" aria-hidden="true" />
        <div className="loading-list" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="loading-row" />
          ))}
        </div>
        <p className="sr-only">{busy ?? 'Starting'}…</p>
      </main>
    </div>
  )
}
