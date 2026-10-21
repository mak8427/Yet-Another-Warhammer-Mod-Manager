import type { GameLocation, IpcError, LaunchOptions, LaunchResult } from '../../lib/ipc'
import { ErrorBanner } from '../shell/ErrorBanner'

interface LaunchScreenProps {
  game: GameLocation | null
  options: LaunchOptions
  result: LaunchResult | null
  error: IpcError | null
  busy: boolean
  onToggle: (key: keyof LaunchOptions, value: boolean) => void
  onLaunch: () => void
  onDismissError: () => void
}

export function LaunchScreen({
  game,
  options,
  result,
  error,
  busy,
  onToggle,
  onLaunch,
  onDismissError,
}: LaunchScreenProps) {
  return (
    <section className="m3-screen" aria-labelledby="launch-heading">
      <div className="pane-heading pane-heading-tight">
        <div>
          <p className="eyebrow">Steam</p>
          <h2 id="launch-heading">Launch</h2>
        </div>
        <div className="pane-meta">Total War: Warhammer III · app {1142710}</div>
      </div>

      {error && <ErrorBanner error={error} onDismiss={onDismissError} />}

      {result && (
        <div className="banner banner-success" role="status">
          <div className="banner-body">
            <strong>{result.message ?? 'Launch requested through Steam'}</strong>
            <span className="banner-code">{result.method}</span>
          </div>
        </div>
      )}

      <div className="m3-two-column">
        <div className="panel">
          <div className="panel-heading">
            <h3>Start parameters</h3>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={options.skipIntro}
              onChange={(event) => onToggle('skipIntro', event.target.checked)}
              disabled={busy}
            />
            <span>
              <strong>Skip intro movies</strong>
              <small>Writes a managed data pack that replaces the six startup videos.</small>
            </span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={options.scriptLogging}
              onChange={(event) => onToggle('scriptLogging', event.target.checked)}
              disabled={busy}
            />
            <span>
              <strong>Enable script logging</strong>
              <small>Writes data/script/enable_console_logging before launch.</small>
            </span>
          </label>
          <p className="muted">
            Options are saved per profile. The manager refuses to launch while Warhammer3.exe is
            already running.
          </p>
        </div>

        <div className="panel panel-hero">
          <div>
            <p className="eyebrow">Through Steam</p>
            <h3>Warhammer III</h3>
            <p className="muted mono">{game?.gamePath ?? 'Game path not detected'}</p>
          </div>
          <button type="button" className="btn btn-primary btn-large" onClick={onLaunch} disabled={busy}>
            {busy ? 'Launching…' : 'Launch game'}
          </button>
        </div>
      </div>
    </section>
  )
}
