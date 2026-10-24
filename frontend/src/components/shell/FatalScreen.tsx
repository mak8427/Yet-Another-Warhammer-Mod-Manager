import type { IpcError } from '../../lib/ipc'

interface FatalScreenProps {
  error: IpcError
  onRetry: () => void
}

export function FatalScreen({ error, onRetry }: FatalScreenProps) {
  return (
    <main className="main-pane fatal-screen" aria-labelledby="fatal-title">
      <div className="fatal-column">
        <h2 id="fatal-title" tabIndex={-1}>
          The mod list could not be read
        </h2>
        <p>
          {error.code === 'config_corrupt'
            ? 'The manager will not overwrite a corrupt config. A readable backup is restored automatically; retry after closing other game tools.'
            : 'Retry after closing other game tools. If the problem persists, the error code and details identify the failing step.'}
        </p>
        <div className="fatal-error" role="alert">
          <span className="state-icon state-icon-danger" aria-hidden="true">
            !
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
        <div className="fatal-actions">
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    </main>
  )
}
