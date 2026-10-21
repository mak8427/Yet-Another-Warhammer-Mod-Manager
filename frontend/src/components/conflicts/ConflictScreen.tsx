import { useMemo, useState } from 'react'
import type { ConflictReport, IpcError } from '../../lib/ipc'
import { middleEllipsis } from '../../lib/ui'
import { EmptyState } from '../common/EmptyState'
import { ErrorBanner } from '../shell/ErrorBanner'

interface ConflictScreenProps {
  report: ConflictReport | null
  loading: boolean
  error: IpcError | null
  onRefresh: () => void
  onDismissError: () => void
}

type Filter = 'all' | 'conflicts' | 'missing' | 'duplicates'

interface Row {
  id: string
  path: string
  winner: string | null
  losers: string[]
  type: string
  detail: string
  subrows?: string[]
}

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'conflicts', label: 'Conflicts' },
  { id: 'missing', label: 'Missing dependencies' },
  { id: 'duplicates', label: 'Duplicate names' },
]

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function ConflictScreen({
  report,
  loading,
  error,
  onRefresh,
  onDismissError,
}: ConflictScreenProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const names = useMemo(
    () => new Map((report?.modSummaries ?? []).map((summary) => [summary.modId, summary.name])),
    [report],
  )

  const rows = useMemo<Row[]>(() => {
    if (!report) return []
    const conflicts: Row[] = report.conflicts.map((conflict) => ({
      id: `conflict:${conflict.path}`,
      path: conflict.path,
      winner: names.get(conflict.winnerModId) ?? conflict.winnerModId,
      losers: conflict.loserModIds.map((id) => names.get(id) ?? id),
      type: 'Conflict',
      detail: `Winner: ${names.get(conflict.winnerModId) ?? conflict.winnerModId}`,
      subrows: conflict.loserModIds.map((id) => `Loses: ${names.get(id) ?? id}`),
    }))
    const missing: Row[] = [
      ...report.missingDependencies.map((entry) => ({
        id: `missing:${entry.modId}:${entry.missing.join(',')}`,
        path: `${names.get(entry.modId) ?? entry.modId} → ${entry.missing.join(', ')}`,
        winner: null,
        losers: entry.missing,
        type: 'Missing dependency',
        detail: `${names.get(entry.modId) ?? entry.modId} requires ${entry.missing.join(', ')}`,
      })),
      ...report.disabledDependencies.map((entry) => ({
        id: `disabled:${entry.modId}:${entry.dependency}`,
        path: `${names.get(entry.modId) ?? entry.modId} → ${entry.dependency}`,
        winner: null,
        losers: [entry.dependency],
        type: 'Disabled dependency',
        detail: `${names.get(entry.modId) ?? entry.modId} requires ${
          names.get(entry.providerModId) ?? entry.providerModId
        }, which is disabled`,
      })),
    ]
    const duplicates: Row[] = report.duplicatePackNames.map((entry) => ({
      id: `duplicate:${entry.name}`,
      path: entry.name,
      winner: null,
      losers: entry.modIds.map((id) => names.get(id) ?? id),
      type: 'Duplicate name',
      detail: `${entry.name} is carried by ${entry.modIds.length} packs`,
    }))
    if (filter === 'conflicts') return conflicts
    if (filter === 'missing') return missing
    if (filter === 'duplicates') return duplicates
    return [...conflicts, ...missing, ...duplicates]
  }, [report, names, filter])

  const selected = rows.find((row) => row.id === selectedId) ?? null
  const enabledCount = report?.modSummaries.length ?? 0
  const summary = report
    ? `${countLabel(report.conflicts.length, 'shared path', 'shared paths')} · ${countLabel(
        report.missingDependencies.length,
        'missing dependency',
        'missing dependencies',
      )} · ${countLabel(report.duplicatePackNames.length, 'duplicate name', 'duplicate names')}`
    : 'Reading enabled pack indexes'

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="conflict-screen" aria-labelledby="conflict-heading">
      <div className="screen-bar">
        <div className="screen-title">
          <h2 id="conflict-heading" tabIndex={-1}>
            Conflicts
          </h2>
          <span className="screen-count mono">{summary}</span>
        </div>
        <div className="screen-actions">
          <button type="button" className="btn btn-small" onClick={onRefresh} disabled={loading}>
            {loading ? 'Scanning…' : 'Rescan'}
          </button>
        </div>
      </div>

      {error && <ErrorBanner error={error} onDismiss={onDismissError} onRetry={onRefresh} />}

      <div className="filter-tabs" role="tablist" aria-label="Conflict filters">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={filter === entry.id}
            className={`filter-tab${filter === entry.id ? ' is-active' : ''}`}
            onClick={() => {
              setFilter(entry.id)
              setSelectedId(null)
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="conflict-body">
        <div className="table-wrap conflict-table-wrap">
          {rows.length === 0 ? (
            <EmptyState
              title={
                loading
                  ? 'Reading enabled pack indexes'
                  : `No conflicts across ${enabledCount} enabled mod${enabledCount === 1 ? '' : 's'}.`
              }
              action={
                <button type="button" className="btn" onClick={onRefresh} disabled={loading}>
                  Rescan
                </button>
              }
            >
              {filter === 'all'
                ? 'Enabled packs do not share paths, dependencies, or names.'
                : 'Change the filter or rescan after enabling mods.'}
            </EmptyState>
          ) : (
            <table className="data-table conflict-table">
              <colgroup>
                <col className="col-expand" />
                <col />
                <col className="col-winner" />
                <col className="col-losers" />
                <col className="col-type" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" aria-label="Expand" />
                  <th scope="col">Path</th>
                  <th scope="col">Winner</th>
                  <th scope="col" className="align-right">
                    Losers
                  </th>
                  <th scope="col">Type</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isExpanded = expanded.has(row.id)
                  return (
                    <FragmentRow
                      key={row.id}
                      row={row}
                      expanded={isExpanded}
                      selected={selectedId === row.id}
                      onSelect={() => setSelectedId(row.id)}
                      onToggle={() => toggle(row.id)}
                    />
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <aside className="conflict-detail" aria-label="Conflict details">
            <h3 className="label">Detail</h3>
            <p className="mono conflict-path">{selected.path}</p>
            <dl className="inspector-facts">
              <div>
                <dt>Type</dt>
                <dd>{selected.type}</dd>
              </div>
              <div>
                <dt>Winner</dt>
                <dd>{selected.winner ?? '—'}</dd>
              </div>
              <div>
                <dt>Losers</dt>
                <dd>{selected.losers.length}</dd>
              </div>
            </dl>
            <p className="inspector-note">{selected.detail}</p>
            {selected.losers.length > 0 && (
              <ul className="inspector-list">
                {selected.losers.map((loser) => (
                  <li key={loser} className="truncate" title={loser}>
                    {loser}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
    </section>
  )
}

function FragmentRow({
  row,
  expanded,
  selected,
  onSelect,
  onToggle,
}: {
  row: Row
  expanded: boolean
  selected: boolean
  onSelect: () => void
  onToggle: () => void
}) {
  return (
    <>
      <tr
        tabIndex={0}
        className={selected ? 'is-selected' : undefined}
        aria-selected={selected}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onSelect()
          } else if (event.key === 'ArrowRight' && row.subrows) {
            event.preventDefault()
            if (!expanded) onToggle()
          } else if (event.key === 'ArrowLeft' && row.subrows) {
            event.preventDefault()
            if (expanded) onToggle()
          }
        }}
      >
        <td>
          {row.subrows && row.subrows.length > 0 ? (
            <button
              type="button"
              className="expand-button"
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse losers' : 'Expand losers'}
              onClick={(event) => {
                event.stopPropagation()
                onToggle()
              }}
            >
              <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
            </button>
          ) : (
            <span className="state-shape" aria-hidden="true">
              {row.type === 'Missing dependency' || row.type === 'Disabled dependency' ? '▲' : '◆'}
            </span>
          )}
        </td>
        <td className="mono conflict-path" title={row.path}>
          {middleEllipsis(row.path, 88)}
        </td>
        <td>
          {row.winner ? (
            <>
              <span className="winner-cell">
                <span aria-hidden="true">✓</span> Wins
              </span>
              <span className="conflict-winner-name truncate" title={row.winner}>
                {row.winner}
              </span>
            </>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td className="align-right mono">{row.losers.length}</td>
        <td>{row.type}</td>
      </tr>
      {expanded &&
        row.subrows?.map((subrow, index) => (
          <tr key={`${row.id}:${index}`} className="subrow">
            <td />
            <td colSpan={4} className="mono">
              {subrow}
            </td>
          </tr>
        ))}
    </>
  )
}
