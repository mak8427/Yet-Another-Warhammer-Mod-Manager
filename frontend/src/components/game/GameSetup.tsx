import { useRef, useState } from 'react'
import type { IpcError } from '../../lib/ipc'

interface GameSetupProps {
  error: IpcError | null
  busy: string | null
  onSubmit: (path: string) => void
  onDetect: () => void
}

function stateTitle(error: IpcError | null): string {
  if (error?.code === 'steam_not_found') return 'Steam was not found'
  if (error?.code === 'config_corrupt') return 'The configuration could not be read'
  return 'Warhammer III was not found'
}

function stateMessage(error: IpcError | null): string {
  if (error?.code === 'steam_not_found') {
    return 'The game may be installed, but Steam library metadata is unreadable. Choose the game folder directly or retry detection.'
  }
  if (error?.code === 'config_corrupt') {
    return 'A readable config.json.bak is restored automatically. If both files are unreadable, choose the game folder again; nothing on disk is overwritten.'
  }
  return 'The manager checked the usual Steam, Flatpak, and Snap locations. Choose the folder that contains data and Warhammer3.exe, or retry detection.'
}

export function GameSetup({ error, busy, onSubmit, onDetect }: GameSetupProps) {
  const [path, setPath] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <main className="main-pane setup-pane" aria-labelledby="setup-title">
      <div className="setup-column">
        <h2 id="setup-title" tabIndex={-1}>
          {stateTitle(error)}
        </h2>
        <p className="setup-lead">{stateMessage(error)}</p>

        {error && (
          <div className="setup-error" role="alert">
            <span className="state-icon state-icon-warning" aria-hidden="true">
              ▲
            </span>
            <div>
              <strong>{error.message}</strong>
              <span className="banner-code">{error.code}</span>
              {error.details && (
                <details className="banner-disclosure">
                  <summary>Details</summary>
                  <code>{error.details}</code>
                </details>
              )}
            </div>
          </div>
        )}

        <form
          className="setup-form"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = path.trim()
            if (trimmed) onSubmit(trimmed)
          }}
        >
          <label htmlFor="game-path">Game folder</label>
          <input
            id="game-path"
            ref={inputRef}
            autoFocus
            spellCheck={false}
            placeholder="D:\SteamLibrary\steamapps\common\Total War WARHAMMER III"
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
          <div className="setup-actions">
            <button type="submit" className="btn btn-primary" disabled={!path.trim() || Boolean(busy)}>
              Use this path
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => inputRef.current?.focus()}
              disabled={Boolean(busy)}
            >
              Choose another folder
            </button>
            <button type="button" className="btn btn-ghost" onClick={onDetect} disabled={Boolean(busy)}>
              {busy ? `${busy}…` : 'Retry detection'}
            </button>
          </div>
        </form>

        <dl className="setup-facts">
          <div>
            <dt>What it needs</dt>
            <dd>The game folder, its data directory, and the Steam Workshop content folder.</dd>
          </div>
          <div>
            <dt>What it writes</dt>
            <dd>used_mods.txt only after a preview. Writes are atomic and keep one backup.</dd>
          </div>
          <div>
            <dt>No game</dt>
            <dd>The manager still starts and does not modify anything on disk.</dd>
          </div>
        </dl>
      </div>
    </main>
  )
}
