import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { cpus, platform, arch } from 'node:os'
import { expect, it } from 'vitest'
import { ModList } from './ModList'
import { makeMod } from '../../test/mocks'

it('measures synchronous drag-marker updates with 500 mods', () => {
  const samples: number[] = []
  const nameReads: number[] = []
  const noop = () => {}
  for (let sample = -3; sample < 12; sample += 1) {
    let reads = 0
    const mods = Array.from({ length: 500 }, (_, index) => makeMod({
      id: `mod-${index}`,
      name: `mod_${String(index).padStart(3, '0')}.pack`,
      isEnabled: index < 20,
      loadOrder: index,
    }))
    Object.defineProperty(mods[0], 'humanName', { get: () => {
      reads += 1
      return 'Tracked mod'
    } })
    render(<ModList
      mods={mods} tags={[]} selection={[]} sort="load-order" density="compact"
      showThumbnails initialScrollTop={0} conflictSummaries={new Map()}
      missingByMod={new Map()} emptyTitle="No mods" emptyMessage=""
      viewportHeightOverride={320}
      onToggle={noop} onSelect={noop} onSelectAll={noop} onClearSelection={noop}
      onInspect={noop} onMove={noop} onSort={noop} onReorder={noop} onScrollTop={noop}
    />)
    const rows = screen.getAllByRole('option')
    reads = 0
    const started = performance.now()
    for (let event = 0; event < 40; event += 1) {
      fireEvent.dragOver(rows[1 + event % 18], { dataTransfer: { dropEffect: 'move' } })
    }
    const elapsed = (performance.now() - started) / 40
    if (sample >= 0) {
      samples.push(elapsed)
      nameReads.push(reads)
    }
    cleanup()
  }
  const sorted = samples.slice().sort((left, right) => left - right)
  console.log(JSON.stringify({
    environment: { node: process.version, os: platform(), arch: arch(), cpu: cpus()[0]?.model },
    mods: 500, warmups: 3, runs: samples.length, eventsPerRun: 40,
    medianMsPerEvent: (sorted[5] + sorted[6]) / 2,
    iqrMsPerEvent: (sorted[8] + sorted[9] - sorted[2] - sorted[3]) / 2,
    samplesMsPerEvent: samples,
    trackedRowNameReadsPerRun: nameReads,
  }))
  expect(samples).toHaveLength(12)
}, 30_000)
