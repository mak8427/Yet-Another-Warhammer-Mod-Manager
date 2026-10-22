import { useEffect, useRef, useState } from 'react'
import { ErrorBanner } from './components/shell/ErrorBanner'
import { NoticeBanner } from './components/shell/NoticeBanner'
import { SectionRail } from './components/shell/SectionRail'
import { StatusBar } from './components/shell/StatusBar'
import { TitleBar } from './components/shell/TitleBar'
import { GameSetup } from './components/game/GameSetup'
import { LoadOrderDialog } from './components/load-order/LoadOrderDialog'
import { LaunchDialog } from './components/launch/LaunchDialog'
import { ModsScreen } from './components/mod-list/ModsScreen'
import { ProfilesScreen } from './components/profiles/ProfilesScreen'
import { ConflictScreen } from './components/conflicts/ConflictScreen'
import { WorkshopScreen } from './components/workshop/WorkshopScreen'
import { SettingsScreen } from './components/settings/SettingsScreen'
import { store, useAppStore } from './store'

const SECTION_KEYS: Record<string, 'mods' | 'profiles' | 'conflicts' | 'workshop' | 'settings'> = {
  '1': 'mods',
  '2': 'profiles',
  '3': 'conflicts',
  '4': 'workshop',
  '5': 'settings',
}

const FOCUS_REGIONS = ['rail', 'toolbar', 'list', 'inspector']

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"], [tabindex="-1"]'

function hasBox(element: HTMLElement): boolean {
  if (element.hasAttribute('inert') || element.closest('[inert]')) return false
  if (element.closest('[aria-hidden="true"]')) return false
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  const checkVisibility = (
    element as HTMLElement & {
      checkVisibility?: (options?: { visibilityProperty?: boolean }) => boolean
    }
  ).checkVisibility
  return typeof checkVisibility === 'function'
    ? checkVisibility.call(element, { visibilityProperty: true })
    : true
}

function regionIsVisible(element: HTMLElement, overlayInspector: boolean): boolean {
  if (
    overlayInspector &&
    element.matches('[data-region="inspector"]') &&
    !element.classList.contains('is-open')
  ) {
    return false
  }
  return hasBox(element)
}

function firstFocusable(region: HTMLElement): HTMLElement | null {
  for (const candidate of Array.from(region.querySelectorAll<HTMLElement>(FOCUSABLE))) {
    if (hasBox(candidate)) return candidate
  }
  return null
}

function focusRegion(direction: 1 | -1): void {
  const overlayInspector =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 1279px)').matches
  const regions = FOCUS_REGIONS.flatMap((name) =>
    Array.from(document.querySelectorAll<HTMLElement>(`[data-region="${name}"]`)),
  ).filter((element) => regionIsVisible(element, overlayInspector))
  if (regions.length === 0) return
  const active = document.activeElement as HTMLElement | null
  const current = active?.closest<HTMLElement>('[data-region]')
  const index = current ? regions.indexOf(current) : -1
  for (let step = 1; step <= regions.length; step += 1) {
    const next = regions[(((index + direction * step) % regions.length) + regions.length) % regions.length]
    const target = firstFocusable(next)
    if (target) {
      target.focus()
      return
    }
  }
}

