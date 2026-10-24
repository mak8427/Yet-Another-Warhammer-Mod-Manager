import { useState } from 'react'
import type { ImportProfileOutcome } from '../../lib/ipc'
import { Modal } from '../common/Modal'

type MissingOutcome = Extract<ImportProfileOutcome, { status: 'missingMods' }>

/** Keeps the dialog's DOM bounded for a hand-built file with thousands of rows. */
const MAX_RENDERED = 200

interface MissingModsDialogProps {
  outcome: MissingOutcome
  onClose: () => void
  onOpenWorkshop: (workshopId: string) => Promise<{ ok: boolean; message: string }>
}

/**
 * Shown when an import is blocked because mods in the file are not installed.
 * The profile is not created, so the only actions are reading the list and
 * opening the Workshop page that the file points at.
 */
export function MissingModsDialog({ outcome, onClose, onOpenWorkshop }: MissingModsDialogProps) {
  const [pending, setPending] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const rendered = outcome.missing.slice(0, MAX_RENDERED)
  const overflow = outcome.missing.length - rendered.length

  const openWorkshop = async (workshopId: string) => {
    setPending(workshopId)
    setFailure(null)
    const result = await onOpenWorkshop(workshopId)
    setPending(null)
    if (!result.ok) setFailure(result.message)
  }

  return (
    <Modal
      title={`Mods required for "${outcome.profileName}"`}
      subtitle="No profile was created. Install or subscribe to every mod below, then import the file again."
      width="lg"
      onClose={onClose}
      footer={
        <button type="button" className="btn" data-autofocus onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="screen-note">
        This profile needs {outcome.totalMods} mods and {outcome.missing.length} are not installed
        here. Importing the file again after installing them creates the profile.
      </p>

      {failure && (
        <p className="modal-alert" role="alert">
          {failure}
        </p>
      )}

      <ul className="missing-mods-list">
        {rendered.map((mod) => {
          const workshopId = mod.workshopId
          return (
            <li key={mod.pack} className="missing-mod">
              {mod.name && <span className="missing-mod-name">{mod.name}</span>}
              <code className="missing-mod-pack">{mod.pack}</code>
              {mod.url && <span className="missing-mod-url">{mod.url}</span>}
              {workshopId ? (
                <button
                  type="button"
                  className="btn btn-small missing-mod-action"
                  disabled={pending === workshopId}
                  title={mod.url ?? 'Open this mod in the Steam Workshop'}
                  onClick={() => void openWorkshop(workshopId)}
                >
                  {pending === workshopId ? 'Opening…' : 'Open Workshop page'}
                </button>
              ) : (
                <span className="missing-mod-note">
                  No download link was included with this mod; ask whoever shared the profile for
                  the pack file.
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {overflow > 0 && <p className="screen-note">…and {overflow} more mods are not listed here.</p>}
    </Modal>
  )
}
