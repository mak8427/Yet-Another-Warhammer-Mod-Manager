import type { AppInfo, ModListSnapshot } from '../../lib/ipc'
import type { AppStatus } from '../../store'

interface StatusBarProps {
  status: AppStatus
  appInfo: AppInfo | null
  snapshot: ModListSnapshot | null
  busy: string | null
  dirty: boolean
  lastWriteAt: string | null
}

export function StatusBar({ status, appInfo, snapshot, busy, dirty, lastWriteAt }: StatusBarProps) {
  const readiness =
    status === 'ready'
      ? busy
        ? `${busy}…`
        : snapshot
          ? `Ready · ${snapshot.mods.length} mods · ${snapshot.enabledCount} enabled`
          : 'Ready'
      : status === 'loading'
        ? busy
          ? `${busy}…`
          : 'Starting…'
        : status === 'no-game'
          ? 'No game detected'
          : 'Fault'

  const writeState = dirty
    ? 'Unsaved changes'
    : lastWriteAt
      ? `Load order saved ${lastWriteAt}`
      : 'Load order not written'

  return (
    <footer className="status-bar" aria-live="polite">
      <div className="status-cluster">
        <span>{readiness}</span>
      </div>
      <div className="status-cluster status-cluster-right">
        <span className={dirty ? 'status-dirty' : undefined}>{writeState}</span>
        <span className="status-divider" aria-hidden="true" />
        <span>v{appInfo?.version ?? '0.1.0'}</span>
      </div>
    </footer>
  )
}
