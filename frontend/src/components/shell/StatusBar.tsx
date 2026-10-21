import { formatMs } from '../../lib/format'
import type { AppInfo, GameLocation, ModListSnapshot } from '../../lib/ipc'

interface StatusBarProps {
  appInfo: AppInfo | null
  game: GameLocation | null
  snapshot: ModListSnapshot | null
  profileName: string
}

export function StatusBar({ appInfo, game, snapshot, profileName }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <div className="status-cluster">
        <span>WH3 Mod Manager</span>
        <span className="status-divider" aria-hidden="true" />
        <span>{profileName}</span>
        {snapshot && (
          <>
            <span className="status-divider" aria-hidden="true" />
            <span>
              {snapshot.enabledCount} of {snapshot.mods.length} enabled
            </span>
          </>
        )}
      </div>
      <div className="status-cluster status-cluster-right">
        {snapshot && (
          <span className="timing" title="Measured by the Rust core">
            startup {formatMs(snapshot.timings.startupMs)} · scan {formatMs(snapshot.timings.scanMs)}
          </span>
        )}
        {game && <span title={game.dataPath}>data · {game.dataPath}</span>}
        <span>v{appInfo?.version ?? '0.1.0'}</span>
      </div>
    </footer>
  )
}
