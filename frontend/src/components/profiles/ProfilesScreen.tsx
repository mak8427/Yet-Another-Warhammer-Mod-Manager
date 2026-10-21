import { useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Profile, ProfilesState } from '../../lib/ipc'
import { formatDate } from '../../lib/format'
import { EmptyState } from '../common/EmptyState'
import { Modal } from '../common/Modal'
import { ProfileDialog, type ProfileDialogMode } from './ProfileDialog'

interface ProfilesScreenProps {
  profiles: ProfilesState
  busy: boolean
  onApply: (profileId: string) => void
  onCreate: (name: string) => Promise<boolean>
  onRename: (profileId: string, name: string) => Promise<boolean>
  onDuplicate: (profileId: string, name: string) => Promise<boolean>
  onDelete: (profileId: string) => Promise<boolean>
}

interface DialogState {
  mode: ProfileDialogMode
  profile?: Profile
}

export function ProfilesScreen({
  profiles,
  busy,
  onApply,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
}: ProfilesScreenProps) {
  const [selectedId, setSelectedId] = useState<string | null>(profiles.activeProfileId)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null)
  const lastAction = useRef<(() => void) | null>(null)

  const selected = profiles.profiles.find((profile) => profile.id === selectedId) ?? null
  const exactlyOne = profiles.profiles.filter((profile) => profile.id === selectedId).length === 1
  const canDelete = exactlyOne && profiles.profiles.length > 1
  const activeProfile = profiles.profiles.find((profile) => profile.id === profiles.activeProfileId)

  const run = (action: () => void) => {
    lastAction.current = action
    action()
  }

  const handleRowKey = (event: ReactKeyboardEvent<HTMLTableRowElement>, profile: Profile) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      setSelectedId(profile.id)
      if (profile.id !== profiles.activeProfileId) run(() => onApply(profile.id))
    } else if (event.key === 'F2') {
      event.preventDefault()
      setSelectedId(profile.id)
      setDialog({ mode: 'rename', profile })
    } else if (event.key === 'Delete') {
      event.preventDefault()
      if (profiles.profiles.length <= 1) return
      setSelectedId(profile.id)
      setDeleteTarget(profile)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const index = profiles.profiles.indexOf(profile)
      const next = event.key === 'ArrowDown' ? index + 1 : index - 1
      const target = profiles.profiles[Math.max(0, Math.min(profiles.profiles.length - 1, next))]
      if (target) {
        setSelectedId(target.id)
        document.getElementById(`profile-row-${target.id}`)?.focus()
      }
    }
  }

  return (
    <section className="profiles-screen" aria-labelledby="profiles-heading">
      <div className="screen-bar">
        <div className="screen-title">
          <h2 id="profiles-heading" tabIndex={-1}>
            Profiles
          </h2>
          <span className="screen-count mono">{profiles.profiles.length} profiles</span>
        </div>
        <div className="screen-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => setDialog({ mode: 'create' })}
          >
            New profile
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy || !exactlyOne}
            title={exactlyOne ? 'Rename the selected profile' : 'Select exactly one profile'}
            onClick={() => selected && setDialog({ mode: 'rename', profile: selected })}
          >
            Rename
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy || !exactlyOne}
            title={exactlyOne ? 'Duplicate the selected profile' : 'Select exactly one profile'}
            onClick={() => selected && setDialog({ mode: 'duplicate', profile: selected })}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy || !exactlyOne}
            title={exactlyOne ? 'Apply the selected profile' : 'Select exactly one profile'}
            onClick={() => {
              if (!selected || selected.id === profiles.activeProfileId) return
              run(() => onApply(selected.id))
            }}
          >
            Apply
          </button>
          <button
            type="button"
            className="btn btn-small btn-danger-ghost"
            disabled={busy || !canDelete}
            title={canDelete ? 'Delete the selected profile' : 'Select one profile; the last profile cannot be deleted'}
            onClick={() => selected && setDeleteTarget(selected)}
          >
            Delete
          </button>
        </div>
      </div>

      {profiles.profiles.length === 0 ? (
        <EmptyState
          title="No profiles"
          action={
            <button type="button" className="btn btn-primary" onClick={() => setDialog({ mode: 'create' })}>
              New profile
            </button>
          }
        >
          Create a profile to save an enabled set and its load order.
        </EmptyState>
      ) : (
        <div className="table-wrap profile-table-wrap">
          <table className="data-table profile-table">
            <colgroup>
              <col className="col-active" />
              <col />
              <col className="col-count" />
              <col className="col-updated" />
              <col className="col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Active</th>
                <th scope="col">Name</th>
                <th scope="col" className="align-right">
                  Mods
                </th>
                <th scope="col">Updated</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {profiles.profiles.map((profile) => {
                const active = profile.id === profiles.activeProfileId
                const isSelected = profile.id === selectedId
                return (
                  <tr
                    key={profile.id}
                    id={`profile-row-${profile.id}`}
                    tabIndex={0}
                    aria-selected={isSelected}
                    className={`${isSelected ? 'is-selected' : ''}${active ? ' is-active' : ''}`}
                    onClick={() => setSelectedId(profile.id)}
                    onKeyDown={(event) => handleRowKey(event, profile)}
                  >
                    <td>
                      {active ? (
                        <span className="active-chip">
                          <span aria-hidden="true">✓</span> Active
                        </span>
                      ) : (
                        <span className="sr-only">Not active</span>
                      )}
                    </td>
                    <td className="profile-name-cell">
                      <span className="truncate" title={profile.name}>
                        {profile.name}
                      </span>
                    </td>
                    <td className="align-right mono">{profile.enabledModIds.length}</td>
                    <td className="mono">{formatDate(profile.updatedAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        disabled={busy || active}
                        onClick={(event) => {
                          event.stopPropagation()
                          run(() => onApply(profile.id))
                        }}
                      >
                        {active ? 'Active' : 'Apply'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeProfile && (
        <p className="screen-note">
          Active profile <strong>{activeProfile.name}</strong> · {activeProfile.enabledModIds.length} mods.
          Switching profiles never writes <code>used_mods.txt</code>.
        </p>
      )}

      {dialog && (
        <ProfileDialog
          mode={dialog.mode}
          initialName={
            dialog.mode === 'rename'
              ? (dialog.profile?.name ?? '')
              : dialog.mode === 'duplicate'
                ? `${dialog.profile?.name ?? 'Profile'} copy`
                : ''
          }
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(name) => {
            if (dialog.mode === 'create') return onCreate(name)
            if (dialog.mode === 'rename' && dialog.profile) return onRename(dialog.profile.id, name)
            if (dialog.mode === 'duplicate' && dialog.profile) return onDuplicate(dialog.profile.id, name)
            return Promise.resolve(false)
          }}
        />
      )}

      {deleteTarget && (
        <Modal
          title="Delete profile"
          subtitle="The mods themselves are not touched."
          width="sm"
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button type="button" className="btn" data-autofocus onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => {
                  const target = deleteTarget
                  run(() => void onDelete(target.id).then((ok) => ok && setDeleteTarget(null)))
                }}
              >
                Delete profile
              </button>
            </>
          }
        >
          <p>
            Delete <strong>{deleteTarget.name}</strong>? This removes only the saved enabled set and
            order.
          </p>
        </Modal>
      )}
    </section>
  )
}
