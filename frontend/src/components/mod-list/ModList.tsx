import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { ConflictModSummary, ModSummary, Tag, WorkshopState } from '../../lib/ipc'
import { virtualRange } from '../../lib/virtual'
import { ModRow } from './ModRow'
import { gridColumns } from './grid'
import type { MoveTarget, SelectMode } from '../../store'

interface ModListProps {
  mods: ModSummary[]
  tags: Tag[]
  conflictSummaries?: Map<string, ConflictModSummary>
  workshopStates?: Map<string, WorkshopState>
  selection: string[]
  density: 'comfortable' | 'compact'
  showAuthors: boolean
  showThumbnails: boolean
  initialScrollTop: number
  viewportHeightOverride?: number
  onToggle: (modId: string) => void
  onSelect: (modId: string, mode: SelectMode) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onMove: (target: MoveTarget) => void
  onReorder: (draggedIds: string[], targetId: string | null) => void
  onScrollTop: (top: number) => void
}

const OVERSCAN = 6

export function ModList({
  mods,
  tags,
  conflictSummaries = new Map(),
  workshopStates = new Map(),
  selection,
  density,
  showAuthors,
  showThumbnails,
  initialScrollTop,
  viewportHeightOverride,
  onToggle,
  onSelect,
  onSelectAll,
  onClearSelection,
  onMove,
  onReorder,
  onScrollTop,
}: ModListProps) {
  const rowHeight = density === 'compact' ? 30 : 40
  const containerRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const didInitScroll = useRef(false)
  const [scrollTop, setScrollTop] = useState(Math.max(0, initialScrollTop))
  const [measuredHeight, setMeasuredHeight] = useState(520)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [draggedIds, setDraggedIds] = useState<string[]>([])
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const viewportHeight = viewportHeightOverride ?? measuredHeight
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags])
  const selectedSet = useMemo(() => new Set(selection), [selection])
  const maxScrollTop = Math.max(0, mods.length * rowHeight - viewportHeight)
  const effectiveScrollTop = Math.min(scrollTop, maxScrollTop)
  const range = virtualRange(mods.length, rowHeight, viewportHeight, effectiveScrollTop, OVERSCAN)
  const visible = mods.slice(range.start, range.end)
  const columns = gridColumns(showAuthors, showThumbnails)

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

  useEffect(() => {
    if (didInitScroll.current) return
    const element = containerRef.current
    if (element) {
      element.scrollTop = Math.min(initialScrollTop, maxScrollTop)
      didInitScroll.current = true
    }
  }, [initialScrollTop, maxScrollTop])

  useEffect(() => {
    if (!focusedId) return
    rowRefs.current.get(focusedId)?.focus({ preventScroll: true })
  }, [focusedId, range.start, range.end])

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

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return
    const index = focusedId ? mods.findIndex((mod) => mod.id === focusedId) : -1
    if (event.key === 'ArrowDown' && !event.altKey) {
      event.preventDefault()
      focusIndex(index < 0 ? 0 : index + 1)
      return
    }
    if (event.key === 'ArrowUp' && !event.altKey) {
      event.preventDefault()
      focusIndex(index < 0 ? mods.length - 1 : index - 1)
      return
    }
    if (event.key === 'Home' && !event.altKey) {
      event.preventDefault()
      focusIndex(0)
      return
    }
    if (event.key === 'End' && !event.altKey) {
      event.preventDefault()
      focusIndex(mods.length - 1)
      return
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (focusedId) {
        onSelect(focusedId, 'toggle')
        onToggle(focusedId)
      } else if (mods[0]) {
        focusIndex(0)
        onSelect(mods[0].id, 'single')
      }
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      onSelectAll()
      return
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      onMove(event.key === 'ArrowUp' ? 'up' : 'down')
      return
    }
    if (event.altKey && event.key === 'Home') {
      event.preventDefault()
      onMove('top')
      return
    }
    if (event.altKey && event.key === 'End') {
      event.preventDefault()
      onMove('bottom')
      return
    }
    if (event.key === 'Escape') {
      onClearSelection()
      setFocusedId(null)
    }
  }

  return (
    <div className="mod-list-wrap">
      <div
        className="mod-list-header"
        role="presentation"
        style={{ gridTemplateColumns: columns }}
      >
        <span />
        <span />
        {showThumbnails ? <span /> : null}
        <span>Pack</span>
        {showAuthors ? <span>Author</span> : null}
        <span>Tags</span>
        <span className="align-right">Size</span>
        <span>Updated</span>
      </div>
      <div
        className="mod-list-scroll"
        ref={containerRef}
        role="listbox"
        aria-label="Mods"
        aria-multiselectable="true"
        tabIndex={focusedId ? -1 : 0}
        onFocus={() => {
          if (!focusedId && mods[0]) setFocusedId(mods[0].id)
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
          if (draggedIds.length > 0) onReorder(draggedIds, null)
          setDraggedIds([])
          setDropTarget(null)
        }}
      >
        {mods.length === 0 ? (
          <div className="empty-state">
            <strong>No mods match this filter</strong>
            <span>Clear the search or tag filter to see the full muster roll.</span>
          </div>
        ) : (
          <div style={{ paddingTop: range.topPadding, paddingBottom: range.bottomPadding }}>
            {visible.map((mod) => (
              <div
                key={mod.id}
                className={dropTarget === mod.id ? 'drop-target' : undefined}
                onDragOver={() => setDropTarget(mod.id)}
              >
                <ModRow
                  mod={mod}
                  selected={selectedSet.has(mod.id)}
                  focused={focusedId === mod.id}
                  rowHeight={rowHeight}
                  showAuthors={showAuthors}
                  showThumbnails={showThumbnails}
                  tagsById={tagsById}
                  conflictSummary={conflictSummaries.get(mod.id)}
                  workshopState={
                    mod.workshopId ? workshopStates.get(mod.workshopId) : undefined
                  }
                  onToggle={onToggle}
                  onSelect={handleSelect}
                  onDragStart={(modId) => {
                    const ids =
                      selectedSet.has(modId) && selection.length > 0
                        ? selection.filter((id) => mods.find((item) => item.id === id)?.isEnabled)
                        : [modId]
                    setDraggedIds(ids.length > 0 ? ids : [modId])
                  }}
                  onDragOverRow={setDropTarget}
                  onDropRow={(targetId) => {
                    if (draggedIds.length > 0) onReorder(draggedIds, targetId)
                    setDraggedIds([])
                    setDropTarget(null)
                  }}
                  onDragEnd={() => {
                    setDraggedIds([])
                    setDropTarget(null)
                  }}
                  registerRow={registerRow}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
