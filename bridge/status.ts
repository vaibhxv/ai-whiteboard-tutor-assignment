/**
 * Preflight for both CLIs: installed, version, signed in, plan type. `claude auth status` prints the
 * account's email and organisation too; only `loggedIn` and `subscriptionType` are read, so nothing else
 * can leave this function.
 */
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { BridgeStatus, CliStatus } from '../src/sources/types'
import { childEnv, cliCommand } from './spawn'
import type { Cli } from './spawn'

type Ran = { missing: boolean; code: number | null; stdout: string; stderr: string }

function run(cli: Cli, args: string[], extraEnv: Record<string, string> | undefined, timeoutMs: number): Promise<Ran> {
  const c = cliCommand(cli, args)
  return new Promise((resolve) => {
    execFile(c.cmd, c.args, {
      cwd: tmpdir(), env: { ...childEnv(process.env, cli), ...extraEnv }, timeout: timeoutMs, maxBuffer: 64 * 1024, windowsHide: true,
    }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null
      resolve({
        missing: e?.code === 'ENOENT',
        code: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
        stdout: String(stdout), stderr: String(stderr),
      })
    })
  })
}

const versionOf = (s: string) => /\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?/.exec(s)?.[0]

/** A plan name is a short word like "max" or "pro"; anything else is dropped rather than echoed. */
const planOf = (v: unknown) => (typeof v === 'string' && /^[a-z0-9_-]{1,32}$/i.test(v) ? v : undefined)

async function claudeStatus(env: Record<string, string> | undefined, t: number): Promise<CliStatus> {
  const v = await run('claude', ['--version'], env, t)
  if (v.missing || v.code !== 0) return { installed: false }
  const out: CliStatus = { installed: true }
  const version = versionOf(v.stdout)
  if (version) out.version = version
  const a = await run('claude', ['auth', 'status'], env, t)
  let loggedIn: unknown
  let subscriptionType: unknown
  try {
    const j = JSON.parse(a.stdout) as { loggedIn?: unknown; subscriptionType?: unknown }
    loggedIn = j.loggedIn
    subscriptionType = j.subscriptionType
  } catch { /* not JSON: treat as signed out */ }
  out.signedIn = loggedIn === true
  const plan = out.signedIn ? planOf(subscriptionType) : undefined
  if (plan) out.plan = plan
  return out
}

async function codexStatus(env: Record<string, string> | undefined, t: number): Promise<CliStatus> {
  const v = await run('codex', ['--version'], env, t)
  if (v.missing || v.code !== 0) return { installed: false }
  const out: CliStatus = { installed: true }
  const version = versionOf(v.stdout)
  if (version) out.version = version
  const l = await run('codex', ['login', 'status'], env, t)
  out.signedIn = l.code === 0
  return out
}

/** `env` is a test seam (extra child variables); the server never passes it. */
export async function getStatus(opts: { env?: Record<string, string>; timeoutMs?: number } = {}): Promise<BridgeStatus> {
  const t = opts.timeoutMs ?? 15_000
  const [claude, codex] = await Promise.all([claudeStatus(opts.env, t), codexStatus(opts.env, t)])
  return { claude, codex }
}
