import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseLine } from '../../../src/actions'
import type { Action } from '../../../src/actions'
import type { Checked } from '../../../src/maths/verify'
import { createBeatAssembler } from '../../../src/pipeline/beats'
import type { Beat } from '../../../src/pipeline/beats'

const chk = (a: Action): Checked => ({ ...a, verify: { status: 'unchecked' } }) as Checked
const w = (id: string): Checked => chk({ t: 'write', id, text: 't' })
const say = (text: string): Checked => chk({ t: 'say', text })

describe('beat assembler', () => {
  test('spike stream gives 7 beats seg:1#0..6, each <=3 actions', () => {
    const lines = readFileSync('tests/fixtures/streams/spike-sonnet.txt', 'utf8').split('\n').filter((l) => l.startsWith('{'))
    const b = createBeatAssembler('seg:1', 'lesson')
    const beats: Beat[] = []
    for (const l of lines) {
      const r = parseLine(l, 'board')
      if (!r.ok) throw new Error(r.reason)
      const a = r.record as Action
      if (a.t === 'check') continue
      const c = b.add(chk(a))
      if (c) beats.push(c)
    }
    const last = b.end()
    if (last) beats.push(last)
    expect(beats.map((x) => x.id)).toEqual([0, 1, 2, 3, 4, 5, 6].map((n) => `seg:1#${n}`))
    expect(beats.every((x) => x.actions.length <= 3)).toBe(true)
    expect(beats[6]?.actions).toHaveLength(0)
  })
  test('actions before first say get empty-say beat; 4th action splits', () => {
    const b = createBeatAssembler('s', 'answer')
    expect(b.add(w('a'))).toBeNull()
    b.add(w('b')); b.add(w('c'))
    const first = b.add(w('d'))
    expect(first).toMatchObject({ id: 's#0', say: '', ink: 'answer' })
    expect(first?.actions).toHaveLength(3)
    const second = b.add(say('hi'))
    expect(second).toMatchObject({ id: 's#1', say: '' })
    expect(second?.actions).toHaveLength(1)
    expect(b.end()).toMatchObject({ id: 's#2', say: 'hi' })
    expect(b.end()).toBeNull()
  })
})
