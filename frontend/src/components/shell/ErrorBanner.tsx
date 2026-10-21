import type { IpcError } from '../../lib/ipc'

interface ErrorBannerProps {
  error: IpcError
  onDismiss: () => void
  onRetry?: () => void
}

export function ErrorBanner({ error, onDismiss, onRetry }: ErrorBannerProps) {
  return (
    <div className="banner banner-error" role="alert">
      <span className="state-icon state-icon-danger" aria-hidden="true">
        !
      </span>
      <div className="banner-body">
        <strong>{error.message}</strong>
        <span className="banner-code">{error.code}</span>
        {error.details && (
          <details className="banner-disclosure">
            <summary>Details</summary>
            <code>{error.details}</code>
          </details>
        )}
      </div>
      <div className="banner-actions">
        {error.retryable && onRetry && (
          <button type="button" className="btn btn-small" onClick={onRetry}>
            Retry
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-small" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  )
}
