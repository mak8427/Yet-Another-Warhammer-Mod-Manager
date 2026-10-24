import { useEffect, useRef, useState } from 'react'
import { GameSetup } from './components/game/GameSetup'
import { LaunchDialog } from './components/launch/LaunchDialog'
import { LoadOrderDialog } from './components/load-order/LoadOrderDialog'
import { MissingModsDialog } from './components/profiles/MissingModsDialog'
import { FatalScreen } from './components/shell/FatalScreen'
import { LoadingScreen } from './components/shell/LoadingScreen'
import { NoticeBanner } from './components/shell/NoticeBanner'
import { StatusBar } from './components/shell/StatusBar'
import { TitleBar } from './components/shell/TitleBar'
import { Workspace } from './components/shell/Workspace'
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
  const missingImport = state.importOutcome?.status === 'missingMods' ? state.importOutcome : null

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
        <LoadingScreen
          view={state.view}
          busy={state.busy}
          onSelect={(view) => store.setView(view)}
        />
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

      {fatal && <FatalScreen error={fatal} onRetry={() => void store.retry()} />}

      {state.status === 'ready' && <Workspace state={state} />}

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

      {missingImport && (
        <MissingModsDialog
          outcome={missingImport}
          onClose={() => store.dismissImportOutcome()}
          onOpenWorkshop={(id) => store.openWorkshopPage(id)}
        />
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
