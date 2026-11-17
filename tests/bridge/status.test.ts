// @vitest-environment node
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { getStatus } from '../../bridge/status'

beforeEach(() => {
  process.env.WHYBOARD_CLAUDE_BIN = resolve('tests/fixtures/fake-claude.mjs')
  process.env.WHYBOARD_CODEX_BIN = resolve('tests/fixtures/fake-codex.mjs')
})
afterEach(() => { delete process.env.WHYBOARD_CLAUDE_BIN; delete process.env.WHYBOARD_CODEX_BIN })

test('status strips email/orgId/orgName (assert JSON.stringify(status) lacks "@" and "org")', async () => {
  const status = await getStatus()
  expect(status).toEqual({
    claude: { installed: true, version: '9.9.9', signedIn: true, plan: 'max' },
    codex: { installed: true, version: '0.99.0', signedIn: true },
  })
  const json = JSON.stringify(status)
  expect(json).not.toContain('@')
  expect(json.toLowerCase()).not.toContain('org')
  expect(json).not.toContain('example.com')
})

test('signed out CLIs report installed but not signed in', async () => {
  const status = await getStatus({ env: { FAKE_MODE: 'signedout' } })
  expect(status.claude).toEqual({ installed: true, version: '9.9.9', signedIn: false })
  expect(status.codex).toEqual({ installed: true, version: '0.99.0', signedIn: false })
})

test('missing CLIs report installed: false', async () => {
  process.env.WHYBOARD_CLAUDE_BIN = '/nonexistent/claude'
  process.env.WHYBOARD_CODEX_BIN = '/nonexistent/codex'
  expect(await getStatus()).toEqual({ claude: { installed: false }, codex: { installed: false } })
})
