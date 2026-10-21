import type { LoadOrderReadReport } from '../../lib/ipc'

interface LoadOrderBannerProps {
  loadOrder: LoadOrderReadReport
  busy: boolean
  onRestore: () => void
  onOpenWrite: () => void
}

export function LoadOrderBanner({ loadOrder, busy, onRestore, onOpenWrite }: LoadOrderBannerProps) {
  if (loadOrder.corrupt) {
    return (
      <div className="banner banner-error" role="alert">
        <div className="banner-body">
          <strong>used_mods.txt needs recovery</strong>
          <span>{loadOrder.message ?? 'The file could not be parsed.'}</span>
          <code className="banner-details">{loadOrder.path}</code>
        </div>
        <div className="banner-actions">
          <button
            type="button"
            className="btn btn-small"
            onClick={onRestore}
            disabled={busy || !loadOrder.backupAvailable}
            title={loadOrder.backupAvailable ? 'Restore used_mods.txt.bak' : 'No backup is available'}
          >
            Restore backup
          </button>
          <button type="button" className="btn btn-small btn-ghost" onClick={onOpenWrite} disabled={busy}>
            Review write
          </button>
        </div>
      </div>
    )
  }

  const issues: string[] = []
  if (loadOrder.missingNames.length > 0) {
    issues.push(
      `${loadOrder.missingNames.length} saved mod${loadOrder.missingNames.length === 1 ? '' : 's'} no longer resolve: ${loadOrder.missingNames
        .slice(0, 4)
        .join(', ')}${loadOrder.missingNames.length > 4 ? '…' : ''}`,
    )
  }
  if (loadOrder.duplicates.length > 0) {
    issues.push(`${loadOrder.duplicates.length} duplicate name${loadOrder.duplicates.length === 1 ? '' : 's'} in used_mods.txt; the first wins.`)
  }
  if (loadOrder.unmanagedDirectives.length > 0) {
    issues.push(
      `${loadOrder.unmanagedDirectives.length} unmanaged directive${loadOrder.unmanagedDirectives.length === 1 ? '' : 's'} will be removed by the next write.`,
    )
  }
  if (issues.length === 0) return null

  return (
    <div className="banner banner-warning" role="status">
      <div className="banner-body">
        {issues.map((issue) => (
          <span key={issue}>{issue}</span>
        ))}
      </div>
      <div className="banner-actions">
        <button type="button" className="btn btn-small" onClick={onOpenWrite} disabled={busy}>
          Review write
        </button>
      </div>
    </div>
  )
}