export function App() {
  const state = useAppStore()
  const [searchFocusRequest, setSearchFocusRequest] = useState(0)
  const handledSearchFocus = useRef(0)
  const lastZoomWheel = useRef(0)

  useEffect(() => {
    void store.init()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.density = state.ui.density
  }, [state.ui.density])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement

      if ((event.ctrlKey || event.metaKey) && SECTION_KEYS[event.key]) {
        event.preventDefault()
        store.setView(SECTION_KEYS[event.key])
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        store.setView('mods')
        setSearchFocusRequest((request) => request + 1)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault()
        store.setView('settings')
        return
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.key === '+' || event.key === '=') {
          event.preventDefault()
          store.zoomIn()
          return
        }
        if (event.key === '-' || event.key === '_') {
          event.preventDefault()
          store.zoomOut()
          return
        }
        if (event.key === '0') {
          event.preventDefault()
          store.resetZoom()
          return
        }
      }
      if (event.key === 'F6') {
        event.preventDefault()
        focusRegion(event.shiftKey ? -1 : 1)
        return
      }
      if (typing) return
      if (event.key === 'F5') {
        event.preventDefault()
        void store.rescan()
        return
      }
      if (event.key === 'Escape' && state.inspectorOpen) {
        store.closeInspector()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state.inspectorOpen])

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return
      event.preventDefault()
      const now = Date.now()
      if (now - lastZoomWheel.current < 120) return
      lastZoomWheel.current = now
      if (event.deltaY < 0) store.zoomIn()
      else store.zoomOut()
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    if (state.status !== 'ready') return
    const title =
      document.querySelector<HTMLElement>('[data-screen-title]') ??
      document.querySelector<HTMLElement>('.screen-title h2')
    title?.focus()
  }, [state.view, state.status])

  useEffect(() => {
    if (searchFocusRequest === 0 || searchFocusRequest === handledSearchFocus.current) return
    if (state.view !== 'mods') return
    handledSearchFocus.current = searchFocusRequest
    const search = document.getElementById('mod-search') as HTMLInputElement | null
    search?.focus()
    search?.select()
  }, [searchFocusRequest, state.view])

  const fatal = state.status === 'error' ? state.error : null

  return (
    <div className="app-shell" data-view={state.view}>
      <TitleBar
        appInfo={state.appInfo}
        game={state.game}
        status={state.status}
        profiles={state.profiles}
        busy={Boolean(state.busy)}
        onApplyProfile={(id) => void store.applyProfile(id)}
        onOpenSettings={() => store.setView('settings')}
        onOpenLaunch={() => store.openLaunch()}
      />

      {state.status === 'loading' && (
        <div className="workspace">
          <SectionRail
            view={state.view}
            modCount={0}
            enabledCount={0}
            profileCount={0}
            conflictCount={0}
            workshopCount={0}
            loading
            onSelect={(view) => store.setView(view)}
          />
          <main className="main-pane" aria-busy="true" data-region="main">
            <div className="screen-bar">
              <div className="screen-title">
                <h2 className="skeleton-title">Mods</h2>
              </div>
            </div>
            <div className="mod-list-header loading-header" aria-hidden="true" />
            <div className="loading-list" aria-hidden="true">
              {Array.from({ length: 12 }, (_, index) => (
                <div key={index} className="loading-row" />
              ))}
            </div>
            <p className="sr-only">{state.busy ?? 'Starting'}…</p>
          </main>
        </div>
      )}

      {state.status === 'no-game' && (
        <GameSetup
          error={state.error}
          busy={state.busy}
          platform={state.appInfo?.platform}
          onSubmit={(path) => void store.setGamePath(path)}
          onDetect={() => void store.setGamePath(null)}
        />
      )}

      {fatal && (
        <main className="main-pane fatal-screen" aria-labelledby="fatal-title">
          <div className="fatal-column">
            <h2 id="fatal-title" tabIndex={-1}>
              The mod list could not be read
            </h2>
            <p>
              {fatal.code === 'config_corrupt'
                ? 'The manager will not overwrite a corrupt config. A readable backup is restored automatically; retry after closing other game tools.'
                : 'Retry after closing other game tools. If the problem persists, the error code and details identify the failing step.'}
            </p>
            <div className="fatal-error" role="alert">
              <span className="state-icon state-icon-danger" aria-hidden="true">
                !
              </span>
              <div>
                <strong>{fatal.message}</strong>
                <span className="banner-code">{fatal.code}</span>
                {fatal.details && (
                  <details className="banner-disclosure">
                    <summary>Details</summary>
                    <code>{fatal.details}</code>
                  </details>
                )}
              </div>
            </div>
            <div className="fatal-actions">
              <button type="button" className="btn btn-primary" onClick={() => void store.retry()}>
                Retry
              </button>
            </div>
          </div>
        </main>
      )}

      {state.status === 'ready' && state.snapshot && state.profiles && (
        <div className="workspace">
          <SectionRail
            view={state.view}
            modCount={state.snapshot.mods.length}
            enabledCount={state.snapshot.enabledCount}
            profileCount={state.profiles.profiles.length}
            conflictCount={state.conflicts?.conflicts.length ?? 0}
            workshopCount={state.workshop?.length ?? 0}
            onSelect={(view) => store.setView(view)}
          />

          <main className="main-pane" data-region="main">
            {state.error && (
              <ErrorBanner error={state.error} onDismiss={() => store.dismissError()} />
            )}

            {state.view === 'mods' && <ModsScreen />}

            {state.view === 'profiles' && (
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

            {state.view === 'conflicts' && (
              <ConflictScreen
                report={state.conflicts}
                loading={state.conflictLoading}
                error={state.conflictError}
                onRefresh={() => void store.refreshConflicts()}
                onDismissError={() => store.dismissConflictError()}
              />
            )}

            {state.view === 'workshop' && (
              <WorkshopScreen
                items={state.workshop}
                loading={state.workshopLoading}
                busy={Boolean(state.busy)}
                error={state.workshopError}
                onRefresh={() => void store.refreshWorkshop()}
                onDismissError={() => store.dismissWorkshopError()}
                onAction={(action, workshopId) => void store.runWorkshopAction(action, workshopId)}
              />
            )}

            {state.view === 'settings' && <SettingsScreen />}
          </main>
        </div>
      )}

      <StatusBar
        status={state.status}
        appInfo={state.appInfo}
        snapshot={state.snapshot}
        busy={state.busy}
        dirty={state.dirty}
        lastWriteAt={state.lastWriteAt}
      />

      {state.notice && (
        <div className="toast-stack">
          <NoticeBanner notice={state.notice} onDismiss={() => store.dismissNotice()} />
        </div>
      )}

      <LaunchDialog />

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
