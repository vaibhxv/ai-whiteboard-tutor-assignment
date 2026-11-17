// @vitest-environment node
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { claudeArgs, parseClaudeLine } from '../../bridge/claude'
import { childEnv, runCli } from '../../bridge/spawn'
import type { RunOpts } from '../../bridge/spawn'
import type { GenEvent } from '../../src/sources/types'

const FAKE = resolve('tests/fixtures/fake-claude.mjs')

beforeEach(() => { process.env.WHYBOARD_CLAUDE_BIN = FAKE })
afterEach(() => { delete process.env.WHYBOARD_CLAUDE_BIN; delete process.env.ANTHROPIC_API_KEY })

async function collect(opts: RunOpts = {}, req = { system: 'SYS', user: 'hello' }, signal = new AbortController().signal) {
  const out: GenEvent[] = []
  for await (const e of runCli('claude', req, signal, opts)) out.push(e)
  return out
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

test('claudeArgs equals the §7.3 list exactly; never contains --bare', () => {
  const args = claudeArgs({ model: 'sonnet', system: 'You are a tutor.' })
  expect(args).toEqual([
    '-p', '--model', 'sonnet', '--tools', '', '--system-prompt', 'You are a tutor.',
    '--safe-mode', '--setting-sources', '', '--strict-mcp-config', '--disallowedTools', 'mcp__*',
    '--disable-slash-commands', '--no-session-persistence', '--permission-prompts', 'none',
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
  ])
  expect(args).not.toContain('--bare')
})

test('childEnv strips ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN and sets CLAUDE_CODE_DISABLE_AUTO_MEMORY=1', () => {
  const base = {
    PATH: '/bin', HOME: '/h', USER: 'u', LOGNAME: 'u', SHELL: '/bin/zsh', TMPDIR: '/t', LANG: 'en', LC_ALL: 'C', TERM: 'x',
    CLAUDE_CONFIG_DIR: '/cfg', CODEX_HOME: '/cx',
    ANTHROPIC_API_KEY: 'sk-ant', ANTHROPIC_AUTH_TOKEN: 'tok', OPENAI_API_KEY: 'sk-oa', CODEX_API_KEY: 'cx',
    CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', NODE_OPTIONS: '--inspect', AWS_SECRET_ACCESS_KEY: 'aws',
  }
  const c = childEnv(base, 'claude')
  expect(c).toEqual({
    PATH: '/bin', HOME: '/h', USER: 'u', LOGNAME: 'u', SHELL: '/bin/zsh', TMPDIR: '/t', LANG: 'en', LC_ALL: 'C', TERM: 'x',
    CLAUDE_CONFIG_DIR: '/cfg', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  })
  const x = childEnv(base, 'codex')
  expect(x).toEqual({
    PATH: '/bin', HOME: '/h', USER: 'u', LOGNAME: 'u', SHELL: '/bin/zsh', TMPDIR: '/t', LANG: 'en', LC_ALL: 'C', TERM: 'x',
    CODEX_HOME: '/cx',
  })
  for (const env of [c, x]) {
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CLAUDECODE']) {
      expect(env, k).not.toHaveProperty(k)
    }
  }
})

test('parseClaudeLine maps init, text deltas, rate limits and result', () => {
  const st = {}
  expect(parseClaudeLine({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5', apiKeySource: 'none' }, st))
    .toEqual([{ type: 'meta', model: 'claude-sonnet-5-5', billedTo: 'subscription' }])
  expect(parseClaudeLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } }, st))
    .toEqual([{ type: 'text', text: 'x' }])
  expect(parseClaudeLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hm' } } }, st))
    .toEqual([])
  expect(parseClaudeLine({
    type: 'rate_limit_event',
    rate_limit_info: { status: 'allowed', resetsAt: 1794919800, rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization: 0.52 } } },
  }, st)).toEqual([{
    type: 'meta', model: 'claude-sonnet-5-5', billedTo: 'subscription',
    limits: { usedPercent: 52, resetsAt: new Date(1794919800 * 1000).toISOString(), window: 'five_hour' },
  }])
  expect(parseClaudeLine({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } }, st))
    .toEqual([expect.objectContaining({ type: 'error', kind: 'usage-limit' })])
  const done = parseClaudeLine({ type: 'result', is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 3 } }, st)
  expect(done.at(-1)).toEqual({ type: 'done', stop: 'end' })
  expect(done[0]).toMatchObject({ type: 'meta', usage: { inputTokens: 2, outputTokens: 3 } })
  expect(parseClaudeLine({ type: 'result', is_error: true, result: 'Invalid API key · Please run /login' }, {}).at(-1))
    .toMatchObject({ type: 'error', kind: 'cli-signed-out' })
  expect(parseClaudeLine({ type: 'result', is_error: true, result: 'boom' }, {}).at(-1)).toMatchObject({ type: 'error', kind: 'unknown' })
  expect(parseClaudeLine({ type: 'system', subtype: 'init', model: 'm', apiKeySource: 'ANTHROPIC_API_KEY' }, {}))
    .toEqual([{ type: 'meta', model: 'm', billedTo: 'api-key' }])
  expect(parseClaudeLine('nonsense', {})).toEqual([])
  expect(parseClaudeLine(null, {})).toEqual([])
})

