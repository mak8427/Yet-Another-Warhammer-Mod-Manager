import { useEffect, useState } from 'react'
import { ipc, toIpcError, type AppInfo, type IpcError } from './lib/ipc'

type BackendState =
  | { status: 'loading' }
  | { status: 'ready'; info: AppInfo }
  | { status: 'error'; error: IpcError }

const PLANNED_SECTIONS = ['Mods', 'Profiles', 'Conflicts', 'Workshop', 'Settings'] as const

function BackendBadge({ state }: { state: BackendState }) {
  const label =
    state.status === 'ready' ? 'IPC live' : state.status === 'error' ? 'IPC error' : 'Connecting'

  return <span className={`badge badge-${state.status}`}>{label}</span>
}

function BackendPanel({ state }: { state: BackendState }) {
  return (
    <section className="panel" aria-labelledby="backend-title">
      <div className="panel-heading">
        <h3 id="backend-title">Rust core</h3>
        <BackendBadge state={state} />
      </div>

      {state.status === 'loading' && <p className="muted">Contacting the backend…</p>}

      {state.status === 'error' && (
        <div className="error-card" role="alert">
          <strong>{state.error.code}</strong>
          <span>{state.error.message}</span>
          {state.error.details && <code>{state.error.details}</code>}
        </div>
      )}

      {state.status === 'ready' && (
        <dl className="stat-grid">
          <div>
            <dt>Shell</dt>
            <dd>
              {state.info.name} <span className="muted">{state.info.version}</span>
            </dd>
          </div>
          <div>
            <dt>Core</dt>
            <dd>
              wh3mm-core <span className="muted">{state.info.coreVersion}</span>
            </dd>
          </div>
          <div>
            <dt>Host</dt>
            <dd>
              {state.info.platform} <span className="muted">/ {state.info.arch}</span>
            </dd>
          </div>
          <div>
            <dt>Contract</dt>
            <dd>
              app_info <span className="muted">· camelCase</span>
            </dd>
          </div>
        </dl>
      )}
    </section>
  )
}

export function App() {
  const [backend, setBackend] = useState<BackendState>({ status: 'loading' })

  useEffect(() => {
    let active = true

    ipc
      .appInfo()
      .then((info) => {
        if (active) setBackend({ status: 'ready', info })
      })
      .catch((cause: unknown) => {
        if (!active) return
        setBackend({ status: 'error', error: toIpcError(cause) })
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="app-shell">
      <header className="title-bar">
        <div className="brand">
          <span className="brand-sigil" aria-hidden="true">
            III
          </span>
          <div className="brand-text">
            <span className="brand-kicker">Total War</span>
            <h1>
              Warhammer III <span>Mod Manager</span>
            </h1>
          </div>
        </div>
        <div className="title-bar-status">
          <span className={`status-dot status-dot-${backend.status}`} aria-hidden="true" />
          M0 · Bootstrap
        </div>
      </header>

      <div className="workspace">
        <nav className="section-rail" aria-label="Sections">
          <span className="rail-group">Army</span>
          <span className="rail-item rail-item-active" aria-current="page">
            Load order
          </span>
          {PLANNED_SECTIONS.map((section) => (
            <span
              key={section}
              className="rail-item rail-item-planned"
              aria-disabled="true"
              title="Planned for a later milestone"
            >
              {section}
            </span>
          ))}
        </nav>

        <main className="main-pane">
          <div className="pane-heading">
            <div>
              <p className="eyebrow">Campaign</p>
              <h2>Load order</h2>
            </div>
            <span className="count">0 mods</span>
          </div>

          <section className="panel panel-hero" aria-labelledby="m0-title">
            <h3 id="m0-title">The mustering ground is being prepared</h3>
            <p>
              Mod discovery, enablement, and load-order editing arrive in M2. M0 proves the
              shell, the typed IPC contract, and the build gates.
            </p>
            <ol className="milestone-list">
              <li>
                <span className="milestone-marker" aria-hidden="true" />
                Rust workspace: <code>wh3mm-core</code> + <code>wh3mm-app</code>
              </li>
              <li>
                <span className="milestone-marker" aria-hidden="true" />
                Typed IPC round trip: <code>app_info</code>
              </li>
              <li>
                <span className="milestone-marker" aria-hidden="true" />
                Linux CI: fmt, clippy, test, typecheck, lint, build
              </li>
            </ol>
          </section>

          <BackendPanel state={backend} />
        </main>
      </div>

      <footer className="status-bar">
        <span>WH3 Mod Manager · v0.1.0</span>
        <span>Rust owns filesystem, Steam, and pack logic.</span>
      </footer>
    </div>
  )
}
