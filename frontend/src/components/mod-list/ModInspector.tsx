import { useState } from 'react'
import {
  fileUrl,
  type ConflictReport,
  type ModSummary,
  type Tag,
} from '../../lib/ipc'
import { formatBytes, formatDate } from '../../lib/format'
import { factionSlotForColor, modPositionLabel } from '../../lib/ui'
import type { MoveTarget } from '../../store'

interface ModInspectorProps {
  selectedMods: ModSummary[]
  tags: Tag[]
  showThumbnails: boolean
  busy: boolean
  open: boolean
  report: ConflictReport | null
  missingByMod: Map<string, string[]>
  knownPacks: Set<string>
  onToggleTag: (modId: string, tagId: string) => void
  onCreateTag: (name: string, color: string, modId: string) => void
  onToggleEnabled: (mod: ModSummary) => void
  onSetSelected: (enabled: boolean) => void
  onMove: (target: MoveTarget) => void
  onClose: () => void
}

const DEFAULT_TAG_COLOR = '#c9a24d'

export function ModInspector({
  selectedMods,
  tags,
  showThumbnails,
  busy,
  open,
  report,
  missingByMod,
  knownPacks,
  onToggleTag,
  onCreateTag,
  onToggleEnabled,
  onSetSelected,
  onMove,
  onClose,
}: ModInspectorProps) {
  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState(DEFAULT_TAG_COLOR)

  if (selectedMods.length === 0) {
    return (
      <aside className={`inspector${open ? ' is-open' : ''}`} aria-label="Inspector" data-region="inspector">
        <header className="inspector-header">
          <span className="label">Inspector</span>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close inspector">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="inspector-body">
          <p className="inspector-empty">Select a mod to inspect.</p>
        </div>
      </aside>
    )
  }

  if (selectedMods.length > 1) {
    const enabled = selectedMods.filter((mod) => mod.isEnabled).length
    return (
      <aside className={`inspector${open ? ' is-open' : ''}`} aria-label="Inspector" data-region="inspector">
        <header className="inspector-header">
          <span className="label">Inspector</span>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close inspector">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="inspector-body">
          <h3 className="inspector-title">{selectedMods.length} mods selected</h3>
          <p className="inspector-meta">
            {enabled} enabled · {selectedMods.length - enabled} disabled
          </p>
          <div className="inspector-bulk">
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => onSetSelected(true)}>
              Enable
            </button>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => onSetSelected(false)}>
              Disable
            </button>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => onMove('top')}>
              Move to top
            </button>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => onMove('bottom')}>
              Move to bottom
            </button>
          </div>
          <section className="inspector-section">
            <h4>Selection</h4>
            <ul className="inspector-list">
              {selectedMods.map((mod) => (
                <li key={mod.id} className="inspector-selection-item">
                  <span className="truncate" title={mod.humanName}>
                    {mod.humanName}
                  </span>
                  <span className="inspector-selection-state">{mod.isEnabled ? 'On' : 'Off'}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    )
  }

  const mod = selectedMods[0]
  const wins = report?.conflicts.filter((conflict) => conflict.winnerModId === mod.id) ?? []
  const loses =
    report?.conflicts.filter((conflict) => conflict.loserModIds.includes(mod.id)) ?? []
  const missing = missingByMod.get(mod.id) ?? []
  const disabledDeps = report?.disabledDependencies.filter((entry) => entry.modId === mod.id) ?? []
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]))
  const modTags = mod.tags.map((id) => tagsById.get(id)).filter((tag): tag is Tag => Boolean(tag))

  return (
    <aside className={`inspector${open ? ' is-open' : ''}`} aria-label="Inspector" data-region="inspector">
      <header className="inspector-header">
        <span className="label">Inspector</span>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close inspector">
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="inspector-body">
        <h3 className="inspector-title" title={mod.humanName}>
          {mod.humanName}
        </h3>
        <p className="inspector-meta">
          {mod.isWorkshop ? `Workshop ${mod.workshopId ?? ''}` : 'Local pack'} ·{' '}
          {mod.isEnabled ? modPositionLabel(mod) : 'Disabled'}
        </p>

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
          <span className={`state-chip ${mod.isEnabled ? 'state-on' : 'state-off'}`}>
            <span aria-hidden="true">{mod.isEnabled ? '✓' : '○'}</span>
            {mod.isEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        {mod.packError && (
          <div className="inspector-warning" role="alert">
            <strong>Pack header error</strong>
            <code>{mod.packError}</code>
          </div>
        )}

        <section className="inspector-section" aria-labelledby="inspector-pack">
          <h4 id="inspector-pack">Pack</h4>
          <dl className="inspector-facts">
            <div>
              <dt>File</dt>
              <dd title={mod.name}>{mod.name}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd className="mono">{formatBytes(mod.sizeBytes)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(mod.updatedAt)}</dd>
            </div>
          </dl>
        </section>

        <section className="inspector-section" aria-labelledby="inspector-tags">
          <h4 id="inspector-tags">Tags</h4>
          {modTags.length > 0 && (
            <div className="inspector-tag-row">
              {modTags.map((tag) => (
                <span key={tag.id} className="tag-chip" data-faction={factionSlotForColor(tag.color)}>
                  {tag.name}
                </span>
              ))}
            </div>
          )}
          {tags.length === 0 ? (
            <p className="inspector-note">Create a tag to group and filter mods.</p>
          ) : (
            <div className="tag-checklist">
              {tags.map((tag) => (
                <label key={tag.id} className="tag-check" data-faction={factionSlotForColor(tag.color)}>
                  <input
                    type="checkbox"
                    checked={mod.tags.includes(tag.id)}
                    disabled={busy}
                    onChange={() => onToggleTag(mod.id, tag.id)}
                  />
                  <span className="tag-accent" aria-hidden="true" />
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
            <p className="inspector-note">No dependency packs declared.</p>
          ) : (
            <ul className="inspector-list">
              {mod.dependencies.map((dependency) => {
                const isMissing = missing.some(
                  (name) => name.toLowerCase() === dependency.toLowerCase(),
                )
                const isDisabled = disabledDeps.some(
                  (entry) => entry.dependency.toLowerCase() === dependency.toLowerCase(),
                )
                const present = !isMissing && knownPacks.has(dependency.toLowerCase())
                return (
                  <li key={dependency} className="inspector-dependency">
                    <span
                      className={`state-shape ${
                        isMissing ? 'state-triangle' : isDisabled ? 'state-circle' : 'state-check'
                      }`}
                      aria-hidden="true"
                    >
                      {isMissing ? '▲' : isDisabled ? '○' : present ? '✓' : '·'}
                    </span>
                    <span className="truncate mono" title={dependency}>
                      {dependency}
                    </span>
                    <span className="inspector-dependency-state">
                      {isMissing ? 'Missing' : isDisabled ? 'Disabled' : present ? 'Present' : 'Unresolved'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="inspector-section" aria-labelledby="inspector-conflicts">
          <h4 id="inspector-conflicts">Conflicts</h4>
          <p className="inspector-note">
            {wins.length === 0 && loses.length === 0
              ? 'No shared file paths.'
              : `Wins ${wins.length} path${wins.length === 1 ? '' : 's'}, loses ${loses.length} path${
                  loses.length === 1 ? '' : 's'
                }.`}
          </p>
          {wins.length > 0 && (
            <ul className="inspector-list">
              {wins.slice(0, 8).map((conflict) => (
                <li key={`win-${conflict.path}`} className="mono truncate" title={conflict.path}>
                  <span className="state-diamond" aria-hidden="true" /> {conflict.path}
                </li>
              ))}
              {wins.length > 8 && <li className="inspector-note">and {wins.length - 8} more</li>}
            </ul>
          )}
          {missing.length > 0 && (
            <p className="inspector-warning-text">
              <span aria-hidden="true">▲</span> Missing:{' '}
              <span className="mono">{missing.join(', ')}</span>
            </p>
          )}
        </section>
      </div>
    </aside>
  )
}
