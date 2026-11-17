/**
 * `npm run dev`: Whyboard on this computer, with the subscription path switched on.
 *   - makes a fresh random token for this run (the page gets it from a meta tag; other sites never do)
 *   - starts the loopback bridge (bridge/server.ts) and Vite with WHYBOARD_LOCAL=1
 *   - forwards their output, and stops both when either exits or on Ctrl-C / SIGTERM
 * Ports: BRIDGE_PORT (default 8787), VITE_PORT (default 5173).
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const BRIDGE_TOKEN = randomBytes(32).toString('hex')
const BRIDGE_PORT = process.env.BRIDGE_PORT ?? '8787'
const VITE_PORT = process.env.VITE_PORT ?? '5173'
const env = { ...process.env, WHYBOARD_LOCAL: '1', BRIDGE_TOKEN, BRIDGE_PORT, VITE_PORT }

const bin = (name: string) => join(root, 'node_modules', '.bin', name)
const children: ChildProcess[] = [
  spawn(process.execPath, [bin('tsx'), join(root, 'bridge', 'server.ts')], { cwd: root, env, stdio: 'inherit' }),
  spawn(process.execPath, [bin('vite'), '--port', VITE_PORT, '--strictPort'], { cwd: root, env, stdio: 'inherit' }),
]

let stopping = false
function stopAll(code: number): void {
  if (stopping) return
  stopping = true
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGTERM')
  const hard = setTimeout(() => {
    for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL')
    process.exit(code)
  }, 4000)
  hard.unref()
  Promise.all(children.map((c) => (c.exitCode !== null || c.signalCode !== null ? null : new Promise((r) => c.once('exit', r)))))
    .then(() => process.exit(code))
}

for (const c of children) {
  c.on('exit', (code) => stopAll(code ?? 1))
  c.on('error', (err) => { console.error(err.message); stopAll(1) })
}
process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))
process.on('exit', () => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL')
})
