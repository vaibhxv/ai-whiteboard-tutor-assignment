/**
 * Records one starter lesson through the owner's own Claude Code subscription:
 *   npm run record -- --slug vertex --title "…" --topic "…" [--model sonnet] [--max-attempts 3] [--fresh]
 * Writes public/recordings/<slug>.json and prints the number of calls and the total seconds. Accepted
 * responses are also kept in node_modules/.cache/whyboard-record/<slug>.json while it runs, so a run
 * stopped by a usage limit resumes without repeating calls (pass --fresh to ignore it).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { runCli } from '../bridge/spawn'
import { SourceError } from '../src/sources/errors'
import type { Role } from '../src/sources/types'
import { RecordError, recordLesson } from './record-lib'
import type { GenResult, RecordedEntry } from './record-lib'
import { SYSTEM_PROMPT } from '../src/prompts/system'

const CALL_TIMEOUT_MS = 300_000

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

export function claudeGenerate(model: string) {
  return async (_role: Role, _intent: string, user: string): Promise<GenResult> => {
    let text = ''
    let stop: 'end' | 'length' | 'aborted' = 'aborted'
    let seen = ''
    for await (const e of runCli('claude', { system: SYSTEM_PROMPT, user, model }, new AbortController().signal, { timeoutMs: CALL_TIMEOUT_MS })) {
      if (e.type === 'meta') seen = e.model
      else if (e.type === 'text') text += e.text
      else if (e.type === 'done') stop = e.stop
      else if (e.type === 'error') throw new SourceError(e.kind, e.detail)
    }
    return { text, stop, ...(seen ? { model: seen } : {}) }
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const slug = arg(argv, 'slug')
  const title = arg(argv, 'title')
  const topic = arg(argv, 'topic')
  if (!slug || !title || !topic || !/^[a-z0-9-]+$/.test(slug)) {
    console.error('usage: npm run record -- --slug <slug> --title "<title>" --topic "<topic>" [--model sonnet] [--max-attempts 3] [--fresh]')
    process.exit(2)
  }
  const model = arg(argv, 'model') ?? 'sonnet'
  const maxAttempts = Number(arg(argv, 'max-attempts') ?? 3)
  const cache = resolve('node_modules/.cache/whyboard-record', `${slug}.json`)
  type Cache = { entries: Record<string, RecordedEntry>; failures: Record<string, number> }
  const prev: Cache = !argv.includes('--fresh') && existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8')) : { entries: {}, failures: {} }
  const seed = prev.entries
  const kept: Cache = { entries: { ...prev.entries }, failures: { ...prev.failures } }
  const save = () => {
    mkdirSync(dirname(cache), { recursive: true })
    writeFileSync(cache, JSON.stringify(kept))
  }
  const t0 = Date.now()
  let n = 0
  try {
    const { recording, stats } = await recordLesson({
      topic, title, maxAttempts, seed, failures: prev.failures, concurrency: 2,
      generate: claudeGenerate(model),
      onAccepted: (intent, entry) => {
        kept.entries[intent] = entry
        save()
      },
      onFailed: (intent, total) => {
        kept.failures[intent] = total
        save()
      },
      log: (line) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`),
    })
    n = stats.calls
    const out = resolve('public/recordings', `${slug}.json`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(recording, null, 2) + '\n')
    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    console.log(`\nwrote ${out}`)
    console.log(`${Object.keys(recording.responses).length} responses, ${n} calls (${stats.reused} reused), ${secs} s, model ${recording.meta.model}`)
    console.log(recording.meta.selection)
  } catch (e) {
    const kind = e instanceof SourceError ? e.kind : e instanceof RecordError ? 'record' : 'unknown'
    console.error(`\nstopped (${kind}): ${e instanceof Error ? e.message : String(e)}`)
    console.error(`accepted so far: ${Object.keys(kept.entries).length} responses, kept in ${cache}; run the same command to resume.`)
    process.exit(1)
  }
}

void main()
