import type { AppInfo, GameLocation, ProfilesState } from '../../lib/ipc'
import type { AppStatus } from '../../store'

interface TitleBarProps {
  appInfo: AppInfo | null
  game: GameLocation | null
  status: AppStatus
  profiles: ProfilesState | null
  busy: boolean
  onApplyProfile: (profileId: string) => void
  onOpenSettings: () => void
  onOpenLaunch: () => void
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

export function TitleBar({
  appInfo,
  game,
  status,
  profiles,
  busy,
  onApplyProfile,
  onOpenSettings,
  onOpenLaunch,
}: TitleBarProps) {
  const activeProfileId = profiles?.activeProfileId ?? ''
  const activeProfile = profiles?.profiles.find((profile) => profile.id === activeProfileId)

  return (
    <header className="title-bar" data-region="titlebar">
      <div className="brand">
        <span className="brand-sigil" aria-hidden="true">
          III
        </span>
        <div className="brand-text">
          <span className="brand-kicker">Total War: Warhammer III</span>
          <h1>
            Yet Another Warhammer <span>Mod Manager</span>
          </h1>
        </div>
      </div>

      <div className="title-bar-centre">
        <label className="title-profile">
          <span className="label">Profile</span>
          <select
            aria-label="Active profile"
            value={activeProfileId}
            disabled={!profiles || busy}
            onChange={(event) => onApplyProfile(event.target.value)}
          >
            {profiles?.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
            {!activeProfile && <option value="">Default</option>}
          </select>
        </label>
      </div>

      <div className="title-bar-meta">
        <span className={`game-status ${game ? 'is-found' : 'is-missing'}`} title={game?.gamePath}>
          <span aria-hidden="true">{game ? '◆' : '◇'}</span>
          {game ? 'Game found' : 'Set game path'}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onOpenLaunch}
          disabled={!game}
          title={game ? 'Launch Warhammer III' : 'Set the game path before launching'}
          aria-label="Launch game"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M4 2.5 13 8l-9 5.5z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onOpenSettings}
          title="Settings (Ctrl+5)"
          aria-label="Settings"
          aria-keyshortcuts="Control+5"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm5.8 3.2.9.7-1.2 2-1.1-.4a5 5 0 0 1-1.2.7l-.2 1.2H8.2L8 11.7a5 5 0 0 1-1.2-.7l-1.1.4-1.2-2 .9-.7a5 5 0 0 1 0-1.4l-.9-.7 1.2-2 1.1.4A5 5 0 0 1 8 4.3l.2-1.2H10l.2 1.2a5 5 0 0 1 1.2.7l1.1-.4 1.2 2-.9.7a5 5 0 0 1 0 1.4Z"
              fill="currentColor"
            />
          </svg>
        </button>
        <span className={`status-indicator status-${status}`}>
          <span aria-hidden="true">{statusLabel(status)}</span>
          <span className="sr-only">{statusLabel(status)}</span>
        </span>
        <span className="version-text" title={appInfo ? `core ${appInfo.coreVersion}` : undefined}>
          v{appInfo?.version ?? '0.1.0'}
        </span>
      </div>
    </header>
  )
}
