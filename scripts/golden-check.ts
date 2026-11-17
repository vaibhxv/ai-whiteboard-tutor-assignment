/**
 * Quick check of recorded lessons (Task 21 adds the formal golden tests):
 *   npx tsx scripts/golden-check.ts [slug ...]
 * 1. Every recorded response is re-run through the recorder's own validators, in the context the recorder
 *    built for it (0 rejects, 0 failed verifications, checks present, not truncated). The recorder is
 *    pointed at the file instead of the model, with one attempt per intent, so any bad text throws.
 * 2. The all-correct path is played from the start to the recap with the real controller and the replay
 *    source, and must finish with no error.
 */
import { readFileSync } from 'node:fs'
import { createController } from '../src/lesson/controller'
import { activeCheck } from '../src/lesson/selectors'
import { createLessonStore } from '../src/lesson/store'
import { RecordingSchema } from '../src/sources/recording'
import { createReplaySource } from '../src/sources/replay'
import { recordLesson } from './record-lib'

const slugs = process.argv.slice(2).length ? process.argv.slice(2) : ['vertex', 'slope', 'balance']

async function until(pred: () => boolean, what: string, ms = 20_000) {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function main() {
  let bad = 0
  for (const slug of slugs) {
    try {
      const rec = RecordingSchema.parse(JSON.parse(readFileSync(`public/recordings/${slug}.json`, 'utf8')))
      const topic = (await import('../src/recordings/manifest')).manifest.find((m) => m.slug === slug)?.title ?? slug
      // 1. every response, in context
      const { recording } = await recordLesson({
        topic, title: rec.meta.title, maxAttempts: 1, capturedAt: rec.meta.capturedAt,
        generate: async (_r, intent) => {
          const r = rec.responses[intent]
          if (!r) throw new Error(`recording has no "${intent}"`)
          return { text: r.text, stop: 'end', model: rec.meta.model }
        },
      })
      const missing = Object.keys(rec.responses).filter((k) => !(k in recording.responses))
      const extra = Object.keys(recording.responses).filter((k) => !(k in rec.responses))
      if (missing.length || extra.length) throw new Error(`intent set differs: missing ${missing.join(',')} extra ${extra.join(',')}`)
      for (const k of Object.keys(rec.responses)) if (recording.responses[k]?.text !== rec.responses[k]?.text) throw new Error(`${k} text changed`)

      // 2. the all-correct play-through with the real controller
      const store = createLessonStore()
      const ctl = createController({ store, source: createReplaySource(rec, { chunkChars: 100000, intervalMs: 0 }), now: () => Date.now() })
      await ctl.start({ topic: rec.meta.title })
      const st = () => store.getState().state
      const dispatch = store.getState().dispatch
      if (st()?.phase === 'warmup') dispatch({ type: 'warmup/skip' })
      let checks = 0
      for (let guard = 0; guard < 400 && st()?.phase !== 'recap'; guard++) {
        const s = st()
        if (!s) throw new Error('no state')
        if (s.overlay?.kind === 'problem') throw new Error(`problem overlay: ${s.overlay.error.message}`)
        if (s.phase === 'checkpoint') {
          const c = activeCheck(s)
          if (!c) throw new Error('checkpoint without a check')
          const branch = c.kind === 'choice' ? (c.options.find((o) => o.correct)?.id ?? 'correct') : 'correct'
          dispatch({ type: 'check/answer', checkId: c.id, grade: { result: 'correct', branch } })
          checks++
        } else {
          const seg = s.segments[s.cursor.seg]
          if (seg && (seg.status === 'complete' || s.cursor.beat < seg.beats.length)) dispatch({ type: 'player/advance' })
          else await new Promise((r) => setTimeout(r, 5))
        }
      }
      const fin = st()
      if (fin?.phase !== 'recap') throw new Error(`never reached the recap (phase ${fin?.phase})`)
      await until(() => st()?.recap?.status === 'complete' || st()?.recap?.status === 'failed', 'the recap')
      if (st()?.recap?.status !== 'complete') throw new Error('recap failed')
      if (st()?.overlay?.kind === 'problem') throw new Error('problem overlay at the end')
      const all = Object.values(st()?.segments ?? {})
      if (all.some((g) => g.status !== 'complete')) throw new Error('a segment did not complete')
      ctl.dispose()
      console.log(`${slug}: ok. ${Object.keys(rec.responses).length} responses revalidated in context; played ${checks} checkpoints to the recap (${st()?.recap?.ideas.length} ideas, ${st()?.recap?.practice.length} practice checks); model ${rec.meta.model}`)
    } catch (e) {
      bad++
      console.error(`${slug}: FAILED ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  process.exit(bad ? 1 : 0)
}

void main()
