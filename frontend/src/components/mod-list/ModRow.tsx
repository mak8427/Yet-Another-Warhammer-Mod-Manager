import type { MouseEvent as ReactMouseEvent } from 'react'
import { fileUrl, type ConflictModSummary, type ModSummary, type Tag } from '../../lib/ipc'
import { formatBytes, formatDate } from '../../lib/format'
import { gridColumns } from './grid'

export interface ModRowProps {
  mod: ModSummary
  selected: boolean
  focused: boolean
  rowHeight: number
  showAuthors: boolean
  showThumbnails: boolean
  tagsById: Map<string, Tag>
  conflictSummary?: ConflictModSummary
  onToggle: (modId: string) => void
  onSelect: (modId: string, event: ReactMouseEvent) => void
  onDragStart: (modId: string) => void
  onDragOverRow: (modId: string) => void
  onDropRow: (modId: string) => void
  onDragEnd: () => void
  registerRow: (modId: string, element: HTMLDivElement | null) => void
}

export function ModRow({
  mod,
  selected,
  focused,
  rowHeight,
  showAuthors,
  showThumbnails,
  tagsById,
  conflictSummary,
  onToggle,
  onSelect,
  onDragStart,
  onDragOverRow,
  onDropRow,
  onDragEnd,
  registerRow,
}: ModRowProps) {
  const tags = mod.tags.map((id) => tagsById.get(id)).filter((tag): tag is Tag => Boolean(tag))
  const visibleTags = tags.slice(0, 2)
  const extraTags = tags.length - visibleTags.length

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={`${mod.humanName}${mod.isEnabled ? ', enabled' : ', disabled'}`}
      className={[
        'mod-row',
        mod.isEnabled ? 'is-enabled' : 'is-disabled',
        selected ? 'is-selected' : '',
        mod.packError ? 'has-error' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ height: rowHeight, gridTemplateColumns: gridColumns(showAuthors, showThumbnails) }}
      tabIndex={focused ? 0 : -1}
      data-mod-id={mod.id}
      ref={(element) => registerRow(mod.id, element)}
      onClick={(event) => onSelect(mod.id, event)}
      draggable={mod.isEnabled}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', mod.id)
        onDragStart(mod.id)
      }}
      onDragOver={(event) => {
        if (!mod.isEnabled) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onDragOverRow(mod.id)
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onDropRow(mod.id)
      }}
      onDragEnd={onDragEnd}
    >
      <span className={`drag-grip ${mod.isEnabled ? '' : 'drag-grip-disabled'}`} aria-hidden="true">
        ⠿
      </span>
      <input
        type="checkbox"
        className="mod-toggle"
        checked={mod.isEnabled}
        aria-label={`${mod.isEnabled ? 'Disable' : 'Enable'} ${mod.humanName}`}
        onClick={(event) => event.stopPropagation()}
        onChange={() => onToggle(mod.id)}
      />
      {showThumbnails ? (
        <span className="mod-thumb" aria-hidden="true">
          {mod.thumbnailPath ? <img src={fileUrl(mod.thumbnailPath)} alt="" loading="lazy" /> : <span>{initials(mod.humanName)}</span>}
        </span>
      ) : null}
      <span className="mod-name-cell">
        <span className="mod-title">
          {mod.isEnabled && <span className="order-number">{mod.loadOrder + 1}</span>}
          <span className="mod-title-text">{mod.humanName}</span>
          {mod.isWorkshop && <span className="row-badge">WS</span>}
          {mod.isMovie && <span className="row-badge row-badge-muted">MOV</span>}
          {conflictSummary && conflictSummary.overrides > 0 && (
            <span
              className="row-badge row-badge-conflict"
              title={`Wins ${conflictSummary.overrides} shared file path(s)`}
            >
              W{conflictSummary.overrides}
            </span>
          )}
          {conflictSummary && conflictSummary.overriddenOn > 0 && (
            <span
              className="row-badge row-badge-overridden"
              title={`Overridden on ${conflictSummary.overriddenOn} shared file path(s)`}
            >
              L{conflictSummary.overriddenOn}
            </span>
          )}
          {conflictSummary && conflictSummary.baseTableOverrides > 0 && (
            <span
              className="row-badge row-badge-muted"
              title={`Shadows ${conflictSummary.baseTableOverrides} base-game table path(s)`}
            >
              DB
            </span>
          )}
          {mod.packError && (
            <span className="row-warning" title={mod.packError} aria-label={`Pack error: ${mod.packError}`}>
              !
            </span>
          )}
        </span>
        <span className="mod-subtitle">
          {mod.name}
          {!showAuthors && mod.author ? ` · ${mod.author}` : ''}
        </span>
      </span>
      {showAuthors ? <span className="mod-author">{mod.author ?? '—'}</span> : null}
      <span className="mod-tags">
        {visibleTags.map((tag) => (
          <span key={tag.id} className="tag-chip tag-chip-small" title={tag.name}>
            <span className="tag-dot" style={{ background: tag.color }} />
            {tag.name}
          </span>
        ))}
        {extraTags > 0 && <span className="tag-more">+{extraTags}</span>}
      </span>
      <span className="mod-size">{formatBytes(mod.sizeBytes)}</span>
      <span className="mod-updated">{formatDate(mod.updatedAt)}</span>
    </div>
  )
}

function initials(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').split(/\s+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}
