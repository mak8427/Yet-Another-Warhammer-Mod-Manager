import { useState } from 'react'
import { fileUrl, type ModSummary, type Tag } from '../../lib/ipc'
import { formatBytes, formatDate } from '../../lib/format'

interface ModInspectorProps {
  selectedMods: ModSummary[]
  tags: Tag[]
  showThumbnails: boolean
  busy: boolean
  onToggleTag: (modId: string, tagId: string) => void
  onCreateTag: (name: string, color: string, modId: string) => void
  onToggleEnabled: (mod: ModSummary) => void
}

const DEFAULT_TAG_COLOR = '#c9a227'

export function ModInspector({
  selectedMods,
  tags,
  showThumbnails,
  busy,
  onToggleTag,
  onCreateTag,
  onToggleEnabled,
}: ModInspectorProps) {
  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState(DEFAULT_TAG_COLOR)

  if (selectedMods.length === 0) {
    return (
      <aside className="inspector" aria-label="Mod details">
        <div className="inspector-empty">
          <p className="eyebrow">Inspector</p>
          <h3>Select a mod</h3>
          <p className="muted">
            The inspector shows the pack header, dependencies, and tags. Click a row, then use
            Space to toggle it and Alt+Arrow to move it.
          </p>
          <dl className="stat-grid stat-grid-compact">
            <div>
              <dt>Tags</dt>
              <dd>{tags.length}</dd>
            </div>
          </dl>
        </div>
      </aside>
    )
  }

  if (selectedMods.length > 1) {
    const enabled = selectedMods.filter((mod) => mod.isEnabled).length
    return (
      <aside className="inspector" aria-label="Mod details">
        <div className="inspector-heading">
          <p className="eyebrow">Inspector</p>
          <h3>{selectedMods.length} mods selected</h3>
        </div>
        <dl className="stat-grid stat-grid-compact">
          <div>
            <dt>Enabled</dt>
            <dd>
              {enabled}/{selectedMods.length}
            </dd>
          </div>
          <div>
            <dt>Workshop</dt>
            <dd>{selectedMods.filter((mod) => mod.isWorkshop).length}</dd>
          </div>
        </dl>
        <ul className="plain-list compact-list">
          {selectedMods.slice(0, 12).map((mod) => (
            <li key={mod.id}>{mod.humanName}</li>
          ))}
          {selectedMods.length > 12 && <li className="muted">and {selectedMods.length - 12} more</li>}
        </ul>
        <p className="muted">Use the toolbar to enable, disable, or move the whole selection.</p>
      </aside>
    )
  }

  const mod = selectedMods[0]
  return (
    <aside className="inspector" aria-label="Mod details">
      <div className="inspector-heading">
        <p className="eyebrow">Inspector</p>
        <h3>{mod.humanName}</h3>
        <span className="muted mono">{mod.name}</span>
      </div>

      {showThumbnails && mod.thumbnailPath && (
        <img className="inspector-thumb" src={fileUrl(mod.thumbnailPath)} alt="" />
      )}

      <div className="inspector-actions">
        <button
          type="button"
          className={`btn ${mod.isEnabled ? '' : 'btn-primary'}`}
          disabled={busy}
          onClick={() => onToggleEnabled(mod)}
        >
          {mod.isEnabled ? 'Disable mod' : 'Enable mod'}
        </button>
        <span className="muted">{mod.isEnabled ? `Load position ${mod.loadOrder + 1}` : 'Not in load order'}</span>
      </div>

      {mod.packError && (
        <div className="inspector-warning" role="alert">
          <strong>Pack header error</strong>
          <code>{mod.packError}</code>
        </div>
      )}

      <dl className="stat-grid stat-grid-compact">
        <div>
          <dt>Source</dt>
          <dd>{mod.isWorkshop ? `Workshop ${mod.workshopId ?? ''}` : 'Local pack'}</dd>
        </div>
        <div>
          <dt>Author</dt>
          <dd>{mod.author ?? '—'}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(mod.sizeBytes)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatDate(mod.updatedAt)}</dd>
        </div>
      </dl>

      <section className="inspector-section" aria-labelledby="inspector-tags">
        <h4 id="inspector-tags">Tags</h4>
        {tags.length === 0 ? (
          <p className="muted">Create a tag below to group and filter mods.</p>
        ) : (
          <div className="tag-checklist">
            {tags.map((tag) => (
              <label key={tag.id} className="tag-check">
                <input
                  type="checkbox"
                  checked={mod.tags.includes(tag.id)}
                  disabled={busy}
                  onChange={() => onToggleTag(mod.id, tag.id)}
                />
                <span className="tag-dot" style={{ background: tag.color }} />
                {tag.name}
              </label>
            ))}
          </div>
        )}
        <form
          className="tag-create"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = tagName.trim()
            if (!trimmed) return
            onCreateTag(trimmed, tagColor.toUpperCase(), mod.id)
            setTagName('')
          }}
        >
          <input
            aria-label="New tag name"
            placeholder="New tag"
            value={tagName}
            onChange={(event) => setTagName(event.target.value)}
          />
          <input
            type="color"
            aria-label="New tag color"
            value={tagColor}
            onChange={(event) => setTagColor(event.target.value)}
          />
          <button type="submit" className="btn btn-small" disabled={busy || !tagName.trim()}>
            Add
          </button>
        </form>
      </section>

      <section className="inspector-section" aria-labelledby="inspector-deps">
        <h4 id="inspector-deps">Dependencies</h4>
        {mod.dependencies.length === 0 ? (
          <p className="muted">No dependency packs declared.</p>
        ) : (
          <ul className="plain-list compact-list">
            {mod.dependencies.map((dependency) => (
              <li key={dependency} className="mono">
                {dependency}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}
