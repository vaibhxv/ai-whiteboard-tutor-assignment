/**
 * Runs the user's own `claude` / `codex` binary for one request and turns its output into GenEvents.
 * Argument array (never a shell), prompt on stdin, a fresh empty temp directory as cwd, an allowlisted
 * environment (no API keys, no parent-session variables). The child is killed on abort, on early exit by
 * the consumer and after a timeout; the temp directory is always removed. At most 2 children per CLI.
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scrub } from '../src/sources/http'
import type { GenEvent } from '../src/sources/types'
import { CLAUDE_DEFAULT_MODEL, claudeArgs, claudeErrorKind, parseClaudeLine } from './claude'
import type { ClaudeState } from './claude'
import { codexArgs, codexErrorKind, parseCodexLine } from './codex'

export type Cli = 'claude' | 'codex'
export type CliRequest = { system: string; user: string; model?: string }

export const MODEL_ALLOW: Record<Cli, readonly string[]> = {
  claude: ['sonnet', 'opus', 'haiku', 'fable', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
  codex: ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna'],
}

export const TIMEOUT_MS = 180_000
export const MAX_PER_CLI = 2

const COMMON_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM']
const CLI_ENV: Record<Cli, string[]> = { claude: ['CLAUDE_CONFIG_DIR'], codex: ['CODEX_HOME'] }

/**
 * The child's environment, from an allowlist only: API keys (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
 * OPENAI_API_KEY, CODEX_API_KEY) and parent-session markers (CLAUDECODE, CLAUDE_CODE_ENTRYPOINT) never
 * pass, so the CLI uses the user's own subscription login.
 */
export function childEnv(base: NodeJS.ProcessEnv, cli: Cli): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const k of [...COMMON_ENV, ...CLI_ENV[cli]]) if (base[k] !== undefined) env[k] = base[k]
  if (cli === 'claude') env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
  return env
}

/** The command for a CLI. WHYBOARD_CLAUDE_BIN / WHYBOARD_CODEX_BIN override it (tests use fake CLIs). */
export function cliCommand(cli: Cli, args: string[]): { cmd: string; args: string[] } {
  const bin = (cli === 'claude' ? process.env.WHYBOARD_CLAUDE_BIN : process.env.WHYBOARD_CODEX_BIN) || cli
  // A script override runs under this Node, so it needs no executable bit or shebang lookup.
  if (/\.(m?js)$/.test(bin)) return { cmd: process.execPath, args: [bin, ...args] }
  return { cmd: bin, args }
}

export type RunOpts = {
  timeoutMs?: number
  /** Called once the child is running. */
  onSpawn?(info: { pid: number; cwd: string }): void
  /** Every raw stdout line (the smoke script saves them). */
  onLine?(line: string): void
  /** Test seam: extra variables for the child, added after the allowlist. The server never passes it. */
  env?: Record<string, string>
}

// --------------------------------------------------------------------------------- concurrency limit

const slots: Record<Cli, { active: number; waiting: (() => void)[] }> = {
  claude: { active: 0, waiting: [] },
  codex: { active: 0, waiting: [] },
}

