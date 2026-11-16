import { describe, expect, test } from 'vitest'
import { errorCopy, SourceError } from '../../../src/sources/errors'
import type { ErrorKind } from '../../../src/sources/errors'
import { badgeText, liveApiBadge, liveCliBadge, recordedBadge } from '../../../src/sources/types'
import { throwOnErrorEvents } from '../../../src/sources/types'

const kinds: ErrorKind[] = [
  'invalid-key', 'rate-limit', 'usage-limit', 'offline', 'cli-missing', 'cli-signed-out',
  'busy', 'not-recorded', 'bad-output', 'aborted', 'unknown',
]

describe('errorCopy', () => {
  test('all 11 kinds have non-empty title, body, action', () => {
    for (const k of kinds) {
      const c = errorCopy(k)
      expect(c.title.length).toBeGreaterThan(0)
      expect(c.body.length).toBeGreaterThan(0)
      expect(c.action.length).toBeGreaterThan(0)
    }
  })
  test('exact titles for the specified kinds', () => {
    expect(errorCopy('invalid-key')).toEqual({
      title: "That key didn't work",
      body: 'The provider rejected the key. Check it was copied in full, or create a new one.',
      action: 'Open settings',
    })
    expect(errorCopy('rate-limit').title).toBe('The AI is busy right now')
    expect(errorCopy('usage-limit').title).toBe("You've reached your plan's usage limit for now")
    expect(errorCopy('cli-missing').title).toBe("The command-line app isn't installed")
    expect(errorCopy('cli-missing').body).toMatch(/Claude Code/)
    expect(errorCopy('cli-missing').body).toMatch(/Codex/)
    expect(errorCopy('not-recorded').title).toBe("That part isn't in this recorded lesson")
    expect(errorCopy('bad-output').title).toBe("The AI's answer didn't make sense")
    expect(errorCopy('aborted').title).toBe('Stopped')
  })
})

describe('badges', () => {
  test('recorded', () => {
    const b = recordedBadge({ meta: { title: 't', model: 'claude-sonnet-5-5', via: 'claude-code', capturedAt: '2026-11-16', actionsVersion: 1, selection: 's' }, responses: {} })
    expect(b.text).toBe('RECORDED · claude-sonnet-5-5 · captured 16 Nov 2026')
    expect(badgeText(b)).toBe(b.text)
    expect(b).toMatchObject({ mode: 'recorded', billedTo: 'recording', capturedAt: '2026-11-16' })
  })
  test('September is Sep, not Sept', () => {
    expect(badgeText({ mode: 'recorded', text: '', model: 'm', billedTo: 'recording', capturedAt: '2026-09-03' }))
      .toBe('RECORDED · m · captured 3 Sep 2026')
  })
  test('live api', () => {
    expect(badgeText(liveApiBadge('Anthropic API', 'claude-sonnet-5-5'))).toBe('LIVE · Anthropic API · claude-sonnet-5-5')
    expect(liveApiBadge('Groq', 'llama').text).toBe('LIVE · Groq · llama')
    expect(liveApiBadge('OpenRouter', 'x').billedTo).toBe('api-key')
  })
  test('live cli', () => {
    expect(liveCliBadge('claude').text).toBe('LIVE · Claude Code on this computer')
    expect(liveCliBadge('codex').text).toBe('LIVE · Codex on this computer')
    expect(liveCliBadge('codex').billedTo).toBe('subscription')
  })
})

describe('throwOnErrorEvents', () => {
  test('passes events and throws on in-band error', async () => {
    async function* gen() {
      yield { type: 'text' as const, text: 'a' }
      yield { type: 'error' as const, kind: 'rate-limit' as const, detail: 'x' }
      yield { type: 'text' as const, text: 'b' }
    }
    const seen: string[] = []
    let err: unknown
    try {
      for await (const e of throwOnErrorEvents(gen())) seen.push(e.type)
    } catch (e) { err = e }
    expect(seen).toEqual(['text'])
    expect(err).toBeInstanceOf(SourceError)
    expect((err as SourceError).kind).toBe('rate-limit')
  })
})
