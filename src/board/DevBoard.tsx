import { useEffect, useState } from 'react'
import type { Action } from '../actions'
import { createDomMeasurer, warmMeasureFonts } from '../layout/measure-dom'
import { paginate } from '../layout/engine'
import type { Page, Viewport } from '../layout/types'
import type { Beat } from '../pipeline/beats'
import { createBoardPipeline } from '../pipeline/board-pipeline'
import type { BeatTiming } from '../player/durations'
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

const fakeTiming = (n: number): BeatTiming => ({
  actionDelays: Array.from({ length: n }, (_, i) => i * 600),
  actionDurations: Array.from({ length: n }, () => 600),
  total: n * 600,
})

/** Replays segment 1 beat by beat with fake timing (600 ms per action); click an element to select it. */
function Replay({ d }: { d: Loaded }) {
  const [k, setK] = useState(0)
  const [token, setToken] = useState(1)
  const [paused, setPaused] = useState(false)
  const [sel, setSel] = useState<string>()
  const [said, setSaid] = useState('')
  const beat = d.beats[k]!
  const pages = d.pages.wide
  const pageIndex = Math.max(0, pages.findIndex((p) => p.beatIds.includes(beat.id)))
  const visible = new Set(d.beats.slice(0, k + 1).map((b) => b.id))
  const btn = { padding: '6px 12px', marginRight: 8 } as const
  return (
    <div style={{ width: 1000, padding: 12 }} data-testid="dev-replay">
      <div style={{ marginBottom: 8 }}>
        <button style={btn} onClick={() => { setK(Math.min(k + 1, d.beats.length - 1)); setToken((t) => t + 1) }}>Next beat</button>
        <button style={btn} onClick={() => setToken((t) => t + 1)}>Replay beat</button>
        <button style={btn} onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause'}</button>
        <button style={btn} onClick={() => { setK(0); setToken((t) => t + 1); setSel(undefined) }}>Reset</button>
        <span>beat {k + 1}/{d.beats.length}, page {pageIndex + 1}: {beat.say} {said}</span>
      </div>
      <div style={{ border: '1px solid #8886' }}>
        <Board
          pages={pages} pageIndex={pageIndex} visibleBeats={visible} speed={1} index={d.index} viewport="wide"
          animating={{ beatId: beat.id, timing: fakeTiming(beat.actions.length) }} playToken={token} paused={paused}
          selected={sel} onSelect={setSel} onAskAbout={(id) => setSaid(`ask about ${id}`)} onReport={(id) => setSaid(`report ${id}`)}
        />
      </div>
    </div>
  )
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
    <>
    <Replay d={d} />
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', padding: 12, flexWrap: 'wrap' }}>
      {view('wide', 1000)}
      {view('narrow', 360)}
    </div>
    </>
  )
}
