import { useMemo } from 'react'
import { store, useAppStore, visibleMods } from '../../store'
import { LoadOrderBanner } from '../load-order/LoadOrderBanner'
import { ModInspector } from './ModInspector'
import { ModList } from './ModList'
import { ModToolbar } from './ModToolbar'

export function ModsScreen() {
  const state = useAppStore()
  const snapshot = state.snapshot

  const visible = useMemo(() => visibleMods(state), [state])
  const selectedMods = useMemo(() => {
    const selected = new Set(state.selection)
    return (snapshot?.mods ?? []).filter((mod) => selected.has(mod.id))
  }, [state.selection, snapshot])

  const conflictSummaries = useMemo(
    () => new Map((state.conflicts?.modSummaries ?? []).map((summary) => [summary.modId, summary])),
    [state.conflicts],
  )

  const missingByMod = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const entry of state.conflicts?.missingDependencies ?? []) map.set(entry.modId, entry.missing)
    return map
  }, [state.conflicts])

  const knownPacks = useMemo(() => {
    const names = new Set<string>()
    for (const mod of snapshot?.mods ?? []) {
      names.add(mod.name.toLowerCase())
      names.add(mod.humanName.toLowerCase())
    }
    return names
  }, [snapshot])

  if (!snapshot) return null

  const filtered = state.query.trim().length > 0 || state.activeTagIds.length > 0
  const emptyTitle = filtered ? 'No mods match this filter' : 'No mods found'
  const emptyMessage = filtered
    ? 'Clear the search or tag filter to see the full list.'
    : 'Set the game path or rescan to look again.'
  const emptyAction = filtered
    ? { label: 'Clear filters', onClick: () => store.clearFilters() }
    : { label: 'Set game path', onClick: () => store.setView('settings') }

  return (
    <div className="mods-screen">
      {snapshot.warnings.length > 0 && (
        <div className="banner banner-warning" role="status">
          <span className="state-icon state-icon-warning" aria-hidden="true">
            ▲
          </span>
          <div className="banner-body">
            {snapshot.warnings.map((warning, index) => (
              <span key={`${index}-${warning}`}>{warning}</span>
            ))}
          </div>
        </div>
      )}

      <LoadOrderBanner
        loadOrder={snapshot.loadOrder}
        busy={Boolean(state.busy)}
        onRestore={() => void store.restoreLoadOrder()}
        onOpenWrite={() => void store.openLoadOrderDialog()}
      />

      <ModToolbar
        tags={state.tags}
        density={state.ui.density}
        showAuthors={state.ui.showAuthors}
        showThumbnails={state.ui.showThumbnails}
        query={state.query}
        activeTagIds={state.activeTagIds}
        sort={state.sort}
        modCount={snapshot.mods.length}
        busy={Boolean(state.busy)}
        onQuery={(query) => store.setQuery(query)}
        onTag={(tagId) => store.toggleTagFilter(tagId)}
        onClearFilters={() => store.clearFilters()}
        onDensity={(density) => store.setDensity(density)}
        onShowAuthors={(value) => store.setShowAuthors(value)}
        onShowThumbnails={(value) => store.setShowThumbnails(value)}
        onSort={(sort) => store.setSort(sort)}
        onWriteLoadOrder={() => void store.openLoadOrderDialog()}
      />

      <div className="mod-workspace">
        <ModList
          mods={visible}
          tags={state.tags}
          selection={state.selection}
          sort={state.sort}
          density={state.ui.density}
          showAuthors={state.ui.showAuthors}
          showThumbnails={state.ui.showThumbnails}
          initialScrollTop={state.ui.lastScrollTop}
          conflictSummaries={conflictSummaries}
          missingByMod={missingByMod}
          emptyTitle={emptyTitle}
          emptyMessage={emptyMessage}
          emptyAction={emptyAction}
          onToggle={(id) => void store.toggleMod(id)}
          onSelect={(id, mode) => store.select(id, mode)}
          onSelectAll={() => store.selectAllVisible()}
          onClearSelection={() => store.clearSelection()}
          onInspect={(id) => {
            store.select(id, 'single')
            store.openInspector()
          }}
          onMove={(target) => void store.moveSelection(target)}
          onSort={(sort) => store.setSort(sort)}
          onReorder={(dragged, target) => store.reorder(dragged, target)}
          onScrollTop={(top) => store.noteScroll(top)}
        />
        <ModInspector
          selectedMods={selectedMods}
          tags={state.tags}
          showThumbnails={state.ui.showThumbnails}
          busy={Boolean(state.busy)}
          open={state.inspectorOpen}
          report={state.conflicts}
          missingByMod={missingByMod}
          knownPacks={knownPacks}
          onToggleTag={(modId, tagId) => void store.toggleModTag(modId, tagId)}
          onCreateTag={(name, color, modId) => void store.createTag(name, color, modId)}
          onToggleEnabled={(mod) => void store.toggleMod(mod.id)}
          onSetSelected={(enabled) => void store.setModsEnabled(state.selection, enabled)}
          onMove={(target) => void store.moveSelection(target)}
          onClose={() => store.closeInspector()}
        />
      </div>
    </div>
  )
}
