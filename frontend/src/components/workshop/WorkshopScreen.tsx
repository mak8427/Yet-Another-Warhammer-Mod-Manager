import { useEffect, useRef, useState } from 'react'
import type { IpcError, WorkshopAction, WorkshopItem, WorkshopState } from '../../lib/ipc'
import { virtualRange } from '../../lib/virtual'
import { formatDate } from '../../lib/format'
import { EmptyState } from '../common/EmptyState'
import { ErrorBanner } from '../shell/ErrorBanner'

interface WorkshopScreenProps {
  items: WorkshopItem[] | null
  loading: boolean
  busy: boolean
  error: IpcError | null
  onRefresh: () => void
  onDismissError: () => void
  onAction: (action: WorkshopAction, workshopId: string) => void
  viewportHeightOverride?: number
}

const STATE_LABEL: Record<WorkshopState, string> = {
  subscribed: 'Subscribed',
  installed: 'Installed',
  update_pending: 'Update pending',
  unknown: 'Unknown',
}

const STATE_ICON: Record<WorkshopState, string> = {
  subscribed: '◇',
  installed: '✓',
  update_pending: '▲',
  unknown: '?',
}

const ROW_HEIGHT = 40
const OVERSCAN = 6

export function WorkshopScreen({
  items,
  loading,
  busy,
  error,
  onRefresh,
  onDismissError,
  onAction,
  viewportHeightOverride,
}: WorkshopScreenProps) {
  const rows = items ?? []
  const pending = rows.filter((item) => item.state === 'update_pending').length
  const unavailable = Boolean(error) && !loading && rows.length === 0
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [measuredHeight, setMeasuredHeight] = useState(520)
  const viewportHeight = viewportHeightOverride ?? measuredHeight
  const maxScrollTop = Math.max(0, rows.length * ROW_HEIGHT - viewportHeight)
  const effectiveScrollTop = Math.min(scrollTop, maxScrollTop)
  const range = virtualRange(
    rows.length,
    ROW_HEIGHT,
    viewportHeight,
    effectiveScrollTop,
    OVERSCAN,
  )
  const visible = rows.slice(range.start, range.end)

  useEffect(() => {
    if (viewportHeightOverride !== undefined) return
    const element = containerRef.current
    if (!element) return
    const measure = () => setMeasuredHeight(element.clientHeight || 520)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [viewportHeightOverride])

  return (
    <section className="workshop-screen" aria-labelledby="workshop-heading">
      <div className="screen-bar">
        <div className="screen-title">
          <h2 id="workshop-heading" tabIndex={-1}>
            Workshop
          </h2>
          <span className="screen-count mono">
            {rows.length} subscribed · {pending} update pending
          </span>
        </div>
        <div className="screen-actions">
          <span className="screen-note">State comes from Steam metadata only.</span>
          <button type="button" className="btn btn-small" onClick={onRefresh} disabled={loading || busy}>
            {loading ? 'Reading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <ErrorBanner error={error} onDismiss={onDismissError} onRetry={onRefresh} />}

      {rows.length === 0 ? (
        unavailable ? null : (
          <EmptyState
            title={loading ? 'Reading Steam subscriptions' : 'No Workshop subscriptions found'}
            action={
              <button type="button" className="btn" onClick={onRefresh} disabled={loading}>
                Retry
              </button>
            }
          >
            Subscribe to items in Steam, then refresh. The manager never asks for Steam credentials.
          </EmptyState>
        )
      ) : (
        <div
          className="table-wrap"
          ref={containerRef}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <table className="data-table workshop-table">
            <colgroup>
              <col />
              <col className="col-id" />
              <col className="col-state" />
              <col className="col-updated" />
              <col className="col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Workshop ID</th>
                <th scope="col">State</th>
                <th scope="col">Updated</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {range.topPadding > 0 && (
                <tr className="virtual-spacer" aria-hidden="true" style={{ height: range.topPadding }}>
                  <td colSpan={5} />
                </tr>
              )}
              {visible.map((item) => (
                <tr key={item.workshopId} data-workshop-row>
                  <td>
                    <span className="truncate workshop-title" title={item.title}>
                      {item.title}
                    </span>
                  </td>
                  <td className="mono">{item.workshopId}</td>
                  <td>
                    <span className={`state-chip state-workshop-${item.state}`}>
                      <span aria-hidden="true">{STATE_ICON[item.state]}</span>
                      {STATE_LABEL[item.state]}
                    </span>
                  </td>
                  <td className="mono">{formatDate(item.updatedAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={busy}
                        onClick={() => onAction('open', item.workshopId)}
                      >
                        Open page
                      </button>
                      {item.state === 'unknown' ? (
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={busy}
                          onClick={() => onAction('subscribe', item.workshopId)}
                        >
                          Subscribe
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={busy}
                          onClick={() => onAction('unsubscribe', item.workshopId)}
                        >
                          Unsubscribe
                        </button>
                      )}
                      {(item.state === 'installed' || item.state === 'update_pending') && (
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={busy}
                          onClick={() => onAction('update', item.workshopId)}
                        >
                          Update
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {range.bottomPadding > 0 && (
                <tr className="virtual-spacer" aria-hidden="true" style={{ height: range.bottomPadding }}>
                  <td colSpan={5} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
