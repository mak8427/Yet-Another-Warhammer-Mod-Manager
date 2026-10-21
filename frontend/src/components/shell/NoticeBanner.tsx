import type { Notice } from '../../store'

interface NoticeBannerProps {
  notice: Notice
  onDismiss: () => void
}

export function NoticeBanner({ notice, onDismiss }: NoticeBannerProps) {
  return (
    <div className={`banner banner-${notice.kind}`} role="status">
      <div className="banner-body">
        <strong>{notice.message}</strong>
      </div>
      <button type="button" className="btn btn-ghost btn-small" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}
