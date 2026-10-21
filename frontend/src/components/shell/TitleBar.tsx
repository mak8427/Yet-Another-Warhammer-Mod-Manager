import { baseName } from '../../lib/format'
import type { AppInfo, GameLocation } from '../../lib/ipc'
import type { AppStatus } from '../../store'

interface TitleBarProps {
  appInfo: AppInfo | null
  game: GameLocation | null
  status: AppStatus
}

function statusLabel(status: AppStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'no-game':
      return 'No game'
    case 'error':
      return 'Fault'
    default:
      return 'Loading'
  }
}

export function TitleBar({ appInfo, game, status }: TitleBarProps) {
  return (
    <header className="title-bar">
      <div className="brand">
        <span className="brand-sigil" aria-hidden="true">
          III
        </span>
        <div className="brand-text">
          <span className="brand-kicker">Warhammer Labs</span>
          <h1>
            Total War: Warhammer III <span>Mod Manager</span>
          </h1>
        </div>
      </div>
      <div className="title-bar-meta">
        {game && <span className="game-chip" title={game.gamePath}>{baseName(game.gamePath)}</span>}
        <span className={`status-dot status-dot-${status}`} aria-hidden="true" />
        <span className="status-text">{statusLabel(status)}</span>
        <span className="version-text">
          {appInfo ? `${appInfo.version} · core ${appInfo.coreVersion}` : 'core offline'}
        </span>
      </div>
    </header>
  )
}
