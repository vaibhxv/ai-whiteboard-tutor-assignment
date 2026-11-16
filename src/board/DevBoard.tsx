import { useEffect, useState } from 'react'
import type { Action } from '../actions'
import { createDomMeasurer, warmMeasureFonts } from '../layout/measure-dom'
import { paginate } from '../layout/engine'
import type { Page, Viewport } from '../layout/types'
import type { Beat } from '../pipeline/beats'
import { createBoardPipeline } from '../pipeline/board-pipeline'
import { Board } from './Board'

type Loaded = { index: Map<string, Action>; beats: Beat[]; pages: Record<Viewport, Page[]> }

async function load(): Promise<Loaded> {
  const fx = (await import('../../tests/fixtures/lessons/vertex.fixture.json')).default as {
    responses: { 'segment:1': { text: string } }
  }
  const index = new Map<string, Action>()
  const beats: Beat[] = []
  const p = createBoardPipeline({
    segKey: 'segment:1', mode: 'board', ink: 'lesson', index,
    onBeat: (b) => beats.push(b), onCheck: () => {}, onAsk: () => {}, onReject: () => {},
  })
  p.push(fx.responses['segment:1'].text)
  p.end('end')
  await warmMeasureFonts()
  const m = createDomMeasurer(document.body)
  const segs = [{ segKey: 'segment:1', template: 'split' as const, beats }]
  return { index, beats, pages: { wide: paginate(segs, m, 'wide'), narrow: paginate(segs, m, 'narrow') } }
}

/** Dev gallery: the fixture's segment 1, fully visible, wide and narrow side by side. */
export function DevBoard() {
  const [d, setD] = useState<Loaded>()
  useEffect(() => { void load().then(setD) }, [])
  if (!d) return <p>Loading…</p>
  const visible = new Set(d.beats.map((b) => b.id))
  const view = (vp: Viewport, width: number) => (
    <div style={{ width }} data-testid={`dev-${vp}`}>
      <h2>{vp}: {d.pages[vp].length} page(s)</h2>
      {d.pages[vp].map((_, i) => (
        <div key={i} style={{ marginBottom: 16, border: '1px solid #8886' }}>
          <Board pages={d.pages[vp]} pageIndex={i} visibleBeats={visible} speed={1} onSelect={() => {}} index={d.index} viewport={vp} />
        </div>
      ))}
    </div>
  )
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', padding: 12, flexWrap: 'wrap' }}>
      {view('wide', 1000)}
      {view('narrow', 360)}
    </div>
  )
}
