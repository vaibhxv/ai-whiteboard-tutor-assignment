import { describe, expect, test } from 'vitest'
import type { GenResult } from '../../../scripts/record-lib'
import { recordLesson, RecordError } from '../../../scripts/record-lib'
import { RecordingSchema } from '../../../src/sources/recording'
import fixture from '../../fixtures/lessons/vertex.fixture.json'

const text = (intent: string): string => (fixture.responses as Record<string, { text: string }>)[intent]?.text ?? ''

type RecordGen = Parameters<typeof recordLesson>[0]['generate']
type Call = { role: string; intent: string }

/** A fake generate that serves the vertex fixture, and records what was asked. */
function fake(opts: { bad?: Record<string, number>; model?: string } = {}) {
  const calls: Call[] = []
  const seen: Record<string, number> = {}
  let inFlight = 0
  let peak = 0
  const generate = async (role: string, intent: string) => {
    calls.push({ role, intent })
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 1))
    inFlight--
    seen[intent] = (seen[intent] ?? 0) + 1
    // the first `bad[intent]` calls return a line the schema rejects, then the fixture text
    if (seen[intent]! <= (opts.bad?.[intent] ?? 0)) return { text: '{"t":"say","text":"ok"}\n{"t":"nonsense"}\n', model: opts.model }
    return { text: text(intent), model: opts.model }
  }
  return { generate: generate as (role: string, intent: string, user: string) => Promise<GenResult> as never as RecordGen, calls, peak: () => peak }
}

describe('recordLesson', () => {
  test('asks for exactly the intents implied by the plan, checks and asks', async () => {
    const f = fake({ model: 'claude-test-1' })
    const { recording, stats } = await recordLesson({ topic: 't', title: 'T', generate: f.generate, capturedAt: '2026-11-17' })
    expect([...f.calls.map((c) => c.intent)].sort()).toEqual(Object.keys(fixture.responses).sort())
    expect(Object.keys(recording.responses).sort()).toEqual(Object.keys(fixture.responses).sort())
    expect(stats.calls).toBe(Object.keys(fixture.responses).length)
    // roles follow the intents
    const roleOf = (i: string) => f.calls.find((c) => c.intent === i)?.role
    expect(roleOf('plan')).toBe('plan')
    expect(roleOf('segment:1')).toBe('segment')
    expect(roleOf('reteach:c1:b')).toBe('reteach')
    expect(roleOf('solution:c1')).toBe('solution')
    expect(roleOf('lost:1:1')).toBe('lost')
    expect(roleOf('answer:q2')).toBe('answer')
    expect(roleOf('recap')).toBe('recap')
    // every anticipated answer plus "other" for number/expr; wrong options only for choice
    expect(Object.keys(recording.responses)).toEqual(expect.arrayContaining(['reteach:c2:a0', 'reteach:c2:other']))
    expect(Object.keys(recording.responses).filter((k) => k.startsWith('reteach:c1:')).sort()).toEqual(['reteach:c1:b', 'reteach:c1:c', 'reteach:c1:d'])
    expect(recording.responses['answer:q2']?.question).toBeTruthy()
    expect(f.peak()).toBeLessThanOrEqual(2)
  })

  test('a response with a reject is retried; after maxAttempts the script throws naming the intent', async () => {
    const retried = fake({ bad: { 'reteach:c1:b': 1 } })
    const { stats, recording } = await recordLesson({ topic: 't', title: 'T', generate: retried.generate })
    expect(retried.calls.filter((c) => c.intent === 'reteach:c1:b')).toHaveLength(2)
    expect(stats.attempts['reteach:c1:b']).toBe(2)
    expect(recording.responses['reteach:c1:b']?.text).toBe(text('reteach:c1:b')) // the later, clean text, unedited

    const hopeless = fake({ bad: { 'segment:2': 99 } })
    const err = await recordLesson({ topic: 't', title: 'T', generate: hopeless.generate, maxAttempts: 2 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RecordError)
    expect((err as Error).message).toContain('segment:2')
    expect(hopeless.calls.filter((c) => c.intent === 'segment:2')).toHaveLength(2)
  })

  test('a main segment without a check, and a length stop, count as failures', async () => {
    const noCheck = text('segment:1').split('\n').filter((l) => !l.includes('"t":"check"')).join('\n')
    const done = new Set<string>()
    const g = fake()
    const gen: RecordGen = async (role, intent, user) => {
      if (intent === 'segment:1' && !done.has(intent) && done.add(intent)) return noCheck
      if (intent === 'segment:2' && !done.has(intent) && done.add(intent)) return { text: text('segment:2'), stop: 'length' as const }
      return g.generate(role, intent, user)
    }
    const { stats } = await recordLesson({ topic: 't', title: 'T', generate: gen })
    expect(stats.attempts['segment:1']).toBe(2)
    expect(stats.attempts['segment:2']).toBe(2)
  })

  test('output validates against RecordingSchema and meta.selection records attempts', async () => {
    const f = fake({ bad: { 'solution:c1': 1 }, model: 'claude-test-1' })
    const { recording } = await recordLesson({ topic: 't', title: 'My title', generate: f.generate, capturedAt: '2026-11-17' })
    expect(RecordingSchema.safeParse(recording).success).toBe(true)
    expect(recording.meta).toMatchObject({ title: 'My title', model: 'claude-test-1', via: 'claude-code', capturedAt: '2026-11-17', actionsVersion: 1 })
    expect(recording.meta.selection).toMatch(/^best of up to 3 runs per response; text unedited; attempts: plan=1, /)
    expect(recording.meta.selection).toContain('solution:c1=2')
    expect(recording.meta.selection).toContain('segment:1=1')
  })

  test('a usage limit stops at once without retrying, and seeded responses spend no call', async () => {
    const limit = Object.assign(new Error('limit'), { kind: 'usage-limit' })
    let calls = 0
    const err = await recordLesson({ topic: 't', title: 'T', generate: (async () => { calls++; throw limit }) as never }).catch((e: unknown) => e)
    expect(err).toBe(limit)
    expect(calls).toBe(1)

    const seed = { plan: { text: text('plan'), attempts: 1 } }
    const f = fake()
    const { stats } = await recordLesson({ topic: 't', title: 'T', generate: f.generate, seed })
    expect(stats.reused).toBe(1)
    expect(f.calls.some((c) => c.intent === 'plan')).toBe(false)
  })
})
