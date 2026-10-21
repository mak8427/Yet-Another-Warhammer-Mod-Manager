import { useEffect } from 'react'
import type { Notice } from '../../store'

interface NoticeBannerProps {
  notice: Notice
  onDismiss: () => void
}

export function NoticeBanner({ notice, onDismiss }: NoticeBannerProps) {
  useEffect(() => {
    if (notice.kind === 'error') return
    const timer = setTimeout(onDismiss, 4000)
    return () => clearTimeout(timer)
  }, [notice, onDismiss])

  return (
    <div className={`toast toast-${notice.kind}`} role="status">
      <span className="state-icon" aria-hidden="true">
        {notice.kind === 'success' ? '✓' : notice.kind === 'warning' ? '▲' : 'i'}
      </span>
      <span>{notice.message}</span>
      <button type="button" className="btn btn-ghost btn-icon btn-small" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}
