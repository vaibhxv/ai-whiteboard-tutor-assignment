// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]))
}

test('public build contains no bridge code', { timeout: 180_000 }, () => {
  const out = mkdtempSync(join(tmpdir(), 'whyboard-public-build-'))
  try {
    const env = { ...process.env }
    delete env.WHYBOARD_LOCAL
    delete env.BRIDGE_TOKEN
    execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
      env, stdio: 'pipe',
    })
    const files = walk(out).filter((f) => /\.(js|html|css)$/.test(f))
    expect(files.some((f) => f.endsWith('.js'))).toBe(true)
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      for (const needle of ['whyboard-bridge-token', '/bridge/generate', '/bridge/status', 'x-whyboard-token']) {
        expect(text.includes(needle), `${needle} in ${f}`).toBe(false)
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})
