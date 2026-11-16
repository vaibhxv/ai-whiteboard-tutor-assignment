import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseLine } from '../../../src/actions'

const fixture = readFileSync('tests/fixtures/streams/spike-sonnet.txt', 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '' && !l.startsWith('#'))

const reason = (line: string, mode: Parameters<typeof parseLine>[1]) => {
  const r = parseLine(line, mode)
  return r.ok ? null : r.reason
}

const choice = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    t: 'check', id: 'c1', kind: 'choice', prompt: 'Which?',
    options: [
      { id: 'a', text: 'A', correct: true },
      { id: 'b', text: 'B', correct: false, misconception: 'm' },
    ],
    explain: 'Because.', hint: 'Think.', ...over,
  })

describe('parseLine', () => {
  test('accepts every action line from the spike segment', () => {
    expect(fixture).toHaveLength(19)
    for (const l of fixture) {
      const r = parseLine(l, 'board')
      expect(r.ok, `${l} -> ${JSON.stringify(r)}`).toBe(true)
    }
  })

  test('rejects pixel-ish fields', () => {
    expect(parseLine('{"t":"write","id":"a","text":"x","x":40}', 'board').ok).toBe(false)
  })

  test('say longer than 22 words is rejected with reason "say too long"', () => {
    const text = Array(23).fill('w').join(' ')
    expect(reason(JSON.stringify({ t: 'say', text }), 'board')).toBe('say too long')
    expect(parseLine(JSON.stringify({ t: 'say', text: Array(22).fill('w').join(' ') }), 'board').ok).toBe(true)
  })

  test('choice check needs >=2 options and explain + hint', () => {
    expect(parseLine(choice(), 'board').ok).toBe(true)
    expect(parseLine(choice({ options: [{ id: 'a', text: 'A', correct: true }] }), 'board').ok).toBe(false)
    expect(parseLine(choice({ explain: undefined }), 'board').ok).toBe(false)
    expect(parseLine(choice({ hint: undefined }), 'board').ok).toBe(false)
    expect(parseLine(choice({ hint: 'x'.repeat(161) }), 'board').ok).toBe(false)
  })

  test('check failures name the offending field', () => {
    const base = { t: 'check', id: 'c', prompt: 'p', explain: 'e' }
    expect(reason(JSON.stringify({ ...base, kind: 'number', answer: '2' }), 'board')).toMatch(/hint/)
    expect(reason(JSON.stringify({ ...base, hint: 'h', kind: 'essay' }), 'board')).toMatch(/kind/)
  })

  test('other check kinds parse', () => {
    const base = { t: 'check', id: 'c', prompt: 'p', explain: 'e', hint: 'h' }
    expect(parseLine(JSON.stringify({ ...base, kind: 'number', answer: '2' }), 'board').ok).toBe(true)
    expect(parseLine(JSON.stringify({ ...base, kind: 'expr', answer: '2*x', variable: 'x' }), 'board').ok).toBe(true)
    expect(parseLine(JSON.stringify({ ...base, kind: 'tap', figure: 'p1', answer: 'r1' }), 'board').ok).toBe(true)
    expect(parseLine(JSON.stringify({ ...base, kind: 'set', explore: 'e', param: 'a', target: [1, 2] }), 'board').ok).toBe(true)
  })

  test('mode filtering', () => {
    const plot = '{"t":"plot","id":"p","x":[0,1],"y":[0,1],"fns":[]}'
    expect(parseLine(plot, 'board').ok).toBe(true)
    expect(parseLine(plot, 'answer').ok).toBe(false)
    expect(parseLine('{"t":"say","text":"hi"}', 'answer').ok).toBe(true)
    const idea = '{"t":"idea","id":"i1","text":"t","seg":1}'
    expect(parseLine(idea, 'recap').ok).toBe(true)
    expect(parseLine(idea, 'board').ok).toBe(false)
    expect(parseLine(choice(), 'recap').ok).toBe(true)
    expect(parseLine('{"t":"write","id":"a","text":"x"}', 'recap').ok).toBe(false)
    const verdict = '{"t":"verdict","ok":true,"say":"good"}'
    expect(parseLine(verdict, 'review').ok).toBe(true)
    expect(parseLine(verdict, 'board').ok).toBe(false)
  })

  test('unknown t is rejected with reason starting "unknown action"', () => {
    expect(reason('{"t":"zap"}', 'board')).toMatch(/^unknown action/)
  })

  test('invalid JSON is rejected', () => {
    expect(parseLine('not json', 'board').ok).toBe(false)
    expect(parseLine('[1]', 'board').ok).toBe(false)
  })

  test('plot ranges and explore params are validated', () => {
    expect(parseLine('{"t":"plot","id":"p","x":[1,1],"y":[0,1],"fns":[]}', 'board').ok).toBe(false)
    const ex = (params: unknown) => JSON.stringify({ t: 'explore', id: 'e', x: [-5, 5], y: [-5, 5], expr: 'a*x', prompt: 'p', params })
    expect(parseLine(ex([{ name: 'a', min: 0, max: 4, start: 2 }]), 'board').ok).toBe(true)
    expect(parseLine(ex([{ name: 'a', min: 0, max: 4, start: 4 }]), 'board').ok).toBe(false)
    expect(parseLine(ex([]), 'board').ok).toBe(false)
  })

  test('plan mode accepts scope/objective/warmup/segment and rejects segment n=6', () => {
    const seg = (n: number) => JSON.stringify({ t: 'segment', n, title: 'T', goal: 'g', representation: 'graph', misconception: 'm', check: 'choice' })
    expect(parseLine('{"t":"scope","verdict":"in","reason":"r"}', 'plan').ok).toBe(true)
    expect(parseLine('{"t":"objective","text":"o"}', 'plan').ok).toBe(true)
    expect(parseLine(JSON.stringify({ t: 'warmup', id: 'w', prompt: 'p', options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: false }] }), 'plan').ok).toBe(true)
    expect(parseLine(seg(5), 'plan').ok).toBe(true)
    expect(parseLine(seg(6), 'plan').ok).toBe(false)
    expect(parseLine(seg(1), 'board').ok).toBe(false)
  })
})
