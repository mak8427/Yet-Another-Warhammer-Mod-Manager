import { useState } from 'react'
import { store, useAppStore } from '../../store'
import { DENSITIES, DENSITY_LABEL } from '../../lib/ui'
import type { Density } from '../../lib/ipc'
import { Modal } from '../common/Modal'
import { ErrorBanner } from '../shell/ErrorBanner'

export function SettingsScreen() {
  const state = useAppStore()
  const [draftPath, setDraftPath] = useState(state.game?.gamePath ?? '')
  const [resetOpen, setResetOpen] = useState(false)
  const savedPath = state.game?.gamePath ?? ''
  const pathDirty = draftPath.trim() !== savedPath

  const save = async () => {
    if (!pathDirty) return
    const path = draftPath.trim()
    if (!path) {
      store.setError({
        code: 'validation',
        message: 'Game folder cannot be empty',
        details: 'Choose the folder that contains data and Warhammer3.exe.',
        retryable: false,
      })
      return
    }
    await store.setGamePath(path)
  }

  return (
    <section className="settings-screen" aria-labelledby="settings-heading">
      <div className="screen-bar">
        <div className="screen-title">
          <h2 id="settings-heading" tabIndex={-1}>
            Settings
          </h2>
          {pathDirty && <span className="screen-count">Unsaved changes</span>}
        </div>
        <div className="screen-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={!pathDirty || Boolean(state.busy)}
            title={pathDirty ? 'Save the game folder and reload the list' : 'No path changes to save'}
          >
            Save settings
          </button>
        </div>
      </div>

      {state.error && (
        <ErrorBanner
          error={state.error}
          onDismiss={() => store.dismissError()}
          onRetry={() => void save()}
        />
      )}

      <div className="settings-column">
        <section className="settings-section" aria-labelledby="settings-game">
          <h3 id="settings-game">Game</h3>
          <div className="setting-row">
            <div className="setting-label">
              <label htmlFor="settings-path">Game folder</label>
              <p>The folder that contains <code>data</code> and <code>Warhammer3.exe</code>.</p>
            </div>
            <div className="setting-control">
              <input
                id="settings-path"
                spellCheck={false}
                value={draftPath}
                onChange={(event) => setDraftPath(event.target.value)}
                aria-invalid={!draftPath.trim() && pathDirty}
              />
            </div>
          </div>
          {state.game && (
            <>
              <PathRow label="Data" value={state.game.dataPath} />
              <PathRow label="Workshop" value={state.game.workshopPath} />
              <PathRow label="Steam" value={state.game.steamRoot} />
              {state.game.protonPrefix && <PathRow label="Proton prefix" value={state.game.protonPrefix} />}
              <PathRow label="Source" value={state.game.source === 'auto' ? 'Detected automatically' : 'Set manually'} />
            </>
          )}
        </section>

        <section className="settings-section" aria-labelledby="settings-list">
          <h3 id="settings-list">List and appearance</h3>
          <div className="setting-row">
            <div className="setting-label">
              <label htmlFor="settings-density">Density</label>
              <p>Applies immediately and is saved for the next start.</p>
            </div>
            <div className="setting-control">
              <select
                id="settings-density"
                value={state.ui.density}
                onChange={(event) => store.setDensity(event.target.value as Density)}
              >
                {DENSITIES.map((value) => (
                  <option key={value} value={value}>
                    {DENSITY_LABEL[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="setting-row setting-row-check">
            <span className="setting-label">
              <span>Show authors</span>
              <p>The author column at 1440px and wider; the meta line otherwise.</p>
            </span>
            <span className="setting-control">
              <input
                type="checkbox"
                checked={state.ui.showAuthors}
                onChange={(event) => store.setShowAuthors(event.target.checked)}
              />
            </span>
          </label>
          <label className="setting-row setting-row-check">
            <span className="setting-label">
              <span>Show thumbnails</span>
              <p>Read pack thumbnails where one exists; otherwise show initials.</p>
            </span>
            <span className="setting-control">
              <input
                type="checkbox"
                checked={state.ui.showThumbnails}
                onChange={(event) => store.setShowThumbnails(event.target.checked)}
              />
            </span>
          </label>
        </section>

        <section className="settings-section" aria-labelledby="settings-safety">
          <h3 id="settings-safety">Load-order safety</h3>
          <div className="setting-row">
            <div className="setting-label">
              <span>Backup and restore</span>
              <p>
                Writes keep one <code>.bak</code>. Restore only when the current file is unreadable
                or corrupt.
              </p>
              {state.snapshot && (
                <p className="mono setting-path" title={state.snapshot.loadOrder.path}>
                  {state.snapshot.loadOrder.path}
                </p>
              )}
            </div>
            <div className="setting-control">
              <button
                type="button"
                className="btn"
                disabled={Boolean(state.busy) || !state.snapshot?.loadOrder.backupAvailable}
                title={
                  state.snapshot?.loadOrder.backupAvailable
                    ? 'Restore used_mods.txt.bak'
                    : 'No backup is available'
                }
                onClick={() => void store.restoreLoadOrder()}
              >
                Restore backup
              </button>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-label">
              <span>Reset to defaults</span>
              <p>Returns density and column visibility to defaults. Mods, profiles, and paths are untouched.</p>
            </div>
            <div className="setting-control">
              <button type="button" className="btn btn-danger-ghost" onClick={() => setResetOpen(true)}>
                Reset to defaults
              </button>
            </div>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="settings-about">
          <h3 id="settings-about">About</h3>
          <dl className="inspector-facts">
            <div>
              <dt>Version</dt>
              <dd className="mono">{state.appInfo?.version ?? '0.1.0'}</dd>
            </div>
            <div>
              <dt>Core</dt>
              <dd className="mono">{state.appInfo?.coreVersion ?? '—'}</dd>
            </div>
            <div>
              <dt>Platform</dt>
              <dd className="mono">
                {state.appInfo ? `${state.appInfo.platform} · ${state.appInfo.arch}` : '—'}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {resetOpen && (
        <Modal
          title="Reset to defaults"
          width="sm"
          onClose={() => setResetOpen(false)}
          footer={
            <>
              <button type="button" className="btn" data-autofocus onClick={() => setResetOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  void store.resetUiPreferences()
                  setResetOpen(false)
                }}
              >
                Reset settings
              </button>
            </>
          }
        >
          <p>
            Reset density, author, and thumbnail visibility to defaults. Mods, profiles, and paths
            are not touched.
          </p>
        </Modal>
      )}
    </section>
  )
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <span>{label}</span>
      </div>
      <div className="setting-control">
        <input readOnly value={value} title={value} aria-label={label} />
      </div>
    </div>
  )
}
