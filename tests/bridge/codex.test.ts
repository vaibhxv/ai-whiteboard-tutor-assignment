// @vitest-environment node
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { codexArgs, parseCodexLine } from '../../bridge/codex'
import { runCli } from '../../bridge/spawn'
import type { RunOpts } from '../../bridge/spawn'
import type { GenEvent } from '../../src/sources/types'

const FAKE = resolve('tests/fixtures/fake-codex.mjs')

beforeEach(() => { process.env.WHYBOARD_CODEX_BIN = FAKE })
afterEach(() => { delete process.env.WHYBOARD_CODEX_BIN; delete process.env.OPENAI_API_KEY; delete process.env.CODEX_API_KEY })

async function collect(opts: RunOpts = {}, req: { system: string; user: string; model?: string } = { system: 'SYS', user: 'hello' }) {
  const out: GenEvent[] = []
  for await (const e of runCli('codex', req, new AbortController().signal, opts)) out.push(e)
  return out
}

test('codexArgs equals the §7.3 list exactly, with "-" last and the system prompt JSON-encoded', () => {
  const system = 'Line one\n"quoted" \\ back'
  expect(codexArgs({ system, cwd: '/tmp/x', model: 'gpt-6.1-terra' })).toEqual([
    'exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
    '--sandbox', 'read-only', '-C', '/tmp/x', '-m', 'gpt-6.1-terra',
    '-c', 'model_reasoning_effort="low"',
    '-c', 'features.shell_tool=false', '-c', 'web_search="disabled"',
    '-c', 'project_doc_max_bytes=0',
    '-c', `developer_instructions=${JSON.stringify(system)}`,
    '-',
  ])
  // No model: the CLI's own default (no -m at all).
  const noModel = codexArgs({ system: 's', cwd: '/tmp/x' })
  expect(noModel).not.toContain('-m')
  expect(noModel.at(-1)).toBe('-')
})

test('parseCodexLine: agent_message → text; turn.completed → done with usage; failures → error', () => {
  expect(parseCodexLine({ type: 'item.completed', item: { type: 'agent_message', text: 'whole' } })).toEqual([{ type: 'text', text: 'whole' }])
  expect(parseCodexLine({ type: 'item.completed', item: { type: 'reasoning', text: 'hm' } })).toEqual([])
  expect(parseCodexLine({ type: 'thread.started', thread_id: 't' })).toEqual([])
  const done = parseCodexLine({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 } }, { model: 'gpt-6.1-terra' })
  expect(done).toEqual([
    { type: 'meta', model: 'gpt-6.1-terra', billedTo: 'subscription', usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 2 } },
    { type: 'done', stop: 'end' },
  ])
  expect(parseCodexLine({ type: 'turn.failed', error: { message: "You've hit your usage limit." } })).toEqual([
    expect.objectContaining({ type: 'error', kind: 'usage-limit' }),
  ])
  expect(parseCodexLine({ type: 'error', message: 'stream disconnected' })).toEqual([expect.objectContaining({ type: 'error', kind: 'unknown' })])
  expect(parseCodexLine({ type: 'error', message: 'Not logged in. Please run codex login' })).toEqual([
    expect.objectContaining({ type: 'error', kind: 'cli-signed-out' }),
  ])
  expect(parseCodexLine(42)).toEqual([])
})

test('fake codex → one text event with the whole message, then done', async () => {
  const ev = await collect()
  const texts = ev.filter((e) => e.type === 'text')
  expect(texts).toEqual([{ type: 'text', text: '{"t":"say","text":"Hello"}\n{"t":"say","text":"World"}\n' }])
  expect(ev.at(-1)).toEqual({ type: 'done', stop: 'end' })
  expect(ev.at(-2)).toMatchObject({ type: 'meta', billedTo: 'subscription', usage: { outputTokens: 40 } })
})

test('codex gets the prompt on stdin, "-" last, its temp dir as -C, and no API keys', async () => {
  process.env.OPENAI_API_KEY = 'sk-should-not-pass'
  process.env.CODEX_API_KEY = 'cx-should-not-pass'
  let spawned: { pid: number; cwd: string } | undefined
  const ev = await collect({ env: { FAKE_MODE: 'echo' }, onSpawn: (s) => { spawned = s } }, { system: 'S', user: 'the prompt' })
  const echo = JSON.parse((ev.find((e) => e.type === 'text') as { text: string }).text) as { argv: string[]; stdin: string; envKeys: string[] }
  expect(echo.stdin).toBe('the prompt')
  expect(echo.argv.at(-1)).toBe('-')
  expect(echo.argv[echo.argv.indexOf('-C') + 1]).toBe(spawned!.cwd)
  expect(echo.argv).not.toContain('-m')
  expect(echo.envKeys).not.toContain('OPENAI_API_KEY')
  expect(echo.envKeys).not.toContain('CODEX_API_KEY')
  expect(existsSync(spawned!.cwd)).toBe(false)
})

test('codex failures: signed out, turn.failed usage limit, error event, missing binary', async () => {
  expect((await collect({ env: { FAKE_MODE: 'signedout' } })).at(-1)).toMatchObject({ type: 'error', kind: 'cli-signed-out' })
  expect((await collect({ env: { FAKE_MODE: 'failed' } })).at(-1)).toMatchObject({ type: 'error', kind: 'usage-limit' })
  expect((await collect({ env: { FAKE_MODE: 'error' } })).at(-1)).toMatchObject({ type: 'error', kind: 'unknown' })
  process.env.WHYBOARD_CODEX_BIN = '/nonexistent/codex'
  expect(await collect()).toEqual([expect.objectContaining({ type: 'error', kind: 'cli-missing' })])
})
