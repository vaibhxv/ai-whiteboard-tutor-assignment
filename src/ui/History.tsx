import { useCallback, useEffect, useState } from 'react'
import { deleteAll, deleteLesson } from '../storage/history'
import type { Summary } from '../storage/history'
import { formatDate } from '../sources/types'
import { endSession, listLessons, openLesson, sessionStore, useSession } from './session'
import { useUi } from './store'

type Load = { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; items: Summary[] }

export function History() {
  const go = useUi((s) => s.go)
  const inLesson = useSession((s) => !!s.session)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [confirm, setConfirm] = useState<string | 'all' | null>(null)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setLoad({ status: 'ready', items: await listLessons() })
    } catch {
      setLoad({ status: 'unavailable' })
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const remove = async (id: string | 'all') => {
    // Stop the open lesson's persistor first, so no late save can resurrect what is being deleted.
    const cur = sessionStore.getState().session
    if (cur && (id === 'all' || cur.store.getState().state?.id === id)) endSession(true)
    if (id === 'all') await deleteAll()
    else await deleteLesson(id)
    setConfirm(null)
    await refresh()
  }
  const open = async (id: string) => {
    setFailed(false)
    if (!(await openLesson(id))) setFailed(true)
  }

  return (
    <main className="history" id="main">
      <h2>History</h2>
      <button type="button" onClick={() => go(inLesson ? 'lesson' : 'home')}>{inLesson ? 'Back to lesson' : 'Back'}</button>
      {load.status === 'loading' ? <p className="helper">Loading…</p> : null}
      {load.status === 'unavailable' ? <p className="notice">History isn't available in this browser.</p> : null}
      {failed ? <p className="notice" role="alert">Couldn't open that lesson.</p> : null}
      {load.status === 'ready' && load.items.length === 0 ? <p className="helper">No lessons yet. Finished and unfinished lessons appear here.</p> : null}
      {load.status === 'ready' && load.items.length > 0 ? (
        <>
          <ul className="history-list">
            {load.items.map((it) => (
              <li key={it.id} className="history-item">
                <h3>{it.topic}</h3>
                <p className="helper">{formatDate(it.createdAt)} · {it.badgeText} · {it.done ? 'Done' : 'In progress'}</p>
                {confirm === it.id ? (
                  <p role="group" aria-label={`Delete ${it.topic}`}>
                    Delete this lesson?{' '}
                    <button type="button" onClick={() => void remove(it.id)}>Yes</button>{' '}
                    <button type="button" onClick={() => setConfirm(null)}>No</button>
                  </p>
                ) : (
                  <p>
                    <button type="button" aria-label={`Open ${it.topic}`} onClick={() => void open(it.id)}>Open</button>{' '}
                    <button type="button" aria-label={`Delete ${it.topic}`} onClick={() => setConfirm(it.id)}>Delete</button>
                  </p>
                )}
              </li>
            ))}
          </ul>
          {confirm === 'all' ? (
            <p role="group" aria-label="Delete all lessons">
              Delete all lessons?{' '}
              <button type="button" onClick={() => void remove('all')}>Yes</button>{' '}
              <button type="button" onClick={() => setConfirm(null)}>No</button>
            </p>
          ) : (
            <button type="button" onClick={() => setConfirm('all')}>Delete all</button>
          )}
        </>
      ) : null}
    </main>
  )
}
