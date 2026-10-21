import type { IpcError, WorkshopAction, WorkshopItem, WorkshopState } from '../../lib/ipc'
import { formatDate } from '../../lib/format'
import { ErrorBanner } from '../shell/ErrorBanner'

interface WorkshopScreenProps {
  items: WorkshopItem[] | null
  loading: boolean
  busy: boolean
  error: IpcError | null
  onRefresh: () => void
  onDismissError: () => void
  onAction: (action: WorkshopAction, workshopId: string) => void
}

const STATE_LABEL: Record<WorkshopState, string> = {
  subscribed: 'Subscribed',
  installed: 'Installed',
  update_pending: 'Update pending',
  unknown: 'Unknown',
}

export function WorkshopScreen({
  items,
  loading,
  busy,
  error,
  onRefresh,
  onDismissError,
  onAction,
}: WorkshopScreenProps) {
  const rows = items ?? []
  const pending = rows.filter((item) => item.state === 'update_pending').length

  return (
    <section className="m3-screen" aria-labelledby="workshop-heading">
      <div className="pane-heading pane-heading-tight">
        <div>
          <p className="eyebrow">Steam</p>
          <h2 id="workshop-heading">Workshop</h2>
        </div>
        <div className="pane-meta">
          State is read from Steam metadata only
          <button type="button" className="btn btn-small" onClick={onRefresh} disabled={loading || busy}>
            {loading ? 'Reading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <ErrorBanner error={error} onDismiss={onDismissError} />}

      <div className="m3-stat-strip" aria-label="Workshop summary">
        <Stat label="Subscribed items" value={rows.length} />
        <Stat label="Updates pending" value={pending} tone={pending > 0 ? 'warn' : undefined} />
        <Stat label="Installed" value={rows.filter((item) => item.state === 'installed').length} />
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h3>Steam subscriptions</h3>
          <span className="muted">
            Subscribe, unsubscribe, and update open the item in Steam; refresh to confirm the change.
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="muted">
            {loading
              ? 'Reading appworkshop_3247630.acf…'
              : 'No Workshop subscriptions were found in Steam metadata.'}
          </p>
        ) : (
          <div className="m3-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">State</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.workshopId}>
                    <td>
                      <span className="workshop-title">{item.title}</span>
                      <span className="mono muted">{item.workshopId}</span>
                    </td>
                    <td>
                      <StateBadge state={item.state} />
                    </td>
                    <td>{formatDate(item.updatedAt)}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={busy}
                          onClick={() => onAction('open', item.workshopId)}
                        >
                          Open
                        </button>
                        {item.state === 'unknown' && (
                          <button
                            type="button"
                            className="btn btn-small"
                            disabled={busy}
                            onClick={() => onAction('subscribe', item.workshopId)}
                          >
                            Subscribe
                          </button>
                        )}
                        {item.state !== 'unknown' && (
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
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function StateBadge({ state }: { state: WorkshopState }) {
  return <span className={`state-badge state-${state}`}>{STATE_LABEL[state]}</span>
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'bad' | 'warn' }) {
  return (
    <div className={`m3-stat ${tone ? `m3-stat-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
