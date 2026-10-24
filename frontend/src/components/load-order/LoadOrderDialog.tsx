import { useState } from 'react'
import { Modal } from '../common/Modal'
import type { LoadOrderWriteReport } from '../../lib/ipc'

interface LoadOrderDialogProps {
  preview: LoadOrderWriteReport | null
  busy: boolean
  onClose: () => void
  onWrite: (allowEmpty: boolean, confirmUnmanagedLoss: boolean) => void
}

export function LoadOrderDialog({ preview, busy, onClose, onWrite }: LoadOrderDialogProps) {
  const [allowEmpty, setAllowEmpty] = useState(false)
  const [confirmUnmanaged, setConfirmUnmanaged] = useState(false)

  if (!preview) {
    return (
      <Modal title="Load order write" onClose={onClose}>
        <p className="muted">Reading used_mods.txt and resolving the enabled set…</p>
      </Modal>
    )
  }

  const needsEmpty = preview.requiresEmptyConfirmation
  const needsUnmanaged = preview.requiresUnmanagedConfirmation
  const blocked = preview.hardBlocked
  const ready =
    !blocked &&
    !busy &&
    (!needsEmpty || allowEmpty) &&
    (!needsUnmanaged || confirmUnmanaged)

  return (
    <Modal
      title="Write used_mods.txt"
      subtitle="Nothing is written until you confirm."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" data-autofocus onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${needsEmpty || needsUnmanaged ? 'btn-danger' : 'btn-primary'}`}
            disabled={!ready}
            onClick={() => onWrite(allowEmpty, confirmUnmanaged)}
          >
            Write {preview.resultingModCount} mod{preview.resultingModCount === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <dl className="stat-grid">
        <div>
          <dt>Target</dt>
          <dd className="mono break-all">{preview.path}</dd>
        </div>
        <div>
          <dt>Will write</dt>
          <dd>
            {preview.written} mod{preview.written === 1 ? '' : 's'}
          </dd>
        </div>
        <div>
          <dt>Current file</dt>
          <dd>
            {preview.existingModCount} mod{preview.existingModCount === 1 ? '' : 's'}
          </dd>
        </div>
        <div>
          <dt>Backup</dt>
          <dd className="mono break-all">{preview.backupPath ?? 'No previous file'}</dd>
        </div>
      </dl>

      {preview.skipped.length > 0 && (
        <section className="dialog-section" aria-labelledby="dialog-skipped">
          <h4 id="dialog-skipped">Not resolvable ({preview.skipped.length})</h4>
          <p className="muted">These enabled ids have no discovered pack and will be skipped.</p>
          <ul className="plain-list compact-list">
            {preview.skipped.map((name) => (
              <li key={name} className="mono">
                {name}
              </li>
            ))}
          </ul>
        </section>
      )}

      {preview.unmanagedDirectives.length > 0 && (
        <section className="dialog-section" aria-labelledby="dialog-unmanaged">
          <h4 id="dialog-unmanaged">Unmanaged directives</h4>
          <p className="muted">
            The legacy writer does not re-emit these. They will be removed from the new file.
          </p>
          <ul className="plain-list compact-list">
            {preview.unmanagedDirectives.map((directive) => (
              <li key={directive} className="mono">
                {directive}
              </li>
            ))}
          </ul>
        </section>
      )}

      {needsEmpty && (
        <label className="check-control check-control-warning">
          <input
            type="checkbox"
            checked={allowEmpty}
            onChange={(event) => setAllowEmpty(event.target.checked)}
          />
          Write an empty load order (disable all mods on disk)
        </label>
      )}

      {needsUnmanaged && (
        <label className="check-control check-control-warning">
          <input
            type="checkbox"
            checked={confirmUnmanaged}
            onChange={(event) => setConfirmUnmanaged(event.target.checked)}
          />
          Remove the unmanaged directives listed above
        </label>
      )}

      {blocked && (
        <div className="inspector-warning" role="alert">
          <strong>Write blocked</strong>
          <span>{preview.blockedReason ?? 'This write cannot be completed safely.'}</span>
        </div>
      )}

      {!blocked && preview.blockedReason && (
        <p className="muted">{preview.blockedReason}</p>
      )}
    </Modal>
  )
}
