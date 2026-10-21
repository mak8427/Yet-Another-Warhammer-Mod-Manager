import { useEffect, useMemo, useState } from 'react'
import { ErrorBanner } from './components/shell/ErrorBanner'
import { NoticeBanner } from './components/shell/NoticeBanner'
import { SectionRail } from './components/shell/SectionRail'
import { StatusBar } from './components/shell/StatusBar'
import { TitleBar } from './components/shell/TitleBar'
import { GameSetup } from './components/game/GameSetup'
import { LoadOrderBanner } from './components/load-order/LoadOrderBanner'
import { LoadOrderDialog } from './components/load-order/LoadOrderDialog'
import { ModInspector } from './components/mod-list/ModInspector'
import { ModList } from './components/mod-list/ModList'
import { ModToolbar } from './components/mod-list/ModToolbar'
import { Modal } from './components/common/Modal'
import { ProfileDialog, type ProfileDialogMode } from './components/profiles/ProfileDialog'
import { ProfilesScreen } from './components/profiles/ProfilesScreen'
import {
  activeProfileName,
  store,
  useAppStore,
  visibleMods,
  type MoveTarget,
} from './store'

export function App() {
  const state = useAppStore()
  const [profileDialog, setProfileDialog] = useState<ProfileDialogMode | null>(null)
  const [deleteProfileOpen, setDeleteProfileOpen] = useState(false)

  useEffect(() => {
    void store.init()
  }, [])

  const visible = useMemo(() => visibleMods(state), [state])
  const selectedMods = useMemo(() => {
    const selected = new Set(state.selection)
    return (state.snapshot?.mods ?? []).filter((mod) => selected.has(mod.id))
  }, [state.selection, state.snapshot])

  const activeProfile = state.profiles?.profiles.find(
    (profile) => profile.id === state.profiles?.activeProfileId,
  )

  const setSelected = (enabled: boolean) => {
    void store.setModsEnabled(state.selection, enabled)
  }

  const move = (target: MoveTarget) => {
    void store.moveSelection(target)
  }

  return (
    <div className="app-shell">
      <TitleBar appInfo={state.appInfo} game={state.game} status={state.status} />

      {state.status === 'loading' && (
        <main className="main-pane loading-pane" aria-busy="true">
          <div className="pane-heading">
            <div>
              <p className="eyebrow">Muster</p>
              <h2>Reading the mod roll</h2>
            </div>
            <span className="muted">{state.busy ?? 'Starting'}…</span>
          </div>
          <div className="skeleton-list" aria-hidden="true">
            {Array.from({ length: 12 }, (_, index) => (
              <div key={index} className="skeleton-row" />
            ))}
          </div>
        </main>
      )}

      {state.status === 'no-game' && (
        <GameSetup
          error={state.error}
          busy={state.busy}
          onSubmit={(path) => void store.setGamePath(path)}
          onDetect={() => void store.setGamePath(null)}
        />
      )}

      {state.status === 'error' && (
        <main className="main-pane">
          <div className="pane-heading">
            <div>
              <p className="eyebrow">Fault</p>
              <h2>The muster roll could not be read</h2>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => void store.retry()}>
              Retry
            </button>
          </div>
          {state.error && (
            <ErrorBanner error={state.error} onDismiss={() => store.dismissError()} />
          )}
          <section className="panel">
            <h3>What now</h3>
            <p className="muted">
              Retry after closing the other game tool. If the error mentions a corrupt config,
              keep <code>config.json</code> and <code>config.json.bak</code> next to the app data
              folder; the manager will not overwrite either file.
            </p>
          </section>
        </main>
      )}

      {state.status === 'ready' && state.snapshot && state.profiles && (
        <div className="workspace">
          <SectionRail
            view={state.view}
            modCount={state.snapshot.mods.length}
            enabledCount={state.snapshot.enabledCount}
            profileCount={state.profiles.profiles.length}
            onSelect={(view) => store.setView(view)}
          />

          <main className="main-pane">
            {state.error && <ErrorBanner error={state.error} onDismiss={() => store.dismissError()} />}
            {state.notice && <NoticeBanner notice={state.notice} onDismiss={() => store.dismissNotice()} />}

            {state.view === 'mods' ? (
              <>
                <div className="pane-heading pane-heading-tight">
                  <div>
                    <p className="eyebrow">Army list</p>
                    <h2>Load order</h2>
                  </div>
                  <span className="pane-meta">
                    Top loads first · bottom wins conflicts
                    {state.busy && <span className="busy-text"> · {state.busy}…</span>}
                  </span>
                </div>

                {state.snapshot.warnings.length > 0 && (
                  <div className="banner banner-warning" role="status">
                    <div className="banner-body">
                      {state.snapshot.warnings.map((warning, index) => (
                        <span key={`${index}-${warning}`}>{warning}</span>
                      ))}
                    </div>
                  </div>
                )}

                <LoadOrderBanner
                  loadOrder={state.snapshot.loadOrder}
                  busy={Boolean(state.busy)}
                  onRestore={() => void store.restoreLoadOrder()}
                  onOpenWrite={() => void store.openLoadOrderDialog()}
                />

                <ModToolbar
                  snapshot={state.snapshot}
                  profiles={state.profiles}
                  tags={state.tags}
                  density={state.ui.density}
                  showAuthors={state.ui.showAuthors}
                  showThumbnails={state.ui.showThumbnails}
                  query={state.query}
                  activeTagIds={state.activeTagIds}
                  selectedCount={state.selection.length}
                  busy={Boolean(state.busy)}
                  onQuery={(query) => store.setQuery(query)}
                  onTag={(tagId) => store.toggleTagFilter(tagId)}
                  onClearTags={() => store.clearTagFilters()}
                  onApplyProfile={(id) => void store.applyProfile(id)}
                  onNewProfile={() => setProfileDialog('create')}
                  onRenameProfile={() => setProfileDialog('rename')}
                  onDuplicateProfile={() => setProfileDialog('duplicate')}
                  onDeleteProfile={() => setDeleteProfileOpen(true)}
                  onSetSelected={setSelected}
                  onMove={move}
                  onDensity={(density) => store.setDensity(density)}
                  onShowAuthors={(value) => store.setShowAuthors(value)}
                  onShowThumbnails={(value) => store.setShowThumbnails(value)}
                  onWriteLoadOrder={() => void store.openLoadOrderDialog()}
                />

                <div className="mod-workspace">
                  <ModList
                    key={`${state.query}|${state.activeTagIds.join(',')}`}
                    mods={visible}
                    tags={state.tags}
                    selection={state.selection}
                    density={state.ui.density}
                    showAuthors={state.ui.showAuthors}
                    showThumbnails={state.ui.showThumbnails}
                    initialScrollTop={state.ui.lastScrollTop}
                    onToggle={(id) => void store.toggleMod(id)}
                    onSelect={(id, mode) => store.select(id, mode)}
                    onSelectAll={() => store.selectAllVisible()}
                    onClearSelection={() => store.clearSelection()}
                    onMove={move}
                    onReorder={(dragged, target) => void store.reorder(dragged, target)}
                    onScrollTop={(top) => store.noteScroll(top)}
                  />
                  <ModInspector
                    selectedMods={selectedMods}
                    tags={state.tags}
                    showThumbnails={state.ui.showThumbnails}
                    busy={Boolean(state.busy)}
                    onToggleTag={(modId, tagId) => void store.toggleModTag(modId, tagId)}
                    onCreateTag={(name, color, modId) => void store.createTag(name, color, modId)}
                    onToggleEnabled={(mod) => void store.toggleMod(mod.id)}
                  />
                </div>
              </>
            ) : (
              <ProfilesScreen
                profiles={state.profiles}
                busy={Boolean(state.busy)}
                onApply={(id) => void store.applyProfile(id)}
                onCreate={(name) => store.saveProfile(name)}
                onRename={(id, name) => store.renameProfile(id, name)}
                onDuplicate={(id, name) => store.duplicateProfile(id, name)}
                onDelete={(id) => store.deleteProfile(id)}
              />
            )}
          </main>
        </div>
      )}

      <StatusBar
        appInfo={state.appInfo}
        game={state.game}
        snapshot={state.snapshot}
        profileName={activeProfileName(state)}
      />

      {profileDialog && activeProfile && state.snapshot && (
        <ProfileDialog
          mode={profileDialog}
          initialName={
            profileDialog === 'rename'
              ? activeProfile.name
              : profileDialog === 'duplicate'
                ? `${activeProfile.name} copy`
                : ''
          }
          busy={Boolean(state.busy)}
          onClose={() => setProfileDialog(null)}
          onSubmit={(name) => {
            if (profileDialog === 'create') return store.saveProfile(name)
            if (profileDialog === 'rename') return store.renameProfile(activeProfile.id, name)
            return store.duplicateProfile(activeProfile.id, name)
          }}
        />
      )}

      {profileDialog && !activeProfile && (
        <ProfileDialog
          mode={profileDialog}
          initialName=""
          busy={Boolean(state.busy)}
          onClose={() => setProfileDialog(null)}
          onSubmit={(name) => store.saveProfile(name)}
        />
      )}

      {deleteProfileOpen && activeProfile && (
        <Modal
          title="Delete profile"
          subtitle="The mods themselves are not touched."
          onClose={() => setDeleteProfileOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDeleteProfileOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={Boolean(state.busy) || (state.profiles?.profiles.length ?? 1) <= 1}
                onClick={async () => {
                  if (await store.deleteProfile(activeProfile.id)) setDeleteProfileOpen(false)
                }}
              >
                Delete profile
              </button>
            </>
          }
        >
          <p>
            Delete <strong>{activeProfile.name}</strong>? This removes only the saved enabled set and
            order.
          </p>
        </Modal>
      )}

      {state.previewOpen && (
        <LoadOrderDialog
          preview={state.preview}
          busy={Boolean(state.busy)}
          onClose={() => store.closeLoadOrderDialog()}
          onWrite={(allowEmpty, confirm) => void store.writeLoadOrder(allowEmpty, confirm)}
        />
      )}
    </div>
  )
}
