import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, RotateCcw, X } from 'lucide-react'
import { errorCopy } from '../sources/errors'
import type { ErrorKind } from '../sources/errors'
import { compatProvider, createActiveSource } from '../sources/create'
import { keyStore } from '../sources/key-store'
import { PROVIDERS } from '../sources/providers'
import type { BridgeStatus } from '../sources/types'
import type { ProviderId, SourceId } from '../storage/settings'
import { useSession } from './session'
import { useUi } from './store'

export const RUN_LOCALLY_URL = 'https://github.com/vaibhxv/ai-whiteboard-tutor-assignment#run-locally'
const PUBLIC_ONLY_COPY = 'Only available when you run Whyboard on your own computer.'
const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[]

type Group = 'replay' | 'key' | 'claude-code' | 'codex'
const groupOf = (s: SourceId): Group => (s === 'anthropic' || s === 'openai-compatible' ? 'key' : s)

type CliLine = { ok: boolean; text: string }
/** The local bridge's view of both CLIs, as the lines shown under each subscription option. */
type CliCheck = { state: 'checking' } | { state: 'done'; lines: Record<'claude-code' | 'codex', CliLine> }

type TestState = { status: 'idle' } | { status: 'testing' } | { status: 'paste' } | { status: 'ok' } | { status: 'fail'; kind: ErrorKind }

