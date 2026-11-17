import { clear, entries } from 'idb-keyval'
import { beforeEach, describe, expect, test } from 'vitest'
import type { LessonEvent } from '../../../src/lesson/events'
import { replay } from '../../../src/lesson/machine'
import { deleteAll, deleteLesson, getActive, listLessons, loadLesson, saveLesson, setActive } from '../../../src/storage/history'
import { advance, fill, segPlan, start } from '../lesson/helpers'

const log: LessonEvent[] = [
  start,
  { type: 'plan/record', record: segPlan(1) }, { type: 'plan/record', record: segPlan(2) },
  { type: 'plan/done' },
  ...fill('seg:1', 2, 'c1'),
  ...advance(2), { type: 'check/skip', checkId: 'c1' },
  { type: 'seg/stream', key: 'seg:2' },
  { type: 'seg/beat', key: 'seg:2', beat: { id: 'seg:2#0', say: 'x', ink: 'lesson', actions: [] } },
]
const sum = (id: string, createdAt: string, done = false) => ({
  topic: `t-${id}`, createdAt, badgeText: 'RECORDED · m · captured 1 Nov 2026', done, source: { kind: 'recording' as const, slug: 'vertex' },
})

beforeEach(async () => { await clear() })

describe('history storage', () => {
  test('save → list → load round-trips the log (fake-indexeddb)', async () => {
    await saveLesson('a', log, sum('a', '2026-11-01T10:00:00Z'))
    await saveLesson('b', log.slice(0, 4), sum('b', '2026-11-05T10:00:00Z', true))
    const list = await listLessons()
    expect(list.map((s) => s.id)).toEqual(['b', 'a'])
    expect(list[0]).toMatchObject({ topic: 't-b', done: true })
    expect(await loadLesson('a')).toEqual(log)
    await saveLesson('a', log.slice(0, 5), sum('a', '2026-11-01T10:00:00Z'))
    expect((await listLessons()).length).toBe(2)
    expect(await loadLesson('a')).toHaveLength(5)
  })

  test('deleteAll leaves no lesson:* keys; deleteLesson removes one and clears active', async () => {
    await saveLesson('a', log, sum('a', '2026-11-01T10:00:00Z'))
    await saveLesson('b', log, sum('b', '2026-11-02T10:00:00Z'))
    await setActive('a')
    await deleteLesson('a')
    expect((await listLessons()).map((s) => s.id)).toEqual(['b'])
    expect(await getActive()).toBeNull()
    await setActive('b')
    await deleteAll()
    const keys = (await entries()).map(([k]) => String(k))
    expect(keys.filter((k) => k.startsWith('lesson:'))).toEqual([])
    expect(await listLessons()).toEqual([])
    expect(await getActive()).toBeNull()
  })

  test('active id round-trips', async () => {
    expect(await getActive()).toBeNull()
    await setActive('x')
    expect(await getActive()).toBe('x')
    await setActive(null)
    expect(await getActive()).toBeNull()
  })

  test('resume: a log ending mid-stream of seg:2 replays to seg:2 pending, cursor unchanged', async () => {
    await saveLesson('a', log, sum('a', '2026-11-01T10:00:00Z'))
    const loaded = await loadLesson('a')
    const before = replay(loaded)
    expect(before.segments['seg:2']?.status).toBe('streaming')
    const after = replay([...loaded, { type: 'lesson/resumed' }])
    expect(after.segments['seg:2']?.status).toBe('pending')
    expect(after.segments['seg:2']?.beats).toEqual([])
    expect(after.cursor).toEqual(before.cursor)
  })

  test('API keys never appear in any stored value', async () => {
    const KEY = 'sk-test-SECRET-123'
    const secretive = { ...sum('a', '2026-11-01T10:00:00Z'), apiKey: KEY } as ReturnType<typeof sum>
    sessionStorage.setItem('whyboard.key.anthropic', KEY)
    await saveLesson('a', log, secretive)
    await setActive('a')
    const all = JSON.stringify(await entries())
    expect(all).not.toContain(KEY)
    expect(all).not.toContain('apiKey')
  })

  test('corrupt entries are skipped', async () => {
    const { set } = await import('idb-keyval')
    await set('index', [{ id: 'bad' }, null, { id: 'ok', topic: 't', createdAt: '2026-11-01T00:00:00Z', badgeText: 'b', done: false, source: { kind: 'recording' } }])
    await set('lesson:ok', { log: [{ nope: 1 }], summary: {} })
    const list = await listLessons()
    expect(list.map((s) => s.id)).toEqual(['ok'])
    expect(await loadLesson('ok')).toEqual([])
    expect(await loadLesson('missing')).toEqual([])
  })
})
