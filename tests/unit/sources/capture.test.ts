import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { withCapture } from '../../../src/sources/capture'
import { createReplaySource } from '../../../src/sources/replay'
import { RecordingSchema } from '../../../src/sources/recording'

const rec = RecordingSchema.parse(JSON.parse(readFileSync('tests/fixtures/lessons/vertex.fixture.json', 'utf8')))

test('capture collects intent→text for each completed generate', async () => {
  const got: [string, string, string][] = []
  const src = withCapture(createReplaySource(rec, { intervalMs: 0 }), (i, t, m) => got.push([i, t, m.model]))
  const go = async (intent: string, signal = new AbortController().signal) => {
    for await (const _ of src.generate({ role: 'plan', intent, system: '', user: '', maxOutputTokens: 1 }, signal)) void _
  }
  await go('plan')
  await go('segment:1')
  const ac = new AbortController(); ac.abort()
  await go('recap', ac.signal)
  expect(got.map((g) => g[0])).toEqual(['plan', 'segment:1'])
  expect(got[1]?.[1]).toBe(rec.responses['segment:1']!.text)
  expect(got[0]?.[2]).toBe('claude-sonnet-5-5')
  expect(src.id).toBe('replay')
})
