import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { Action } from '../../../src/actions'
import { createBoardPipeline } from '../../../src/pipeline/board-pipeline'
import type { Beat } from '../../../src/pipeline/beats'

const fx = (n: string) => readFileSync(`tests/fixtures/streams/${n}.txt`, 'utf8')

function run(text: string, mode: 'board' | 'answer' = 'board', index = new Map<string, Action>(), chunk = 40) {
  const beats: Beat[] = []
  const checks: unknown[] = []
  const asks: unknown[] = []
  const rejects: [string, string][] = []
  const p = createBoardPipeline({
    segKey: 'seg:1', mode, ink: 'lesson', index,
    onBeat: (b) => beats.push(b), onCheck: (c) => checks.push(c), onAsk: (a) => asks.push(a),
    onReject: (l, r) => rejects.push([l, r]),
  })
  for (let i = 0; i < text.length; i += chunk) p.push(text.slice(i, i + chunk))
  const summary = p.end('end')
  return { beats, checks, asks, rejects, summary, index }
}

describe('board pipeline', () => {
  test('spike: 7 beats, one check, nothing failed or rejected', () => {
    const r = run(fx('spike-sonnet'))
    expect(r.checks).toHaveLength(1)
    expect(r.summary).toMatchObject({ hasCheck: true, rejected: 0, accepted: 19, truncated: false })
    expect(r.summary.failed).toEqual([])
    expect(r.beats.map((b) => b.id)).toEqual([0, 1, 2, 3, 4, 5, 6].map((n) => `seg:1#${n}`))
    expect(r.beats.every((b) => b.actions.length <= 3)).toBe(true)
    expect(r.beats[6]?.actions).toHaveLength(0)
    expect(r.index.has('p1')).toBe(true)
  })
  test('fenced/prose give same result', () => {
    expect(run(fx('fenced')).summary.accepted).toBe(19)
    expect(run(fx('prose')).summary.accepted).toBe(19)
  })
  test('nocheck: hasCheck false, last beat still flushed', () => {
    const r = run(fx('nocheck'))
    expect(r.summary.hasCheck).toBe(false)
    expect(r.checks).toHaveLength(0)
    expect(r.beats).toHaveLength(7)
  })
  test('wrong factorisation fails inside its beat and in summary.failed', () => {
    const t = [
      '{"t":"say","text":"Factor it."}',
      '{"t":"math","id":"m1","latex":"x^2-4x+3","expr":"x^2-4*x+3"}',
      '{"t":"step","id":"s1","latex":"(x-1)(x+3)","expr":"(x-1)*(x+3)","why":"factor","from":"m1"}',
    ].join('\n')
    const r = run(t)
    expect(r.summary.failed).toHaveLength(1)
    const step = r.beats[0]?.actions[1]
    expect(step?.t).toBe('step')
    expect(step?.verify.status).toBe('fail')
  })
  test('answer mode rejects plot', () => {
    const r = run('{"t":"plot","id":"p1","x":[-1,1],"y":[-1,1],"fns":[]}\n', 'answer')
    expect(r.rejects[0]?.[1].startsWith('not allowed in answer')).toBe(true)
    expect(r.summary).toMatchObject({ accepted: 0, rejected: 1 })
  })
  test('after check rejected; unknown refs rejected; ids from earlier index respected', () => {
    const idx = new Map<string, Action>([['old', { t: 'math', id: 'old', latex: 'x' }]])
    const t = [
      '{"t":"mark","kind":"box","target":"old"}',
      '{"t":"mark","kind":"box","target":"nope"}',
      '{"t":"math","id":"old","latex":"y"}',
      '{"t":"ask","id":"a1","text":"ok?"}',
      '{"t":"check","id":"c1","kind":"number","prompt":"p","answer":"1","explain":"e","hint":"h"}',
      '{"t":"write","id":"w9","text":"late"}',
    ].join('\n')
    const r = run(t, 'board', idx)
    expect(r.rejects.map((x) => x[1])).toEqual(['unknown target nope', 'duplicate id old', 'after check'])
    expect(r.asks).toHaveLength(1)
    expect(r.checks).toHaveLength(1)
    expect(r.beats).toHaveLength(1)
  })
  test('truncated flag', () => {
    const p = createBoardPipeline({ segKey: 's', mode: 'board', ink: 'lesson', index: new Map(), onBeat() {}, onCheck() {}, onAsk() {}, onReject() {} })
    p.push(fx('truncated'))
    expect(p.end('length')).toMatchObject({ truncated: true, accepted: 3 })
  })
})
