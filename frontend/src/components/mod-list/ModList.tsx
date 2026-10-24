import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { ConflictModSummary, ModSummary, Tag } from '../../lib/ipc'
import { ROW_HEIGHT, visibleRowCount } from '../../lib/ui'
import { virtualRange } from '../../lib/virtual'
import { EmptyState } from '../common/EmptyState'
import { ModRow } from './ModRow'
import { gridColumns, showTagsColumn } from './grid'
import type { MoveTarget, SelectMode, SortMode } from '../../store'

interface ModListProps {
  mods: ModSummary[]
  tags: Tag[]
  selection: string[]
  sort: SortMode
  density: 'compact' | 'comfortable' | 'roomy'
  showThumbnails: boolean
  initialScrollTop: number
  conflictSummaries: Map<string, ConflictModSummary>
  missingByMod: Map<string, string[]>
  emptyTitle: string
  emptyMessage: string
  emptyAction?: { label: string; onClick: () => void }
  viewportHeightOverride?: number
  onToggle: (modId: string) => void
  onSelect: (modId: string, mode: SelectMode) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onInspect: (modId: string) => void
  onMove: (target: MoveTarget) => void
  onSort: (sort: SortMode) => void
  onReorder: (draggedIds: string[], targetId: string | null) => Promise<void> | void
  onScrollTop: (top: number) => void
}

const OVERSCAN = 10
const MENU_WIDTH = 220
const MENU_HEIGHT = 260

interface MenuState {
  modId: string
  x: number
  y: number
}