/** Waits for a slot. Resolves to a release function, or null if aborted while waiting. */
function acquire(cli: Cli, signal: AbortSignal): Promise<(() => void) | null> {
  const s = slots[cli]
  let released = false
  const release = () => {
    if (released) return
    released = true
    s.active--
    s.waiting.shift()?.()
  }
  if (s.active < MAX_PER_CLI) {
    s.active++
    return Promise.resolve(release)
  }
  return new Promise((resolve) => {
    const go = () => {
      signal.removeEventListener('abort', onAbort)
      s.active++
      resolve(release)
    }
    const onAbort = () => {
      const i = s.waiting.indexOf(go)
      if (i >= 0) s.waiting.splice(i, 1)
      resolve(null)
    }
    s.waiting.push(go)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// ------------------------------------------------------------------------------------------ the run

type Item =
  | { k: 'line'; line: string }
  | { k: 'close'; code: number | null; sig: NodeJS.Signals | null }
  | { k: 'error'; err: NodeJS.ErrnoException }
  | { k: 'wake' }

/** A tiny async queue: the child's callbacks push, the generator awaits. */
function queue() {
  const items: Item[] = []
  let wake: (() => void) | null = null
  return {
    push(i: Item) { items.push(i); wake?.(); wake = null },
    async next(): Promise<Item> {
      while (items.length === 0) await new Promise<void>((r) => { wake = r })
      return items.shift()!
    },
  }
}

const exited = (c: ChildProcess) => c.exitCode !== null || c.signalCode !== null

async function stop(child: ChildProcess, closed: Promise<void>): Promise<void> {
  if (exited(child)) return closed
  child.kill('SIGTERM')
  const graceful = await Promise.race([closed.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 2000))])
  if (!graceful) {
    child.kill('SIGKILL')
    await Promise.race([closed, new Promise<void>((r) => setTimeout(r, 2000))])
  }
}

export async function* runCli(cli: Cli, req: CliRequest, signal: AbortSignal, opts: RunOpts = {}): AsyncGenerator<GenEvent> {
  if (signal.aborted) { yield { type: 'done', stop: 'aborted' }; return }
  const release = await acquire(cli, signal)
  if (!release) { yield { type: 'done', stop: 'aborted' }; return }

  let cwd: string | undefined
  let child: ChildProcess | undefined
  let closed: Promise<void> = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | undefined
  const q = queue()
  let aborted = false
  let timedOut = false
  let spawnFailed = false
  const onAbort = () => { aborted = true; q.push({ k: 'wake' }) }
  try {
    cwd = await mkdtemp(join(tmpdir(), `whyboard-${cli}-`))
    const model = req.model ?? (cli === 'claude' ? CLAUDE_DEFAULT_MODEL : undefined)
    const args = cli === 'claude'
      ? claudeArgs({ model: model ?? CLAUDE_DEFAULT_MODEL, system: req.system })
      : codexArgs({ system: req.system, cwd, ...(model ? { model } : {}) })
    const cmd = cliCommand(cli, args)
    const st: ClaudeState = cli === 'codex' && model ? { model } : {}
    const parse = (o: unknown) => (cli === 'claude' ? parseClaudeLine(o, st) : parseCodexLine(o, st))

    child = spawn(cmd.cmd, cmd.args, {
      cwd, env: { ...childEnv(process.env, cli), ...opts.env }, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true,
    })
    const c = child
    closed = new Promise<void>((r) => c.once('close', () => r()))
    let buf = ''
    let stderr = ''
    c.stdout!.setEncoding('utf8')
    c.stdout!.on('data', (d: string) => {
      buf += d
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      for (const line of parts) q.push({ k: 'line', line })
    })
    c.stderr!.setEncoding('utf8')
    c.stderr!.on('data', (d: string) => { if (stderr.length < 8192) stderr += d })
    c.on('error', (err: NodeJS.ErrnoException) => { if (c.pid === undefined) spawnFailed = true; q.push({ k: 'error', err }) })
    c.on('close', (code, sig) => {
      if (buf) q.push({ k: 'line', line: buf })
      buf = ''
      q.push({ k: 'close', code, sig })
    })
    c.stdin!.on('error', () => { /* the child may exit before reading everything */ })
    c.stdin!.end(req.user)
    if (c.pid !== undefined) opts.onSpawn?.({ pid: c.pid, cwd })
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    const limit = opts.timeoutMs ?? TIMEOUT_MS
    timer = setTimeout(() => { timedOut = true; q.push({ k: 'wake' }) }, limit)

    for (;;) {
      if (aborted) { yield { type: 'done', stop: 'aborted' }; return }
      if (timedOut) {
        yield { type: 'error', kind: 'unknown', detail: `The ${cli} command took longer than ${Math.round(limit / 1000)} s and was stopped.` }
        return
      }
      const item = await q.next()
      if (item.k === 'wake') continue
      if (item.k === 'error') {
        if (item.err.code === 'ENOENT') {
          yield { type: 'error', kind: 'cli-missing', detail: `The ${cli} command was not found on this computer.` }
        } else {
          yield { type: 'error', kind: 'unknown', detail: scrub(`Could not start ${cli}: ${item.err.message}`) }
        }
        return
      }
      if (item.k === 'line') {
        opts.onLine?.(item.line)
        if (!item.line.trim()) continue
        let o: unknown
        try { o = JSON.parse(item.line) } catch { continue }
        for (const e of parse(o)) {
          if (aborted) break
          yield e
          if (e.type === 'done' || e.type === 'error') return
        }
        continue
      }
      // close without a final event
      if (aborted) continue
      if (item.code === 0) { yield { type: 'done', stop: 'length' }; return }
      const kind = cli === 'claude' ? claudeErrorKind(stderr) : codexErrorKind(stderr)
      const how = item.code !== null ? `exit ${item.code}` : `signal ${item.sig ?? 'unknown'}`
      yield { type: 'error', kind, detail: scrub(`${cli} stopped (${how}). ${stderr.trim()}`.trim()) }
      return
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    if (child && !spawnFailed) await stop(child, closed)
    if (cwd) await rm(cwd, { recursive: true, force: true }).catch(() => {})
    release()
  }
}
