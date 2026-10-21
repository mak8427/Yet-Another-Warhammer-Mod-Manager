import type { Density, ModListSnapshot, ProfilesState, Tag } from '../../lib/ipc'
import type { MoveTarget } from '../../store'

interface ModToolbarProps {
  snapshot: ModListSnapshot
  profiles: ProfilesState
  tags: Tag[]
  density: Density
  showAuthors: boolean
  showThumbnails: boolean
  query: string
  activeTagIds: string[]
  selectedCount: number
  busy: boolean
  onQuery: (query: string) => void
  onTag: (tagId: string) => void
  onClearTags: () => void
  onApplyProfile: (profileId: string) => void
  onNewProfile: () => void
  onRenameProfile: () => void
  onDuplicateProfile: () => void
  onDeleteProfile: () => void
  onSetSelected: (enabled: boolean) => void
  onMove: (target: MoveTarget) => void
  onDensity: (density: Density) => void
  onShowAuthors: (value: boolean) => void
  onShowThumbnails: (value: boolean) => void
  onWriteLoadOrder: () => void
}

export function ModToolbar({
  snapshot,
  profiles,
  tags,
  density,
  showAuthors,
  showThumbnails,
  query,
  activeTagIds,
  selectedCount,
  busy,
  onQuery,
  onTag,
  onClearTags,
  onApplyProfile,
  onNewProfile,
  onRenameProfile,
  onDuplicateProfile,
  onDeleteProfile,
  onSetSelected,
  onMove,
  onDensity,
  onShowAuthors,
  onShowThumbnails,
  onWriteLoadOrder,
}: ModToolbarProps) {
  const activeProfile = profiles.profiles.find((profile) => profile.id === profiles.activeProfileId)
  const canDeleteProfile = profiles.profiles.length > 1

  return (
    <div className="toolbar" aria-label="Mod list toolbar">
      <div className="toolbar-row">
        <input
          type="search"
          className="search-input"
          placeholder="Search names, packs, authors…"
          aria-label="Search mods"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        <span className="toolbar-count">
          <strong>{snapshot.enabledCount}</strong>/{snapshot.mods.length} enabled
        </span>
        <div className="profile-control">
          <label htmlFor="active-profile">Profile</label>
          <select
            id="active-profile"
            aria-label="Active profile"
            value={profiles.activeProfileId}
            disabled={busy}
            onChange={(event) => onApplyProfile(event.target.value)}
          >
            {profiles.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-small" onClick={onNewProfile} disabled={busy}>
            New
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={onRenameProfile}
            disabled={busy || !activeProfile}
          >
            Rename
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={onDuplicateProfile}
            disabled={busy || !activeProfile}
          >
            Copy
          </button>
          <button
            type="button"
            className="btn btn-small btn-danger-ghost"
            onClick={onDeleteProfile}
            disabled={busy || !canDeleteProfile}
            title={canDeleteProfile ? 'Delete the active profile' : 'The last profile cannot be deleted'}
          >
            Delete
          </button>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onWriteLoadOrder}
          disabled={busy}
        >
          Write load order
        </button>
      </div>

      <div className="toolbar-row toolbar-row-secondary">
        <div className="bulk-actions" aria-label="Selection actions">
          <span className="toolbar-label">Selection</span>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy || selectedCount === 0}
            onClick={() => onSetSelected(true)}
          >
            Enable
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy || selectedCount === 0}
            onClick={() => onSetSelected(false)}
          >
            Disable
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy || selectedCount === 0}
            onClick={() => onMove('top')}
          >
            Top
          </button>
          <button
            type="button"
            className="btn btn-small btn-icon"
            title="Move up (Alt+ArrowUp)"
            aria-label="Move selected up"
            disabled={busy || selectedCount === 0}
            onClick={() => onMove('up')}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-small btn-icon"
            title="Move down (Alt+ArrowDown)"
            aria-label="Move selected down"
            disabled={busy || selectedCount === 0}
            onClick={() => onMove('down')}
          >
            ↓
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy || selectedCount === 0}
            onClick={() => onMove('bottom')}
          >
            Bottom
          </button>
          <span className="selection-count">
            {selectedCount > 0 ? `${selectedCount} selected` : 'none selected'}
          </span>
        </div>

        <div className="tag-filters" aria-label="Tag filters">
          <span className="toolbar-label">Tags</span>
          {tags.length === 0 && <span className="muted">No tags yet</span>}
          {tags.map((tag) => {
            const active = activeTagIds.includes(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                className={`filter-chip ${active ? 'filter-chip-active' : ''}`}
                aria-pressed={active}
                onClick={() => onTag(tag.id)}
              >
                <span className="tag-dot" style={{ background: tag.color }} />
                {tag.name}
              </button>
            )
          })}
          {activeTagIds.length > 0 && (
            <button type="button" className="btn btn-ghost btn-small" onClick={onClearTags}>
              Clear
            </button>
          )}
        </div>

        <div className="display-controls">
          <label className="check-control">
            <input
              type="checkbox"
              checked={density === 'compact'}
              onChange={(event) => onDensity(event.target.checked ? 'compact' : 'comfortable')}
            />
            Compact
          </label>
          <label className="check-control">
            <input
              type="checkbox"
              checked={showAuthors}
              onChange={(event) => onShowAuthors(event.target.checked)}
            />
            Authors
          </label>
          <label className="check-control">
            <input
              type="checkbox"
              checked={showThumbnails}
              onChange={(event) => onShowThumbnails(event.target.checked)}
            />
            Thumbnails
          </label>
        </div>
      </div>
    </div>
  )
}
