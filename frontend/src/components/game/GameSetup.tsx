import { useState } from 'react'
import type { IpcError } from '../../lib/ipc'

interface GameSetupProps {
  error: IpcError | null
  busy: string | null
  onSubmit: (path: string) => void
  onDetect: () => void
}

export function GameSetup({ error, busy, onSubmit, onDetect }: GameSetupProps) {
  const [path, setPath] = useState('')

  return (
    <main className="main-pane setup-pane">
      <div className="pane-heading">
        <div>
          <p className="eyebrow">First muster</p>
          <h2>No Total War: Warhammer III installation found</h2>
        </div>
      </div>

      <section className="panel setup-panel" aria-labelledby="setup-title">
        <h3 id="setup-title">Point the manager at your game folder</h3>
        <p className="muted">
          The manager checked the usual Steam, Flatpak, and Snap locations. If the game lives
          somewhere else, choose its folder — the one that contains <code>data</code> and
          <code>Warhammer3.exe</code>.
        </p>
        <form
          className="setup-form"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = path.trim()
            if (trimmed) onSubmit(trimmed)
          }}
        >
          <label htmlFor="game-path">Game folder</label>
          <div className="input-row">
            <input
              id="game-path"
              autoFocus
              spellCheck={false}
              placeholder="D:\SteamLibrary\steamapps\common\Total War WARHAMMER III"
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={!path.trim() || Boolean(busy)}>
              Use this folder
            </button>
            <button type="button" className="btn" onClick={onDetect} disabled={Boolean(busy)}>
              Detect again
            </button>
          </div>
        </form>

        {busy && <p className="muted">{busy}…</p>}

        {error && (
          <div className="setup-diagnostic" role="alert">
            <strong>{error.message}</strong>
            {error.details && <code>{error.details}</code>}
          </div>
        )}
      </section>

      <section className="panel setup-panel" aria-labelledby="setup-help">
        <h3 id="setup-help">What the manager needs</h3>
        <ul className="plain-list">
          <li>The WH3 game folder, its <code>data</code> directory, and the Steam Workshop content folder.</li>
          <li>A readable <code>used_mods.txt</code>. Writes are atomic and keep one backup.</li>
          <li>No game? The manager still starts, and nothing on disk is modified.</li>
        </ul>
      </section>
    </main>
  )
}