test('fake claude → meta billedTo subscription, text "abc", done', async () => {
  const ev = await collect()
  expect(ev[0]).toEqual({ type: 'meta', model: 'claude-sonnet-5-5', billedTo: 'subscription' })
  expect(ev.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')).toBe('abc')
  expect(ev.some((e) => e.type === 'meta' && e.limits?.usedPercent === 52)).toBe(true)
  expect(ev.at(-1)).toEqual({ type: 'done', stop: 'end' })
  expect(ev.filter((e) => e.type === 'done')).toHaveLength(1)
})

test('the prompt goes on stdin, the system prompt as an argument, in an empty temp dir, with an allowlisted env', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-pass'
  let spawned: { pid: number; cwd: string } | undefined
  const ev = await collect({ env: { FAKE_MODE: 'echo' }, onSpawn: (i) => { spawned = i } }, { system: 'SYS "quoted" $(rm -rf /)', user: 'the prompt' })
  const echo = JSON.parse(ev.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')) as {
    argv: string[]; stdin: string; envKeys: string[]; cwd: string
  }
  expect(echo.stdin).toBe('the prompt')
  expect(echo.argv[echo.argv.indexOf('--system-prompt') + 1]).toBe('SYS "quoted" $(rm -rf /)')
  expect(echo.argv).not.toContain('the prompt')
  expect(echo.envKeys).not.toContain('ANTHROPIC_API_KEY')
  expect(echo.envKeys).toContain('CLAUDE_CODE_DISABLE_AUTO_MEMORY')
  expect(spawned).toBeDefined()
  expect(existsSync(spawned!.cwd)).toBe(false) // removed afterwards
})

test('model defaults to sonnet and is passed through', async () => {
  const argvOf = async (model?: string) => {
    const ev = await collect({ env: { FAKE_MODE: 'echo' } }, { system: 's', user: 'u', ...(model ? { model } : {}) })
    const echo = JSON.parse(ev.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('')) as { argv: string[] }
    return echo.argv[echo.argv.indexOf('--model') + 1]
  }
  expect(await argvOf()).toBe('sonnet')
  expect(await argvOf('haiku')).toBe('haiku')
})

test('fake claude signedout → error cli-signed-out; missing binary → cli-missing', async () => {
  const out = await collect({ env: { FAKE_MODE: 'signedout' } })
  expect(out.at(-1)).toMatchObject({ type: 'error', kind: 'cli-signed-out' })
  process.env.WHYBOARD_CLAUDE_BIN = '/nonexistent/dir/claude'
  const miss = await collect()
  expect(miss).toEqual([expect.objectContaining({ type: 'error', kind: 'cli-missing' })])
})

test('usage limit → error usage-limit; api-key billing reported honestly; truncation and crashes', async () => {
  expect((await collect({ env: { FAKE_MODE: 'limit' } })).at(-1)).toMatchObject({ type: 'error', kind: 'usage-limit' })
  expect((await collect({ env: { FAKE_MODE: 'apikey' } }))[0]).toMatchObject({ type: 'meta', billedTo: 'api-key' })
  expect((await collect({ env: { FAKE_MODE: 'length' } })).at(-1)).toEqual({ type: 'done', stop: 'length' })
  expect((await collect({ env: { FAKE_MODE: 'cut' } })).at(-1)).toEqual({ type: 'done', stop: 'length' })
  const crash = (await collect({ env: { FAKE_MODE: 'crash' } })).at(-1)
  expect(crash).toMatchObject({ type: 'error', kind: 'unknown' })
  expect((crash as { detail?: string }).detail).toMatch(/exit 3/)
})

