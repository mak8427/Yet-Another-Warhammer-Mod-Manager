import { useState } from 'react'
import { Modal } from '../common/Modal'

export type ProfileDialogMode = 'create' | 'rename' | 'duplicate'

interface ProfileDialogProps {
  mode: ProfileDialogMode
  initialName: string
  busy: boolean
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}

const TITLES: Record<ProfileDialogMode, string> = {
  create: 'New profile',
  rename: 'Rename profile',
  duplicate: 'Duplicate profile',
}

export function ProfileDialog({ mode, initialName, busy, onClose, onSubmit }: ProfileDialogProps) {
  const [name, setName] = useState(initialName)
  const trimmed = name.trim()

  return (
    <Modal
      title={TITLES[mode]}
      subtitle={
        mode === 'create'
          ? 'The new profile starts with the current enabled set and order.'
          : mode === 'rename'
            ? 'Names are unique and case-insensitive.'
            : 'The copy keeps the same enabled set and order.'
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || trimmed.length === 0}
            onClick={async () => {
              if (await onSubmit(trimmed)) onClose()
            }}
          >
            {mode === 'create' ? 'Create' : mode === 'rename' ? 'Rename' : 'Duplicate'}
          </button>
        </>
      }
    >
      <label className="field-label" htmlFor="profile-name">
        Profile name
      </label>
      <input
        id="profile-name"
        value={name}
        maxLength={80}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && trimmed) {
            event.preventDefault()
            void onSubmit(trimmed).then((ok) => {
              if (ok) onClose()
            })
          }
        }}
      />
    </Modal>
  )
}
