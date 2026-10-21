import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Density, Tag } from '../../lib/ipc'
import { DENSITIES, DENSITY_LABEL, factionSlotForColor } from '../../lib/ui'
import type { SortMode } from '../../store'

interface ModToolbarProps {
  tags: Tag[]
  density: Density
  showThumbnails: boolean
  query: string
  activeTagIds: string[]
  sort: SortMode
  modCount: number
  busy: boolean
  onQuery: (query: string) => void
  onTag: (tagId: string) => void
  onClearFilters: () => void
  onDensity: (density: Density) => void
  onShowThumbnails: (value: boolean) => void
  onSort: (sort: SortMode) => void
  onWriteLoadOrder: () => void
}

const SORT_LABEL: Record<SortMode, string> = {
  'load-order': 'Load order',
  name: 'Name A–Z',
  updated: 'Updated newest',
}

export function ModToolbar({
  tags,
  density,
  showThumbnails,
  query,
  activeTagIds,
  sort,
  modCount,
  busy,
  onQuery,
  onTag,
  onClearFilters,
  onDensity,
  onShowThumbnails,
  onSort,
  onWriteLoadOrder,
}: ModToolbarProps) {
  const activeTags = activeTagIds
    .map((id) => tags.find((tag) => tag.id === id))
    .filter((tag): tag is Tag => Boolean(tag))
  const titleTag = activeTags.length === 1 ? activeTags[0] : null
  const hasFilters = query.trim().length > 0 || activeTagIds.length > 0

  return (
    <div className="toolbar" data-region="toolbar">
      <div
        className={`toolbar-title${titleTag ? ' has-faction' : ''}`}
        data-faction={titleTag ? factionSlotForColor(titleTag.color) : undefined}
      >
        <h2 tabIndex={-1} data-screen-title>
          {titleTag ? `Mods · ${titleTag.name}` : 'Mods'}
        </h2>
        <span className="toolbar-count">
          {modCount} mods
        </span>
      </div>

      <span className="toolbar-rule" aria-hidden="true" />

      <div className="search-box">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <input
          id="mod-search"
          type="search"
          className="search-input"
          placeholder="Search names and packs"
          aria-label="Search mods"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onQuery('')
              document.querySelector<HTMLElement>('.mod-list-scroll')?.focus()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              document.querySelector<HTMLElement>('.mod-row')?.focus()
            }
          }}
        />
        <kbd className="search-hint">Ctrl+F</kbd>
      </div>

      <div className="toolbar-filters">
        {activeTags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className="filter-chip"
            data-faction={factionSlotForColor(tag.color)}
            onClick={() => onTag(tag.id)}
            title={`Remove ${tag.name} filter`}
          >
            <span className="filter-chip-label">{tag.name}</span>
            <span className="filter-chip-remove" aria-hidden="true">
              ×
            </span>
          </button>
        ))}
        {hasFilters && (
          <button type="button" className="btn btn-ghost btn-small" onClick={onClearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <div className="toolbar-actions">
        <ToolbarMenu label="Tags" badge={tags.length}>
          {(close) => (
            <div className="menu-list">
              {tags.length === 0 && <p className="menu-note">No tags yet. Add tags in the inspector.</p>}
              {tags.map((tag) => {
                const active = activeTagIds.includes(tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={active}
                    className="menu-item"
                    data-faction={factionSlotForColor(tag.color)}
                    onClick={() => onTag(tag.id)}
                  >
                    <span className="tag-accent" aria-hidden="true" />
                    <span>{tag.name}</span>
                    <span className="menu-check" aria-hidden="true">
                      {active ? '✓' : ''}
                    </span>
                  </button>
                )
              })}
              {activeTagIds.length > 0 && (
                <>
                  <div className="menu-rule" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      onClearFilters()
                      close()
                    }}
                  >
                    Clear filters
                  </button>
                </>
              )}
            </div>
          )}
        </ToolbarMenu>

        <label className="toolbar-field">
          <span className="toolbar-label">Sort:</span>
          <select value={sort} onChange={(event) => onSort(event.target.value as SortMode)}>
            {(Object.keys(SORT_LABEL) as SortMode[]).map((value) => (
              <option key={value} value={value}>
                {SORT_LABEL[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="toolbar-field">
          <span className="toolbar-label">Density:</span>
          <select
            value={density}
            aria-label="Density"
            onChange={(event) => onDensity(event.target.value as Density)}
          >
            {DENSITIES.map((value) => (
              <option key={value} value={value}>
                {DENSITY_LABEL[value]}
              </option>
            ))}
          </select>
        </label>

        <ToolbarMenu label="Columns" icon="▦">
          {(close) => (
            <div className="menu-list">
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={showThumbnails}
                className="menu-item"
                onClick={() => onShowThumbnails(!showThumbnails)}
              >
                <span>Show thumbnails</span>
                <span className="menu-check" aria-hidden="true">
                  {showThumbnails ? '✓' : ''}
                </span>
              </button>
              <div className="menu-rule" role="separator" />
              <button type="button" role="menuitem" className="menu-item" onClick={close}>
                Close
              </button>
            </div>
          )}
        </ToolbarMenu>

        <button
          type="button"
          className="btn btn-primary"
          onClick={onWriteLoadOrder}
          disabled={busy}
          title="Preview and write used_mods.txt"
        >
          Apply load order
        </button>
      </div>
    </div>
  )
}

function ToolbarMenu({
  label,
  badge,
  icon,
  children,
}: {
  label: string
  badge?: number
  icon?: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="toolbar-menu" ref={ref}>
      <button
        type="button"
        className="btn btn-small toolbar-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon && <span aria-hidden="true">{icon}</span>}
        {label}
        {badge !== undefined && <span className="toolbar-menu-badge">{badge}</span>}
      </button>
      {open && (
        <div className="toolbar-popover" role="menu" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
