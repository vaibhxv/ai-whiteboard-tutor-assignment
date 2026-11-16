import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { Action } from '../../../src/actions'
import { createBoardPipeline } from '../../../src/pipeline/board-pipeline'
import { createRecordStream } from '../../../src/pipeline/record-stream'
import { RecordingSchema } from '../../../src/sources/recording'
import { manifest } from '../../../src/recordings/manifest'

const raw: unknown = JSON.parse(readFileSync('tests/fixtures/lessons/vertex.fixture.json', 'utf8'))

describe('recording', () => {
  test('vertex.fixture.json parses with RecordingSchema', () => {
    expect(RecordingSchema.safeParse(raw).success).toBe(true)
  })
  test('rejects a bad via', () => {
    const bad = { ...(raw as object), meta: { ...(raw as { meta: object }).meta, via: 'nope' } }
    expect(RecordingSchema.safeParse(bad).success).toBe(false)
  })
  test('manifest starts empty', () => expect(manifest).toEqual([]))

  test('has the full branch tree', () => {
    const keys = Object.keys(RecordingSchema.parse(raw).responses)
    for (const k of ['plan', 'segment:1', 'segment:2', 'reteach:c1:b', 'reteach:c1:c', 'reteach:c1:d', 'solution:c1',
      'reteach:c2:a0', 'reteach:c2:other', 'solution:c2', 'lost:1:1', 'lost:2:1', 'answer:q2', 'recap']) {
      expect(keys).toContain(k)
    }
  })

  test('every response passes the real pipelines with 0 rejects', () => {
    const rec = RecordingSchema.parse(raw)
    const index = new Map<string, Action>()
    const modeOf = (k: string) =>
      k === 'plan' ? 'plan' : k === 'recap' ? 'recap' : k.startsWith('answer:') ? 'answer' : 'board'
    // segments first so later responses can share the index
    const order = Object.keys(rec.responses)
    for (const k of order) {
      const text = rec.responses[k]!.text
      const mode = modeOf(k)
      const rejects: string[] = []
      if (mode === 'board' || mode === 'answer') {
        const p = createBoardPipeline({
          segKey: k, mode, ink: 'lesson', index,
          onBeat: () => {}, onCheck: () => {}, onAsk: () => {},
          onReject: (l, r) => rejects.push(`${l} => ${r}`),
        })
        for (let i = 0; i < text.length; i += 37) p.push(text.slice(i, i + 37))
        const s = p.end('end')
        expect(rejects, k).toEqual([])
        expect(s.rejected, k).toBe(0)
        expect(s.failed, k).toEqual([])
        expect(s.accepted, k).toBeGreaterThan(0)
        if (k.startsWith('segment:')) expect(s.hasCheck, k).toBe(true)
        if (/^(reteach|lost|answer)/.test(k)) expect(s.hasCheck, k).toBe(false)
      } else {
        const st = createRecordStream({ mode, onRecord: () => {}, onReject: (l, r) => rejects.push(`${l} => ${r}`) })
        st.push(text)
        const s = st.end('end')
        expect(rejects, k).toEqual([])
        expect(s.accepted, k).toBeGreaterThan(0)
      }
    }
  })

  test('all ids are unique across every fixture response', () => {
    const rec = RecordingSchema.parse(raw)
    const seen = new Map<string, string>()
    const dupes: string[] = []
    const add = (id: string, k: string) => {
      if (seen.has(id)) dupes.push(`${id} (${seen.get(id)} and ${k})`)
      else seen.set(id, k)
    }
    for (const [k, r] of Object.entries(rec.responses)) {
      for (const line of r.text.split('\n').filter(Boolean)) {
        const o = JSON.parse(line) as { t: string; id?: string; fns?: { id: string }[] }
        if (o.t === 'segment' || o.t === 'scope' || o.t === 'objective') continue
        if (typeof o.id === 'string') add(o.id, k)
        for (const f of o.fns ?? []) add(f.id, k)
      }
    }
    expect(dupes).toEqual([])
  })
})
