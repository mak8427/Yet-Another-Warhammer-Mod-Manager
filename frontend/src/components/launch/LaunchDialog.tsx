import { store, useAppStore } from '../../store'
import { Modal } from '../common/Modal'

export function LaunchDialog() {
  const state = useAppStore()
  if (!state.launchOpen) return null

  const result = state.launchResult
  return (
    <Modal
      title="Launch Warhammer III"
      width="sm"
      onClose={() => store.closeLaunch()}
      footer={
        <>
          <button type="button" className="btn" data-autofocus onClick={() => store.closeLaunch()}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={state.launchLoading || !state.game}
            onClick={() => void store.launchGame()}
          >
            {state.launchLoading ? 'Launching…' : 'Launch game'}
          </button>
        </>
      }
    >
      <p className="launch-precondition">
        <span className={state.game ? 'state-check' : 'state-triangle'} aria-hidden="true">
          {state.game ? '✓' : '▲'}
        </span>
        {state.game
          ? 'Steam must be running. The manager starts the game without the CA launcher and checks that Warhammer3.exe is not already running. The last applied load order is used.'
          : 'Set the game path before launching.'}
      </p>

      <label className="check-row">
        <input
          type="checkbox"
          checked={state.launchOptions.skipIntro}
          disabled={state.launchLoading}
          onChange={(event) => void store.setLaunchOption('skipIntro', event.target.checked)}
        />
        <span>
          <strong>Skip intro</strong>
          <small>Replaces the startup videos with a managed pack for this profile.</small>
        </span>
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={state.launchOptions.scriptLogging}
          disabled={state.launchLoading}
          onChange={(event) => void store.setLaunchOption('scriptLogging', event.target.checked)}
        />
        <span>
          <strong>Enable script logging</strong>
          <small>Writes the script logging flag before launch.</small>
        </span>
      </label>

      {result && (
        <p className="launch-result" role="status">
          <span className="state-check" aria-hidden="true">
            ✓
          </span>
          {result.message ?? 'Launch requested'} · {result.method}
        </p>
      )}

      {state.launchError && (
        <div className="banner banner-error" role="alert">
          <span className="state-icon state-icon-danger" aria-hidden="true">
            !
          </span>
          <div className="banner-body">
            <strong>{state.launchError.message}</strong>
            <span className="banner-code">{state.launchError.code}</span>
            {state.launchError.details && (
              <details className="banner-disclosure">
                <summary>Details</summary>
                <code>{state.launchError.details}</code>
              </details>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
