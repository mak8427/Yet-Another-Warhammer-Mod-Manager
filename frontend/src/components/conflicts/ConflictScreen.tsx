import type { ConflictModSummary, ConflictReport, IpcError } from '../../lib/ipc'
import { ErrorBanner } from '../shell/ErrorBanner'

interface ConflictScreenProps {
  report: ConflictReport | null
  loading: boolean
  error: IpcError | null
  onRefresh: () => void
  onDismissError: () => void
}

export function ConflictScreen({
  report,
  loading,
  error,
  onRefresh,
  onDismissError,
}: ConflictScreenProps) {
  const summaries = report?.modSummaries ?? []
  const names = new Map(summaries.map((summary) => [summary.modId, summary.name]))
  const conflicts = report?.conflicts ?? []
  const missing = report?.missingDependencies ?? []
  const duplicates = report?.duplicatePackNames ?? []
  const disabled = report?.disabledDependencies ?? []
  const shadows = report?.shadowedBaseTables ?? []

  return (
    <section className="m3-screen" aria-labelledby="conflict-heading">
      <div className="pane-heading pane-heading-tight">
        <div>
          <p className="eyebrow">Muster roll</p>
          <h2 id="conflict-heading">Conflicts</h2>
        </div>
        <div className="pane-meta">
          Bottom of the load order wins
          <button type="button" className="btn btn-small" onClick={onRefresh} disabled={loading}>
            {loading ? 'Scanning…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <ErrorBanner error={error} onDismiss={onDismissError} />}

      <div className="m3-stat-strip" aria-label="Conflict summary">
        <Stat label="Shared paths" value={conflicts.length} />
        <Stat label="Missing dependencies" value={missing.length} tone={missing.length > 0 ? 'bad' : undefined} />
        <Stat label="Duplicate names" value={duplicates.length} tone={duplicates.length > 0 ? 'bad' : undefined} />
        <Stat
          label="Base-game tables shadowed"
          value={report?.shadowedBaseTableCount ?? 0}
          tone={(report?.shadowedBaseTableCount ?? 0) > 0 ? 'warn' : undefined}
        />
      </div>

      {report?.warnings.map((warning, index) => (
        <div key={`${index}-${warning}`} className="banner banner-warning" role="status">
          <div className="banner-body">
            <span>{warning}</span>
          </div>
        </div>
      ))}

      <div className="panel">
        <div className="panel-heading">
          <h3>File conflicts</h3>
          <span className="muted">{conflicts.length} shared paths</span>
        </div>
        {conflicts.length === 0 ? (
          <p className="muted">
            {loading ? 'Reading enabled pack indexes…' : 'No enabled mods share a file path.'}
          </p>
        ) : (
          <div className="m3-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Path</th>
                  <th scope="col">Winner</th>
                  <th scope="col">Overridden</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((conflict) => (
                  <tr key={conflict.path}>
                    <td className="mono">{conflict.path}</td>
                    <td>
                      <span className="winner-name">{names.get(conflict.winnerModId) ?? conflict.winnerModId}</span>
                    </td>
                    <td className="muted">
                      {conflict.loserModIds.map((id) => names.get(id) ?? id).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="m3-two-column">
        <div className="panel">
          <div className="panel-heading">
            <h3>Dependencies</h3>
          </div>
          {missing.length === 0 && disabled.length === 0 ? (
            <p className="muted">Every declared dependency is installed and enabled.</p>
          ) : (
            <ul className="m3-list">
              {missing.map((entry) => (
                <li key={`missing-${entry.modId}`}>
                  <strong>{names.get(entry.modId) ?? entry.modId}</strong> is missing{' '}
                  <span className="mono">{entry.missing.join(', ')}</span>
                </li>
              ))}
              {disabled.map((entry) => (
                <li key={`disabled-${entry.modId}-${entry.dependency}`}>
                  <strong>{names.get(entry.modId) ?? entry.modId}</strong> requires{' '}
                  <span className="mono">{entry.dependency}</span>, but{' '}
                  {names.get(entry.providerModId) ?? entry.providerModId} is disabled
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h3>Duplicate pack names</h3>
          </div>
          {duplicates.length === 0 ? (
            <p className="muted">No duplicate pack names were found.</p>
          ) : (
            <ul className="m3-list">
              {duplicates.map((entry) => (
                <li key={entry.name}>
                  <span className="mono">{entry.name}</span> is carried by {entry.modIds.length} files
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h3>Base-game table overrides</h3>
          <span className="muted">
            {report?.shadowedBaseTableCount ?? 0} paths
            {shadows.length < (report?.shadowedBaseTableCount ?? 0) ? ` · first ${shadows.length} shown` : ''}
          </span>
        </div>
        {shadows.length === 0 ? (
          <p className="muted">No enabled mod replaces a base-game database table.</p>
        ) : (
          <div className="m3-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Mod</th>
                  <th scope="col">Table</th>
                  <th scope="col">Base pack</th>
                </tr>
              </thead>
              <tbody>
                {shadows.map((shadow) => (
                  <tr key={`${shadow.modId}-${shadow.path}`}>
                    <td>{names.get(shadow.modId) ?? shadow.modId}</td>
                    <td className="mono">{shadow.path}</td>
                    <td className="mono">{shadow.basePack}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h3>Per-mod summary</h3>
        </div>
        {summaries.length === 0 ? (
          <p className="muted">Enable mods to see how many files each one wins or loses.</p>
        ) : (
          <div className="m3-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Mod</th>
                  <th scope="col">Files</th>
                  <th scope="col">Overrides</th>
                  <th scope="col">Overridden on</th>
                  <th scope="col">Base tables</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((summary) => (
                  <SummaryRow key={summary.modId} summary={summary} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function SummaryRow({ summary }: { summary: ConflictModSummary }) {
  return (
    <tr>
      <td>{summary.name}</td>
      <td>{summary.fileCount}</td>
      <td>{summary.overrides}</td>
      <td>{summary.overriddenOn}</td>
      <td>{summary.baseTableOverrides}</td>
    </tr>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'bad' | 'warn' }) {
  return (
    <div className={`m3-stat ${tone ? `m3-stat-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