export function ModList({
  mods,
  tags,
  selection,
  sort,
  density,
  showThumbnails,
  initialScrollTop,
  conflictSummaries,
  missingByMod,
  emptyTitle,
  emptyMessage,
  emptyAction,
  viewportHeightOverride,
  onToggle,
  onSelect,
  onSelectAll,
  onClearSelection,
  onInspect,
  onMove,
  onSort,
  onReorder,
  onScrollTop,
}: ModListProps) {
  const rowHeight = ROW_HEIGHT[density]
  const containerRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const didInitScroll = useRef(false)
  const lastRowHeight = useRef(rowHeight)
  const [scrollTop, setScrollTop] = useState(Math.max(0, initialScrollTop))
  const [measuredHeight, setMeasuredHeight] = useState(520)
  const [measuredWidth, setMeasuredWidth] = useState(1600)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const activeFocusedId = focusedId && mods.some((mod) => mod.id === focusedId) ? focusedId : null
  const [draggedIds, setDraggedIds] = useState<string[]>([])
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const viewportHeight = viewportHeightOverride ?? measuredHeight
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags])
  const selectedSet = useMemo(() => new Set(selection), [selection])
  const maxScrollTop = Math.max(0, mods.length * rowHeight - viewportHeight)
  const effectiveScrollTop = Math.min(scrollTop, maxScrollTop)
  const range = virtualRange(mods.length, rowHeight, viewportHeight, effectiveScrollTop, OVERSCAN)
  const visible = mods.slice(range.start, range.end)
  const columns = gridColumns({ showThumbnails, width: measuredWidth })
  const tagsColumn = showTagsColumn(measuredWidth)

  useEffect(() => {
    if (viewportHeightOverride !== undefined) return
    const element = containerRef.current
    if (!element) return
    const measure = () => {
      setMeasuredHeight(element.clientHeight || 520)
      setMeasuredWidth(element.clientWidth || 1600)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [viewportHeightOverride])

  useEffect(() => {
    if (didInitScroll.current) return
    const element = containerRef.current
    if (element) {
      element.scrollTop = Math.min(initialScrollTop, maxScrollTop)
      didInitScroll.current = true
    }
  }, [initialScrollTop, maxScrollTop])

  useEffect(() => {
    if (lastRowHeight.current === rowHeight) return
    const element = containerRef.current
    const previous = lastRowHeight.current
    const firstVisible = element ? Math.floor(element.scrollTop / previous) : 0
    const next = firstVisible * rowHeight
    lastRowHeight.current = rowHeight
    if (element) element.scrollTop = Math.min(next, Math.max(0, mods.length * rowHeight - viewportHeight))
    setScrollTop(next)
  }, [rowHeight, mods.length, viewportHeight])

  useEffect(() => {
    if (!activeFocusedId) return
    rowRefs.current.get(activeFocusedId)?.focus({ preventScroll: true })
  }, [activeFocusedId, range.start, range.end])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenu(null)
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [])

  const registerRow = useCallback((modId: string, element: HTMLDivElement | null) => {
    if (element) rowRefs.current.set(modId, element)
    else rowRefs.current.delete(modId)
  }, [])

  const focusIndex = useCallback(
    (index: number) => {
      if (mods.length === 0) return
      const clamped = Math.max(0, Math.min(mods.length - 1, index))
      const target = mods[clamped]
      setFocusedId(target.id)
      const container = containerRef.current
      if (container) {
        const top = clamped * rowHeight
        const bottom = top + rowHeight
        if (top < container.scrollTop) {
          container.scrollTop = top
          setScrollTop(top)
        } else if (bottom > container.scrollTop + viewportHeight) {
          const next = bottom - viewportHeight
          container.scrollTop = next
          setScrollTop(next)
        }
      }
    },
    [mods, rowHeight, viewportHeight],
  )

  const handleSelect = useCallback(
    (modId: string, event: ReactMouseEvent) => {
      const mode: SelectMode =
        event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'single'
      onSelect(modId, mode)
      setFocusedId(modId)
    },
    [onSelect],
  )

  const flashAndAnnounce = useCallback((modId: string, position: number) => {
    const mod = mods.find((item) => item.id === modId)
    if (!mod) return
    setAnnouncement(`Moved ${mod.humanName} to position ${position}`)
    setFlashId(modId)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashId(null), 260)
  }, [mods])

  const handleMove = (target: MoveTarget) => {
    const focused = mods.find((mod) => mod.id === activeFocusedId)
    if (!focused || !focused.isEnabled) return
    if (!selectedSet.has(focused.id)) onSelect(focused.id, 'single')
    onMove(target)
    const enabledCount = mods.filter((mod) => mod.isEnabled).length
    const position =
      target === 'top'
        ? 1
        : target === 'bottom'
          ? enabledCount
          : target === 'up'
            ? Math.max(1, focused.loadOrder)
            : Math.min(enabledCount, focused.loadOrder + 2)
    flashAndAnnounce(focused.id, position)
  }

  const handleReorder = useCallback(async (dragged: string[], targetId: string | null) => {
    const moved = dragged[0]
    const saving = onReorder(dragged, targetId)
    if (moved) {
      const position = targetId ? mods.findIndex((mod) => mod.id === targetId) + 1 : mods.length
      flashAndAnnounce(moved, Math.max(1, position))
    }
    await saving
  }, [onReorder, mods, flashAndAnnounce])

  const openMenuAt = useCallback((modId: string, x: number, y: number) => {
    setFocusedId(modId)
    setMenu({
      modId,
      x: Math.min(x, window.innerWidth - MENU_WIDTH - 8),
      y: Math.min(y, window.innerHeight - MENU_HEIGHT - 8),
    })
  }, [])

  const handleDragStart = useCallback((modId: string) => {
    const enabledIds = new Set(mods.filter((mod) => mod.isEnabled).map((mod) => mod.id))
    const ids = selectedSet.has(modId) ? selection.filter((id) => enabledIds.has(id)) : [modId]
    setDraggedIds(ids.length > 0 ? ids : [modId])
  }, [mods, selectedSet, selection])

  const handleDragEnd = useCallback(() => {
    setDraggedIds([])
    setDropTarget(null)
  }, [])

  const handleDropRow = useCallback((targetId: string) => {
    if (draggedIds.length > 0) void handleReorder(draggedIds, targetId)
    setDraggedIds([])
    setDropTarget(null)
  }, [draggedIds, handleReorder])

  const runMenuAction = (action: MenuAction) => {
    if (!menu) return
    const mod = mods.find((item) => item.id === menu.modId)
    setMenu(null)
    if (!mod) return
    if (action === 'inspect') {
      onSelect(mod.id, 'single')
      onInspect(mod.id)
      return
    }
    if (!selectedSet.has(mod.id)) onSelect(mod.id, 'single')
    if (action === 'toggle') {
      onToggle(mod.id)
      return
    }
    if (!mod.isEnabled) return
    onMove(action)
    const enabledCount = mods.filter((item) => item.isEnabled).length
    const position =
      action === 'top'
        ? 1
        : action === 'bottom'
          ? enabledCount
          : action === 'up'
            ? Math.max(1, mod.loadOrder)
            : Math.min(enabledCount, mod.loadOrder + 2)
    flashAndAnnounce(mod.id, position)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return
    const index = activeFocusedId ? mods.findIndex((mod) => mod.id === activeFocusedId) : -1
    const page = Math.max(1, visibleRowCount(viewportHeight, rowHeight) - 1)

    if (event.key === 'ArrowDown' && !event.altKey) {
      event.preventDefault()
      const next = index < 0 ? 0 : index + 1
      focusIndex(next)
      if (event.shiftKey && mods[next]) onSelect(mods[next].id, 'range')
      else if (!event.ctrlKey && !event.metaKey && mods[next]) onSelect(mods[next].id, 'single')
      return
    }
    if (event.key === 'ArrowUp' && !event.altKey) {
      event.preventDefault()
      const previous = index < 0 ? mods.length - 1 : index - 1
      focusIndex(previous)
      if (event.shiftKey && mods[previous]) onSelect(mods[previous].id, 'range')
      else if (!event.ctrlKey && !event.metaKey && mods[previous]) onSelect(mods[previous].id, 'single')
      return
    }
    if (event.key === 'Home' && !event.altKey) {
      event.preventDefault()
      focusIndex(0)
      if (mods[0]) onSelect(mods[0].id, event.shiftKey ? 'range' : 'single')
      return
    }
    if (event.key === 'End' && !event.altKey) {
      event.preventDefault()
      focusIndex(mods.length - 1)
      if (mods[mods.length - 1]) onSelect(mods[mods.length - 1].id, event.shiftKey ? 'range' : 'single')
      return
    }
    if (event.key === 'PageDown') {
      event.preventDefault()
      focusIndex(index < 0 ? 0 : index + page)
      return
    }
    if (event.key === 'PageUp') {
      event.preventDefault()
      focusIndex(index < 0 ? 0 : index - page)
      return
    }
    if (event.key === ' ' && !event.altKey) {
      event.preventDefault()
      if (activeFocusedId) onToggle(activeFocusedId)
      else if (mods[0]) focusIndex(0)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (activeFocusedId) onInspect(activeFocusedId)
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      onSelectAll()
      return
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      handleMove(event.key === 'ArrowUp' ? 'up' : 'down')
      return
    }
    if (event.altKey && event.key === 'Home') {
      event.preventDefault()
      handleMove('top')
      return
    }
    if (event.altKey && event.key === 'End') {
      event.preventDefault()
      handleMove('bottom')
      return
    }
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault()
      const target = activeFocusedId ? rowRefs.current.get(activeFocusedId) : null
      const rect = target?.getBoundingClientRect()
      if (activeFocusedId && rect) openMenuAt(activeFocusedId, rect.left + 48, rect.top + 8)
      return
    }
    if (event.key === 'Escape') {
      if (menu) setMenu(null)
      else {
        onClearSelection()
        setFocusedId(null)
      }
    }
  }

  return (
    <div className="mod-list" data-region="list">
      <div className="mod-list-header" role="row" style={{ gridTemplateColumns: columns }}>
        <span role="columnheader" aria-label="Order" />
        <span role="columnheader" aria-label="Enabled" />
        {showThumbnails ? <span role="columnheader" aria-label="Thumbnail" /> : null}
        <span
          role="columnheader"
          aria-sort={sort === 'name' ? 'ascending' : sort === 'load-order' ? 'ascending' : 'none'}
        >
          <button type="button" className="header-sort" onClick={() => onSort('name')}>
            Name
            {sort === 'name' && <span aria-hidden="true">▴</span>}
          </button>
        </span>
        {tagsColumn ? <span role="columnheader">Tags</span> : null}
        <span role="columnheader">Status</span>
        <span role="columnheader" aria-label="Actions" />
      </div>

      <div
        className="mod-list-scroll"
        ref={containerRef}
        role="listbox"
        aria-label="Mods"
        aria-multiselectable="true"
        aria-busy={false}
        tabIndex={activeFocusedId ? -1 : 0}
        onFocus={() => {
          if (!activeFocusedId && mods[0]) setFocusedId(mods[0].id)
        }}
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop
          setScrollTop(top)
          onScrollTop(top)
        }}
        onKeyDown={handleKeyDown}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(event) => {
          event.preventDefault()
          if (draggedIds.length > 0) void handleReorder(draggedIds, null)
          setDraggedIds([])
          setDropTarget(null)
        }}
      >
        {mods.length === 0 ? (
          <EmptyState title={emptyTitle} action={emptyAction ? (
            <button type="button" className="btn btn-primary" onClick={emptyAction.onClick}>
              {emptyAction.label}
            </button>
          ) : undefined}>
            {emptyMessage}
          </EmptyState>
        ) : (
          <div className="mod-list-rows" style={{ paddingTop: range.topPadding, paddingBottom: range.bottomPadding }}>
            {visible.map((mod) => (
              <div
                key={mod.id}
                className={`mod-row-wrap${dropTarget === mod.id ? ' is-drop-target' : ''}${
                  flashId === mod.id ? ' is-reordered' : ''
                }`}
              >
                <ModRow
                  mod={mod}
                  selected={selectedSet.has(mod.id)}
                  focused={activeFocusedId === mod.id}
                  rowHeight={rowHeight}
                  columns={columns}
                  showThumbnails={showThumbnails}
                  tagsById={tagsById}
                  conflictSummary={conflictSummaries.get(mod.id)}
                  missingDependencies={missingByMod.get(mod.id)}
                  onToggle={onToggle}
                  onSelect={handleSelect}
                  onInspect={onInspect}
                  onOpenMenu={openMenuAt}
                  onDragStart={handleDragStart}
                  onDragOverRow={setDropTarget}
                  onDropRow={handleDropRow}
                  onDragEnd={handleDragEnd}
                  registerRow={registerRow}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>

      {menu && (
        <RowContextMenu
          state={menu}
          mod={mods.find((mod) => mod.id === menu.modId)}
          onAction={runMenuAction}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

type MenuAction = 'inspect' | 'toggle' | 'up' | 'down' | 'top' | 'bottom'

function RowContextMenu({
  state,
  mod,
  onAction,
  onClose,
}: {
  state: MenuState
  mod?: ModSummary
  onAction: (action: MenuAction) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [])

  if (!mod) return null

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(index + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(index - 1 + items.length) % items.length]?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'Tab') {
      onClose()
    }
  }

  return (
    <div
      className="row-menu-popover"
      role="menu"
      aria-label={`Actions for ${mod.humanName}`}
      style={{ left: state.x, top: state.y }}
      ref={ref}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <button type="button" role="menuitem" className="menu-item" onClick={() => onAction('inspect')}>
        Inspect
        <span className="menu-shortcut">Enter</span>
      </button>
      <button type="button" role="menuitem" className="menu-item" onClick={() => onAction('toggle')}>
        {mod.isEnabled ? 'Disable' : 'Enable'}
        <span className="menu-shortcut">Space</span>
      </button>
      <div className="menu-rule" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        disabled={!mod.isEnabled}
        onClick={() => onAction('up')}
      >
        Move up
        <span className="menu-shortcut">Alt+↑</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        disabled={!mod.isEnabled}
        onClick={() => onAction('down')}
      >
        Move down
        <span className="menu-shortcut">Alt+↓</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        disabled={!mod.isEnabled}
        onClick={() => onAction('top')}
      >
        Move to top
        <span className="menu-shortcut">Alt+Home</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        disabled={!mod.isEnabled}
        onClick={() => onAction('bottom')}
      >
        Move to bottom
        <span className="menu-shortcut">Alt+End</span>
      </button>
    </div>
  )
}
