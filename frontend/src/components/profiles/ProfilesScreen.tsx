import { useState } from 'react'
import type { Profile, ProfilesState } from '../../lib/ipc'
import { formatDate } from '../../lib/format'
import { Modal } from '../common/Modal'
import { ProfileDialog, type ProfileDialogMode } from './ProfileDialog'

interface ProfilesScreenProps {
  profiles: ProfilesState
  busy: boolean
  onApply: (profileId: string) => void
  onSave: (name: string, profileId?: string) => Promise<boolean>
  onDuplicate: (profileId: string, name: string) => Promise<boolean>
  onDelete: (profileId: string) => Promise<boolean>
}

interface DialogState {
  mode: ProfileDialogMode
  profile?: Profile
}

export function ProfilesScreen({ profiles, busy, onApply, onSave, onDuplicate, onDelete }: ProfilesScreenProps) {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null)

  const activeProfile = profiles.profiles.find((profile) => profile.id === profiles.activeProfileId)

  return (
    <div className="profiles-screen">
      <div className="pane-heading">
        <div>
          <p className="eyebrow">Campaign stores</p>
          <h2>Profiles</h2>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setDialog({ mode: 'create' })} disabled={busy}>
          New profile
        </button>
      </div>

      <p className="muted profiles-intro">
        A profile stores the enabled set and its order. Switching profiles never writes{' '}
        <code>used_mods.txt</code>; the write button on the load-order screen does that after a
        preview.
      </p>

      <div className="profile-list" role="list">
        {profiles.profiles.map((profile) => {
          const active = profile.id === profiles.activeProfileId
          return (
            <div key={profile.id} className={`profile-row ${active ? 'profile-row-active' : ''}`} role="listitem">
              <div className="profile-main">
                <div className="profile-name-line">
                  <h3>{profile.name}</h3>
                  {active && <span className="row-badge">ACTIVE</span>}
                </div>
                <span className="muted">
                  {profile.enabledModIds.length} enabled · updated {formatDate(profile.updatedAt)}
                </span>
              </div>
              <div className="profile-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy || active}
                  onClick={() => onApply(profile.id)}
                >
                  {active ? 'Active' : 'Activate'}
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => setDialog({ mode: 'rename', profile })}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => setDialog({ mode: 'duplicate', profile })}
                >
                  Copy
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-danger-ghost"
                  disabled={busy || profiles.profiles.length <= 1}
                  onClick={() => setDeleteTarget(profile)}
                >
                  Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {activeProfile && (
        <div className="profile-summary">
          <span className="eyebrow">Current</span>
          <strong>{activeProfile.name}</strong>
          <span className="muted">
            {activeProfile.enabledModIds.length} mods in load order. Toggle and reorder them on the
            Load order screen; the active profile saves those changes.
          </span>
        </div>
      )}

      {dialog && (
        <ProfileDialog
          mode={dialog.mode}
          initialName={dialog.mode === 'rename' ? (dialog.profile?.name ?? '') : dialog.mode === 'duplicate' ? `${dialog.profile?.name ?? 'Profile'} copy` : ''}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(name) => {
            if (dialog.mode === 'create') return onSave(name)
            if (dialog.mode === 'rename' && dialog.profile) return onSave(name, dialog.profile.id)
            if (dialog.mode === 'duplicate' && dialog.profile) return onDuplicate(dialog.profile.id, name)
            return Promise.resolve(false)
          }}
        />
      )}

      {deleteTarget && (
        <Modal
          title="Delete profile"
          subtitle="The mods themselves are not touched."
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={async () => {
                  if (await onDelete(deleteTarget.id)) setDeleteTarget(null)
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
    </div>
  )
}
