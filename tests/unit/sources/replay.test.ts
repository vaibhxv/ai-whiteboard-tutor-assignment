import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { Clock } from '../../../src/lib/clock'
import { createReplaySource } from '../../../src/sources/replay'
import { RecordingSchema } from '../../../src/sources/recording'
import type { GenEvent, GenRequest } from '../../../src/sources/types'
import { SourceError } from '../../../src/sources/errors'

const rec = RecordingSchema.parse(JSON.parse(readFileSync('tests/fixtures/lessons/vertex.fixture.json', 'utf8')))

const flush = () => new Promise<void>((r) => setImmediate(r))

function fakeClock() {
  let t = 0
  const timers: { at: number; fn: () => void; id: number }[] = []
  let n = 0
  const clock: Clock = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++n; timers.push({ at: t + ms, fn, id }); return id },
    clearTimeout: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1) },
  }
  const advance = async (ms: number) => {
    const end = t + ms
    for (;;) {
      await flush()
      timers.sort((a, b) => a.at - b.at)
      const next = timers[0]
      if (!next || next.at > end) break
      timers.shift(); t = next.at; next.fn()
    }
    t = end
    await flush()
  }
  return { clock, advance, now: () => t }
}

const req = (intent: string): GenRequest => ({ role: 'segment', intent, system: '', user: '', maxOutputTokens: 100 })

describe('replay', () => {
  test('streams exact text; meta first; first text at t=0; done end', async () => {
    const fc = fakeClock()
    const src = createReplaySource(rec, { clock: fc.clock })
    const events: { e: GenEvent; at: number }[] = []
    const ac = new AbortController()
    const run = (async () => { for await (const e of src.generate(req('segment:1'), ac.signal)) events.push({ e, at: fc.now() }) })()
    await fc.advance(0)
    expect(events[0]?.e).toMatchObject({ type: 'meta', model: 'claude-sonnet-5-5', billedTo: 'recording' })
    expect(events[1]?.e.type).toBe('text')
    expect(events[1]!.at).toBeLessThanOrEqual(30)
    await fc.advance(10_000_000)
    await run
    const text = events.filter((x) => x.e.type === 'text').map((x) => (x.e as { text: string }).text).join('')
    expect(text).toBe(rec.responses['segment:1']!.text)
    expect(events.at(-1)?.e).toEqual({ type: 'done', stop: 'end' })
    const texts = events.filter((x) => x.e.type === 'text')
    expect(texts.every((x) => (x.e as { text: string }).text.length <= 24)).toBe(true)
    expect(texts[1]!.at - texts[0]!.at).toBe(30)
  })

  test('unknown intent throws not-recorded', async () => {
    const src = createReplaySource(rec, { intervalMs: 0 })
    let err: unknown
    try { for await (const _ of src.generate(req('segment:9'), new AbortController().signal)) void _ } catch (e) { err = e }
    expect(err).toBeInstanceOf(SourceError)
    expect((err as SourceError).kind).toBe('not-recorded')
  })

  test('abort stops further events', async () => {
    const fc = fakeClock()
    const src = createReplaySource(rec, { clock: fc.clock })
    const ac = new AbortController()
    const events: GenEvent[] = []
    const run = (async () => { for await (const e of src.generate(req('segment:1'), ac.signal)) events.push(e) })()
    await fc.advance(100)
    const n = events.length
    expect(n).toBeGreaterThan(2)
    ac.abort()
    await fc.advance(100_000)
    await run
    expect(events.length).toBe(n + 1)
    expect(events.at(-1)).toEqual({ type: 'done', stop: 'aborted' })
  })

  test('preflight ready, id and badge', async () => {
    const src = createReplaySource(rec)
    expect(src.id).toBe('replay')
    expect(await src.preflight()).toEqual({ ready: true })
    expect(src.badge().text).toBe('RECORDED · claude-sonnet-5-5 · captured 16 Nov 2026')
  })
})