test('abort kills the child (pid no longer alive) and removes the temp dir', async () => {
  const ac = new AbortController()
  let spawned: { pid: number; cwd: string } | undefined
  const out: GenEvent[] = []
  for await (const e of runCli('claude', { system: 's', user: 'u' }, ac.signal, { env: { FAKE_MODE: 'slow' }, onSpawn: (i) => { spawned = i } })) {
    out.push(e)
    if (e.type === 'text') {
      expect(alive(spawned!.pid)).toBe(true)
      expect(existsSync(spawned!.cwd)).toBe(true)
      ac.abort()
    }
  }
  expect(out.at(-1)).toEqual({ type: 'done', stop: 'aborted' })
  expect(alive(spawned!.pid)).toBe(false)
  expect(existsSync(spawned!.cwd)).toBe(false)
})

test('a consumer that stops early (return) also kills the child', async () => {
  let spawned: { pid: number; cwd: string } | undefined
  for await (const e of runCli('claude', { system: 's', user: 'u' }, new AbortController().signal, { env: { FAKE_MODE: 'slow' }, onSpawn: (i) => { spawned = i } })) {
    if (e.type === 'text') break
  }
  expect(alive(spawned!.pid)).toBe(false)
  expect(existsSync(spawned!.cwd)).toBe(false)
})

test('the timeout kills a hung child and reports it', async () => {
  let spawned: { pid: number; cwd: string } | undefined
  const out = await collect({ env: { FAKE_MODE: 'slow' }, timeoutMs: 300, onSpawn: (i) => { spawned = i } })
  expect(out.at(-1)).toMatchObject({ type: 'error', kind: 'unknown', detail: expect.stringMatching(/took longer/) })
  expect(alive(spawned!.pid)).toBe(false)
  expect(existsSync(spawned!.cwd)).toBe(false)
})

test('at most 2 children per CLI; a third request queues until a slot frees', async () => {
  const acs = [new AbortController(), new AbortController(), new AbortController()]
  const pids: number[] = []
  const firstText = acs.map(() => { let r!: () => void; const p = new Promise<void>((res) => { r = res }); return { p, r } })
  const runs = acs.map(async (ac, i) => {
    const out: GenEvent[] = []
    for await (const e of runCli('claude', { system: 's', user: 'u' }, ac.signal, { env: { FAKE_MODE: 'slow' }, onSpawn: (s) => pids.push(s.pid) })) {
      out.push(e)
      if (e.type === 'text') firstText[i]!.r()
    }
    return out
  })
  await Promise.all([firstText[0]!.p, firstText[1]!.p])
  await new Promise((r) => setTimeout(r, 300))
  expect(pids).toHaveLength(2) // the third waits
  acs[0]!.abort()
  await firstText[2]!.p
  expect(pids).toHaveLength(3)
  acs[1]!.abort(); acs[2]!.abort()
  const outs = await Promise.all(runs)
  for (const o of outs) expect(o.at(-1)).toEqual({ type: 'done', stop: 'aborted' })
  for (const p of pids) expect(alive(p)).toBe(false)
})

test('aborting while queued never spawns', async () => {
  const hold = [new AbortController(), new AbortController()]
  const started: Promise<void>[] = []
  const runs = hold.map((ac) => {
    let r!: () => void
    started.push(new Promise<void>((res) => { r = res }))
    return (async () => { for await (const e of runCli('claude', { system: 's', user: 'u' }, ac.signal, { env: { FAKE_MODE: 'slow' } })) if (e.type === 'text') r() })()
  })
  await Promise.all(started)
  const queued = new AbortController()
  let spawned = false
  const q = collect({ env: { FAKE_MODE: 'slow' }, onSpawn: () => { spawned = true } }, { system: 's', user: 'u' }, queued.signal)
  await new Promise((r) => setTimeout(r, 100))
  queued.abort()
  expect(await q).toEqual([{ type: 'done', stop: 'aborted' }])
  expect(spawned).toBe(false)
  hold.forEach((ac) => ac.abort())
  await Promise.all(runs)
})
