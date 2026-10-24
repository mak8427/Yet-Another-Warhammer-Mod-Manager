import { memo, useCallback, type MouseEvent as ReactMouseEvent } from 'react'
import {
  fileUrl,
  type ConflictModSummary,
  type ModSummary,
  type Tag,
} from '../../lib/ipc'
import { factionSlotForColor } from '../../lib/ui'

export interface ModRowProps {
  mod: ModSummary
  selected: boolean
  focused: boolean
  rowHeight: number
  columns: string
  showThumbnails: boolean
  tagsById: Map<string, Tag>
  conflictSummary?: ConflictModSummary
  missingDependencies?: string[]
  onToggle: (modId: string) => void
  onSelect: (modId: string, event: ReactMouseEvent) => void
  onInspect: (modId: string) => void
  onOpenMenu: (modId: string, x: number, y: number) => void
  onDragStart: (modId: string) => void
  onDragOverRow: (modId: string) => void
  onDropRow: (modId: string) => void
  onDragEnd: () => void
  registerRow: (modId: string, element: HTMLDivElement | null) => void
}

export const ModRow = memo(function ModRow({
  mod,
  selected,
  focused,
  rowHeight,
  columns,
  showThumbnails,
  tagsById,
  conflictSummary,
  missingDependencies,
  onToggle,
  onSelect,
  onInspect,
  onOpenMenu,
  onDragStart,
  onDragOverRow,
  onDropRow,
  onDragEnd,
  registerRow,
}: ModRowProps) {
  const rowRef = useCallback(
    (element: HTMLDivElement | null) => registerRow(mod.id, element),
    [mod.id, registerRow],
  )
  const tags = mod.tags.map((id) => tagsById.get(id)).filter((tag): tag is Tag => Boolean(tag))
  const visibleTags = tags.slice(0, 2)
  const extraTags = tags.length - visibleTags.length
  const wins = (conflictSummary?.overrides ?? 0) > 0
  const loses = (conflictSummary?.overriddenOn ?? 0) > 0
  const missing = (missingDependencies?.length ?? 0) > 0
  const statusLabel = [
    wins || loses ? 'Conflict' : null,
    missing ? 'Missing dependency' : null,
  ]
    .filter(Boolean)
    .join(' and ')
  const openMenuAt = (x: number, y: number) => onOpenMenu(mod.id, x, y)

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={`${mod.humanName}${mod.isEnabled ? ', enabled' : ', disabled'}${
        statusLabel ? `, ${statusLabel}` : ''
      }`}
      className={[
        'mod-row',
        mod.isEnabled ? 'is-enabled' : 'is-disabled',
        selected ? 'is-selected' : '',
        focused ? 'is-focused' : '',
        mod.packError ? 'has-error' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ height: rowHeight, gridTemplateColumns: columns }}
      tabIndex={focused ? 0 : -1}
      data-mod-id={mod.id}
      ref={rowRef}
      onClick={(event) => onSelect(mod.id, event)}
      onDoubleClick={() => onInspect(mod.id)}
      onContextMenu={(event) => {
        event.preventDefault()
        openMenuAt(event.clientX, event.clientY)
      }}
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
      <span
        className="row-order"
        title={mod.isEnabled ? 'Drag to reorder' : 'Disabled mods are not in the load order'}
        aria-hidden="true"
      >
        {mod.isEnabled ? mod.loadOrder + 1 : '–'}
      </span>

      <span className="row-check">
        <input
          type="checkbox"
          checked={mod.isEnabled}
          aria-label={`${mod.isEnabled ? 'Disable' : 'Enable'} ${mod.humanName}`}
          tabIndex={focused ? 0 : -1}
          onClick={(event) => event.stopPropagation()}
          onChange={() => onToggle(mod.id)}
        />
      </span>

      {showThumbnails ? (
        <span className="row-thumb" aria-hidden="true">
          {mod.thumbnailPath ? (
            <img src={fileUrl(mod.thumbnailPath)} alt="" loading="lazy" />
          ) : (
            <span>{initials(mod.humanName)}</span>
          )}
        </span>
      ) : null}

      <span className="row-name">
        <span className="row-title">
          <span className="row-title-text" title={mod.humanName}>
            {mod.humanName}
          </span>
          {mod.isMovie && <span className="row-badge row-badge-muted">Movie</span>}
          {mod.packError && (
            <span className="row-warning" title={mod.packError} role="img" aria-label="Pack header error">
              !
            </span>
          )}
        </span>
        <span className="row-meta" title={mod.name}>
          <span className="row-pack">{mod.name}</span>
        </span>
        {!columns.includes('var(--row-tags-w)') && visibleTags.length > 0 && (
          <span className="row-inline-tags">
            {visibleTags.map((tag) => (
              <span
                key={tag.id}
                className="tag-chip tag-chip-inline"
                data-faction={factionSlotForColor(tag.color)}
                title={tag.name}
              >
                {tag.name}
              </span>
            ))}
            {extraTags > 0 && <span className="tag-more">+{extraTags}</span>}
          </span>
        )}
      </span>

      {columns.includes('var(--row-tags-w)') && (
        <span className="row-tags" title={tags.map((tag) => tag.name).join(', ')}>
          {visibleTags.map((tag) => (
            <span
              key={tag.id}
              className="tag-chip tag-chip-small"
              data-faction={factionSlotForColor(tag.color)}
            >
              {tag.name}
            </span>
          ))}
          {extraTags > 0 && <span className="tag-more">+{extraTags}</span>}
        </span>
      )}

      <span className="row-status" role="img" aria-label={statusLabel || 'No conflicts'}>
        {wins || loses ? (
          <span className={`status-diamond${missing ? ' has-missing' : ''}`} aria-hidden="true" />
        ) : null}
        {missing ? <span className="status-triangle" aria-hidden="true" /> : null}
        {!wins && !loses && !missing && <span className="status-clear" aria-hidden="true">·</span>}
      </span>

      <span className="row-menu">
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-small row-menu-button"
          aria-label={`Actions for ${mod.humanName}`}
          aria-haspopup="menu"
          tabIndex={focused ? 0 : -1}
          onClick={(event) => {
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            openMenuAt(rect.right - 4, rect.bottom + 2)
          }}
        >
          <span aria-hidden="true">⋯</span>
        </button>
      </span>
    </div>
  )
})

function initials(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').split(/\s+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}
