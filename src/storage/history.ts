/**
 * On-device lesson history (IndexedDB via idb-keyval): `lesson:<id>` holds `{log, summary}`, `index` the
 * summaries, `active` the id of the lesson to resume after a refresh. Only lesson data is stored; never an
 * API key or anything from the key store (summaries are rebuilt from a whitelist of fields).
 * Writes are serialised so a late save can never overtake a later delete.
 */
import { del, get, keys, set } from 'idb-keyval'
import type { LessonEvent } from '../lesson/events'

export type SourceRef =
  | { kind: 'recording'; file?: string; slug?: string }
  | { kind: 'live'; sourceId: string; provider?: string; model?: string }

export type Summary = {
  id: string
  topic: string
  createdAt: string
  badgeText: string
  done: boolean
  source: SourceRef
}

export type SummaryInput = Omit<Summary, 'id' | 'source'> & { source?: SourceRef }

const INDEX = 'index'
const ACTIVE = 'active'
const lessonKey = (id: string) => `lesson:${id}`

let chain: Promise<unknown> = Promise.resolve()
/** Runs `job` after every earlier write; its failure never blocks the queue. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job)
  chain = run.catch(() => {})
  return run
}

const READ_TIMEOUT_MS = 3000
/** A read that never settles (blocked IndexedDB) rejects, so the UI can say history is unavailable. */
function timed<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('history: storage timed out')), READ_TIMEOUT_MS)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

const str = (v: unknown): v is string => typeof v === 'string'

function cleanSource(v: unknown): SourceRef {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  if (r.kind === 'live' && str(r.sourceId)) {
    return { kind: 'live', sourceId: r.sourceId, ...(str(r.provider) ? { provider: r.provider } : {}), ...(str(r.model) ? { model: r.model } : {}) }
  }
  return { kind: 'recording', ...(str(r.file) ? { file: r.file } : {}), ...(str(r.slug) ? { slug: r.slug } : {}) }
}

function cleanSummary(v: unknown, id?: string): Summary | null {
  const r = (v && typeof v === 'object' ? v : null) as Record<string, unknown> | null
  const sid = id ?? r?.id
  if (!r || !str(sid) || !str(r.topic) || !str(r.createdAt) || !str(r.badgeText) || typeof r.done !== 'boolean') return null
  return { id: sid, topic: r.topic, createdAt: r.createdAt, badgeText: r.badgeText, done: r.done, source: cleanSource(r.source) }
}

const validLog = (v: unknown): v is LessonEvent[] =>
  Array.isArray(v) && v.length > 0 && v.every((e) => !!e && typeof e === 'object' && str((e as { type?: unknown }).type))

/** Saves (replaces) a lesson and its index entry. Failures are swallowed: history is best effort. */
export function saveLesson(id: string, log: LessonEvent[], summary: SummaryInput): Promise<void> {
  const clean = cleanSummary({ ...summary, id }, id)
  if (!clean) return Promise.resolve()
  return enqueue(async () => {
    await set(lessonKey(id), { log, summary: clean })
    const index = await readIndex()
    await set(INDEX, [...index.filter((s) => s.id !== id), clean])
  }).catch(() => {})
}

async function readIndex(): Promise<Summary[]> {
  const raw = await get<unknown>(INDEX)
  if (!Array.isArray(raw)) return []
  return raw.flatMap((x) => cleanSummary(x) ?? [])
}

/** Newest first. Rejects when storage is unavailable (the History screen says so). */
export const listLessons = (): Promise<Summary[]> => timed(listAll())
async function listAll(): Promise<Summary[]> {
  await chain
  const list = await readIndex()
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

/** The stored log and summary, or null when missing or corrupt. */
export const loadEntry = (id: string) => timed(readEntry(id))
async function readEntry(id: string): Promise<{ log: LessonEvent[]; summary: Summary | null } | null> {
  await chain
  const raw = await get<{ log?: unknown; summary?: unknown }>(lessonKey(id))
  if (!raw || !validLog(raw.log)) return null
  return { log: raw.log, summary: cleanSummary(raw.summary, id) }
}

export async function loadLesson(id: string): Promise<LessonEvent[]> {
  return (await loadEntry(id))?.log ?? []
}

export const getActive = (): Promise<string | null> => timed(readActive())
async function readActive(): Promise<string | null> {
  await chain
  const v = await get<unknown>(ACTIVE)
  return str(v) ? v : null
}

export function setActive(id: string | null): Promise<void> {
  return enqueue(async () => {
    if (id === null) await del(ACTIVE)
    else await set(ACTIVE, id)
  }).catch(() => {})
}

export function deleteLesson(id: string): Promise<void> {
  return enqueue(async () => {
    await del(lessonKey(id))
    await set(INDEX, (await readIndex()).filter((s) => s.id !== id))
    if ((await get<unknown>(ACTIVE)) === id) await del(ACTIVE)
  }).catch(() => {})
}

export function deleteAll(): Promise<void> {
  return enqueue(async () => {
    for (const k of await keys()) if (str(k) && k.startsWith('lesson:')) await del(k)
    await del(INDEX)
    await del(ACTIVE)
  }).catch(() => {})
}
