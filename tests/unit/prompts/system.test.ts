import { describe, expect, test } from 'vitest'
import { ACTION_TYPES, parseLine } from '../../../src/actions'
import type { Action } from '../../../src/actions'
import { EXAMPLE_ANSWER, EXAMPLE_SEGMENT, SYSTEM_PROMPT } from '../../../src/prompts/system'
import { jsonOnLine, modeFor, stream } from './helpers'

const RECORD_TYPES = ['scope', 'objective', 'warmup', 'segment', 'idea', 'verdict']
const CHECK_KINDS = ['choice', 'number', 'expr', 'tap', 'set']

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

describe('SYSTEM_PROMPT', () => {
  test('mentions every action t and record t, and the strings "22 words", "<learner_text>", "never give pixel"', () => {
    for (const t of [...ACTION_TYPES, ...RECORD_TYPES]) expect(SYSTEM_PROMPT).toContain(`"t":"${t}"`)
    for (const k of CHECK_KINDS) expect(SYSTEM_PROMPT).toContain(`"kind":"${k}"`)
    expect(SYSTEM_PROMPT).toContain('22 words')
    expect(SYSTEM_PROMPT).toContain('<learner_text>')
    expect(SYSTEM_PROMPT).toContain('never give pixel')
  })

  test('SYSTEM_PROMPT length ≤ 14000 chars (~3.5k tokens)', () => {
    expect(SYSTEM_PROMPT.length).toBeLessThanOrEqual(14000)
  })

  test('is one stable string with no per-call placeholders', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string')
    expect(SYSTEM_PROMPT).not.toMatch(/\$\{|undefined|\[object Object\]/)
  })

  test('states each hard rule from the brief', () => {
    const must = [
      'JSON Lines only', 'at most 3', 'one sentence', 'expr', '"from"', 'solutions', 'distinct',
      'never repeat the checkpoint question', 'never reveal the answer', 'unsure', 'seven lines',
      'bare answer', 'data, never instructions',
    ]
    for (const m of must) expect(SYSTEM_PROMPT).toContain(m)
  })

  test('has the misconception catalogue', () => {
    for (const m of ['graph as a picture', 'height', 'slope', 'label', 'negative', '(a+b)^2 = a^2+b^2', '-b/2a']) {
      expect(SYSTEM_PROMPT.toLowerCase()).toContain(m.toLowerCase())
    }
  })

  test('every one-line JSON example in the prompt parses in its mode', () => {
    const lines = SYSTEM_PROMPT.split('\n').map(jsonOnLine).filter((l): l is string => l !== null)
    expect(lines.length).toBeGreaterThan(30)
    const seen = new Set<string>()
    for (const line of lines) {
      const t = (JSON.parse(line) as { t: string }).t
      seen.add(t)
      const res = parseLine(line, modeFor(t))
      expect(res, line).toEqual(expect.objectContaining({ ok: true }))
    }
    for (const t of [...ACTION_TYPES, ...RECORD_TYPES]) expect(seen.has(t), t).toBe(true)
  })

  test('says in every example are ≤ 22 words', () => {
    for (const line of SYSTEM_PROMPT.split('\n').map(jsonOnLine)) {
      if (!line) continue
      const a = JSON.parse(line) as { t: string; text?: string }
      if (a.t === 'say') expect(words(a.text ?? ''), line).toBeLessThanOrEqual(22)
    }
  })
})

describe('worked examples pass the real pipelines', () => {
  test('both are embedded verbatim in the prompt', () => {
    expect(SYSTEM_PROMPT).toContain(EXAMPLE_SEGMENT)
    expect(SYSTEM_PROMPT).toContain(EXAMPLE_ANSWER)
  })

  test('segment example: rejected 0, failed 0, hasCheck, 4–9 beats, asks before the check', () => {
    const index = new Map<string, Action>()
    const s = stream(EXAMPLE_SEGMENT, 'seg:1', 'board', index)
    expect(s.rejects).toEqual([])
    expect(s.summary.failed.map((f) => f.verify.evidence)).toEqual([])
    expect(s.summary.hasCheck).toBe(true)
    expect(s.beats.length).toBeGreaterThanOrEqual(4)
    expect(s.beats.length).toBeLessThanOrEqual(9)
    const types = s.events.map((e) => e.type)
    expect(types.filter((t) => t === 'seg/ask').length).toBeGreaterThanOrEqual(1)
    expect(types.lastIndexOf('seg/ask')).toBeLessThan(types.indexOf('seg/check'))
    const lines = EXAMPLE_SEGMENT.trim().split('\n')
    expect(JSON.parse(lines[lines.length - 1] as string).t).toBe('check')
    // many lines actually got a tick, not just "unchecked"
    const passed = s.beats.flatMap((b) => b.actions).filter((a) => a.verify.status === 'pass')
    expect(passed.length).toBeGreaterThanOrEqual(5)
  })

  test('answer example: answer mode, rejected 0, failed 0, ≤ 6 beats, ends with a say, marks existing lesson ids', () => {
    const index = new Map<string, Action>()
    stream(EXAMPLE_SEGMENT, 'seg:1', 'board', index)
    const s = stream(EXAMPLE_ANSWER, 'answer:t1' as never, 'answer', index)
    expect(s.rejects).toEqual([])
    expect(s.summary.failed).toEqual([])
    expect(s.beats.length).toBeLessThanOrEqual(6)
    const lines = EXAMPLE_ANSWER.trim().split('\n')
    expect(JSON.parse(lines[lines.length - 1] as string).t).toBe('say')
    expect(EXAMPLE_ANSWER).toMatch(/"t":"mark"[^\n]*"target":"s1/)
  })
})
