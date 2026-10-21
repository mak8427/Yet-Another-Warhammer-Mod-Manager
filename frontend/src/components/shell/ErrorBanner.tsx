import type { IpcError } from '../../lib/ipc'

interface ErrorBannerProps {
  error: IpcError
  onDismiss: () => void
}

export function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  return (
    <div className="banner banner-error" role="alert">
      <div className="banner-body">
        <strong>{error.message}</strong>
        <span className="banner-code">{error.code}</span>
        {error.details && <code className="banner-details">{error.details}</code>}
      </div>
      <button type="button" className="btn btn-ghost btn-small" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}