export function Settings() {
  const settings = useUi((s) => s.settings)
  const update = useUi((s) => s.updateSettings)
  const go = useUi((s) => s.go)
  const inLesson = useSession((s) => !!s.session)
  const base = useId()
  const group = groupOf(settings.sourceId)
  const provider: ProviderId = settings.sourceId === 'anthropic' ? 'anthropic' : compatProvider(settings)
  const info = PROVIDERS[provider]
  const [key, setKey] = useState(() => keyStore.get(provider) ?? '')
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const local = __LOCAL__
  const [cli, setCli] = useState<CliCheck>({ state: 'checking' })
  const checkSeq = useRef(0)

  /** Reads `/bridge/status` (local runs only; the bridge client is never in the public bundle). */
  const checkClis = useCallback(() => {
    if (!__LOCAL__) return
    const mine = ++checkSeq.current
    setCli({ state: 'checking' })
    void import('../sources/bridge-client').then(async (m) => {
      let lines: Record<'claude-code' | 'codex', CliLine>
      try {
        const s: BridgeStatus = await m.getBridgeStatus(AbortSignal.timeout(20_000))
        lines = { 'claude-code': m.statusLine('claude', s.claude), codex: m.statusLine('codex', s.codex) }
      } catch {
        const down = { ok: false, text: m.BRIDGE_DOWN }
        lines = { 'claude-code': down, codex: down }
      }
      if (mine === checkSeq.current) setCli({ state: 'done', lines })
    }, () => {
      const down = { ok: false, text: "Couldn't check this computer's command-line apps. Reload the page." }
      if (mine === checkSeq.current) setCli({ state: 'done', lines: { 'claude-code': down, codex: down } })
    })
  }, [])
  useEffect(() => {
    checkClis()
    return () => { checkSeq.current++ } // a late answer after unmount is ignored
  }, [checkClis])

  const chooseGroup = (g: Group) => {
    if (g === 'key') pickProvider(settings.provider ?? 'gemini')
    else if (g === 'replay') update({ sourceId: g })
    else update({ sourceId: g, model: undefined }) // a model left over from an API key means nothing to a CLI
    setTest({ status: 'idle' })
  }
  const pickProvider = (p: ProviderId) => {
    update({ sourceId: p === 'anthropic' ? 'anthropic' : 'openai-compatible', provider: p, model: undefined })
    setKey(keyStore.get(p) ?? '')
    setTest({ status: 'idle' })
  }
  const onKey = (v: string) => {
    setKey(v)
    keyStore.set(provider, v, settings.keepKeyInTab)
    setTest({ status: 'idle' })
  }
  const onKeep = (on: boolean) => {
    update({ keepKeyInTab: on })
    if (key.trim()) keyStore.set(provider, key, on)
  }
  const runTest = async () => {
    const src = key.trim() ? createActiveSource(settings, keyStore) : null
    if (!src) { setTest({ status: 'paste' }); return }
    setTest({ status: 'testing' })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), 15_000) })
      const r = await Promise.race([src.preflight(), timeout])
      setTest(r.ready ? { status: 'ok' } : { status: 'fail', kind: (r.reason as ErrorKind) in errorKinds ? (r.reason as ErrorKind) : 'unknown' })
    } catch (e) {
      setTest({ status: 'fail', kind: (e as Error).message === 'timeout' ? 'offline' : 'unknown' })
    } finally {
      clearTimeout(timer)
    }
  }
  const forget = () => {
    keyStore.forget(provider)
    setKey('')
    setTest({ status: 'idle' })
  }

  const subscription = (g: 'claude-code' | 'codex', label: string) => (
    <div className="source-option">
      <label>
        <input
          type="radio" name={`${base}-source`} checked={group === g} disabled={!local}
          aria-describedby={`${base}-${g}-note`} onChange={() => chooseGroup(g)}
        />{' '}
        {label}
      </label>
      <p id={`${base}-${g}-note`} className="helper source-desc">
        {local ? (
          <span role="status" className={`cli-line${cli.state === 'done' ? (cli.lines[g].ok ? ' is-ok' : ' is-off') : ''}`}>
            {cli.state === 'checking' ? 'Checking…' : (
              <>{cli.lines[g].ok
                ? <Check size={16} strokeWidth={2.5} aria-hidden="true" />
                : <X size={16} strokeWidth={2.5} aria-hidden="true" />}{cli.lines[g].text}</>
            )}
          </span>
        ) : (
          <>{PUBLIC_ONLY_COPY}{' '}<a href={RUN_LOCALLY_URL} target="_blank" rel="noopener noreferrer">How to run it locally</a></>
        )}
      </p>
    </div>
  )

  return (
    <main className="settings" id="main">
      <h2>Settings</h2>
      {inLesson ? <p className="helper">Changes apply to your next lesson. The one in progress keeps its source.</p> : null}

      <fieldset className="source-choice">
        <legend>Where the lessons come from</legend>
        <p className="helper source-lead">Applies to your next lesson.</p>
        <div className="source-option">
          <label>
            <input
              type="radio" name={`${base}-source`} checked={group === 'replay'} aria-describedby={`${base}-replay-note`}
              onChange={() => chooseGroup('replay')}
            />{' '}
            Recorded lessons
          </label>
          <p id={`${base}-replay-note`} className="helper source-desc">Real model output, replayed. Works with no setup.</p>
        </div>
        <div className="source-option">
          <label>
            <input
              type="radio" name={`${base}-source`} checked={group === 'key'} aria-describedby={`${base}-key-note`}
              onChange={() => chooseGroup('key')}
            />{' '}
            My API key
          </label>
          <p id={`${base}-key-note`} className="helper source-desc">
            Anthropic, OpenAI, Google Gemini, OpenRouter or Groq. Sent straight from your browser to that provider.
          </p>
        </div>
        {subscription('claude-code', 'Claude Code subscription (this computer)')}
        {subscription('codex', 'Codex subscription (this computer)')}
        {local ? (
          <button type="button" className="check-again" onClick={checkClis} disabled={cli.state === 'checking'}>
            <RotateCcw size={16} aria-hidden="true" />Check again
          </button>
        ) : null}
      </fieldset>

      {group === 'key' ? (
        <section className="key-panel" aria-labelledby={`${base}-key-h`}>
          <h3 id={`${base}-key-h`}>Your API key</h3>
          <div className="field">
            <label htmlFor={`${base}-provider`}>Provider</label>{' '}
            <select id={`${base}-provider`} value={provider} onChange={(e) => pickProvider(e.target.value as ProviderId)}>
              {PROVIDER_IDS.map((p) => <option key={p} value={p}>{PROVIDERS[p].label}</option>)}
            </select>
          </div>
          {info.freeNote ? <p className="helper">{info.freeNote}</p> : null}
          <div className="field">
            <label htmlFor={`${base}-key`}>API key</label>{' '}
            <input
              id={`${base}-key`} type="password" autoComplete="off" spellCheck={false} value={key}
              onChange={(e) => onKey(e.target.value)}
            />
          </div>
          <div className="field">
            <label>
              <input type="checkbox" checked={settings.keepKeyInTab} onChange={(e) => onKeep(e.target.checked)} />{' '}
              Keep until I close this tab
            </label>
            <p className="helper">Otherwise your key is held in memory only and is gone when you refresh.</p>
          </div>
          <div className="field key-actions">
            <button type="button" className="primary" onClick={() => void runTest()} disabled={test.status === 'testing'}>Test</button>{' '}
            <button type="button" onClick={forget}>Forget key</button>{' '}
            <a href={info.keyUrl} target="_blank" rel="noopener noreferrer">Get a key</a>
          </div>
          <div role="status" aria-live="polite" className="test-result">
            {test.status === 'testing' ? 'Testing…' : null}
            {test.status === 'paste' ? 'Paste a key first.' : null}
            {test.status === 'ok' ? <span className="test-ok"><Check size={16} strokeWidth={2.5} aria-hidden="true" />Works</span> : null}
            {test.status === 'fail' ? (
              <span className="test-fail"><X size={16} strokeWidth={2.5} aria-hidden="true" />{errorCopy(test.kind).title}. {errorCopy(test.kind).body}</span>
            ) : null}
          </div>
          <details className="advanced">
            <summary>Advanced</summary>
            <label htmlFor={`${base}-model`}>Model</label>{' '}
            <input
              id={`${base}-model`} type="text" autoComplete="off" spellCheck={false} maxLength={120}
              placeholder={info.defaultModel} value={settings.model ?? ''}
              onChange={(e) => update({ model: e.target.value.trim() ? e.target.value : undefined })}
            />
            <p className="helper">Leave empty to use {info.defaultModel}.</p>
          </details>
        </section>
      ) : null}

      <details className="sent-where">
        <summary>What is sent where</summary>
        <h3>Recorded lessons</h3>
        <p>Nothing leaves your device except loading the recording file from this site.</p>
        <h3>My API key</h3>
        <p>
          Your topic, questions and answers go directly from your browser to {info.label}. Your key is sent only to
          that provider, never to this site.
        </p>
        <h3>Claude Code or Codex subscription</h3>
        <p>
          Runs on your computer through your own Claude Code / Codex app. Nothing goes to this site.
        </p>
        {PROVIDERS.gemini.freeNote ? <p>{PROVIDERS.gemini.freeNote}</p> : null}
      </details>

      <button type="button" onClick={() => go(inLesson ? 'lesson' : 'home')}>{inLesson ? 'Back to lesson' : 'Back'}</button>
    </main>
  )
}

const errorKinds: Record<string, true> = {
  'invalid-key': true, 'rate-limit': true, 'usage-limit': true, offline: true, 'cli-missing': true, 'cli-signed-out': true,
  busy: true, 'not-recorded': true, 'bad-output': true, aborted: true, unknown: true,
}
