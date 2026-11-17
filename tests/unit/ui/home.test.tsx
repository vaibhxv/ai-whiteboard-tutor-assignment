import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { keyStore } from '../../../src/sources/key-store'
import { jsonl } from '../../fixtures/fake-source'
import type { AiSource, GenEvent, GenRequest } from '../../../src/sources/types'
import { SETTINGS_KEY } from '../../../src/storage/settings'
import { setSessionDeps } from '../../../src/ui/session'
import { useUi } from '../../../src/ui/store'
import { MANIFEST, lesson, recordingWith, renderApp, setup, stubFetch, teardown, tick, until, fixture } from './helpers'

vi.mock('../../../src/recordings/manifest', async () => ({ manifest: (await import('./manifest')).MANIFEST }))

beforeEach(setup)
afterEach(teardown)

const TOPIC_HELP = "Don't include personal details."

describe('Home', () => {
  test('shows the promise, the topic box with its label and helper text, and starter cards from the manifest', () => {
    renderApp()
    expect(screen.getByText("Stuck on a maths idea? I'll draw it out with you.")).toBeInTheDocument()
    const box = screen.getByLabelText('What are you stuck on?')
    expect(box).toHaveAttribute('maxLength', '300')
    expect(screen.getByText(TOPIC_HELP)).toBeInTheDocument()
    for (const m of MANIFEST) expect(screen.getByRole('button', { name: new RegExp(m.title) })).toBeInTheDocument()
    expect(screen.getByTestId('source-badge')).toHaveTextContent(/^RECORDED · /)
  })

  test('clicking a starter lesson shows the warm-up within 1.5 s and the recorded badge', async () => {
    const { user } = renderApp()
    await user.click(screen.getByRole('button', { name: /why the vertex is halfway/i }))
    await tick(1500)
    expect(lesson()?.phase).toBe('warmup')
    expect(screen.getByText("Before I explain: What is the midpoint of 1 and 3? Guess — we'll find out.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument()
    expect(screen.getByTestId('source-badge')).toHaveTextContent('RECORDED · claude-sonnet-5-5 · captured 16 Nov 2026')
    expect(screen.queryByText(/correct|wrong/i)).toBeNull() // the warm-up is never graded
  })

  test('with the replay source the topic box is disabled with the explanation and a Settings link', async () => {
    const { user } = renderApp()
    expect(screen.getByLabelText('What are you stuck on?')).toBeDisabled()
    expect(screen.getByText('Typing your own topic needs a live AI source.')).toBeInTheDocument()
    const cards = screen.getAllByRole('button', { name: /play recording/i })
    expect(cards).toHaveLength(MANIFEST.length)
    expect(screen.queryByRole('button', { name: /generate live/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(useUi.getState().screen).toBe('settings')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  test('with a live source, starter cards offer Play recording and Generate live', () => {
    useUi.getState().updateSettings({ sourceId: 'anthropic' })
    renderApp()
    expect(screen.getByLabelText('What are you stuck on?')).toBeEnabled()
    expect(screen.getAllByRole('button', { name: /play recording/i })).toHaveLength(MANIFEST.length)
    expect(screen.getAllByRole('button', { name: /generate live/i })).toHaveLength(MANIFEST.length)
  })

  test('topic box: a pasted script tag plus 5000 chars is capped at 300 and rendered as text', async () => {
    useUi.getState().updateSettings({ sourceId: 'anthropic' })
    const topics: string[] = []
    const src: AiSource = {
      id: 'anthropic',
      badge: () => ({ mode: 'live', text: 'LIVE · Anthropic API · fake', model: 'fake', billedTo: 'api-key' }),
      preflight: async () => ({ ready: true }),
      async *generate(req: GenRequest): AsyncGenerator<GenEvent> {
        topics.push(req.user)
        yield { type: 'text', text: jsonl({ t: 'scope', verdict: 'in', reason: 'ok' }) }
        yield { type: 'done', stop: 'end' }
      },
    }
    setSessionDeps({ createSource: () => src })
    const { user, container } = renderApp()
    const box = screen.getByLabelText('What are you stuck on?') as HTMLInputElement
    const hostile = '<script>alert(1)</script>' + 'x'.repeat(5000)
    box.focus()
    await user.paste(hostile)
    expect(Array.from(box.value)).toHaveLength(300)
    expect(box.value.startsWith('<script>alert(1)</script>')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Start lesson' }))
    await tick(50)
    expect(lesson()?.topic).toBe(hostile.slice(0, 300))
    expect(screen.getByText(/<script>alert\(1\)<\/script>x+/)).toBeInTheDocument() // shown as text
    expect(container.querySelector('script')).toBeNull()
  })

  test('a declined scope shows the reason and two suggestions on Home', async () => {
    stubFetch({
      '/recordings/odd.json': recordingWith({
        plan: jsonl({ t: 'scope', verdict: 'declined', reason: 'I only teach maths here.', suggest: ['Completing the square', 'Gradient of a line'] }),
      }),
    })
    const { user } = renderApp()
    await user.click(screen.getByRole('button', { name: /an odd topic/i }))
    await until(() => useUi.getState().screen === 'home', 3000, 50)
    expect(screen.getByText('I only teach maths here.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Completing the square' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gradient of a line' })).toBeInTheDocument()
  })

  test('an adjacent scope shows the best-effort banner text exactly for the lesson', async () => {
    const plan = fixture.responses.plan!.text.replace('"verdict":"in"', '"verdict":"adjacent"')
    stubFetch({ '/recordings/odd.json': { ...fixture, responses: { ...fixture.responses, plan: { text: plan } } } })
    const { user } = renderApp()
    await user.click(screen.getByRole('button', { name: /an odd topic/i }))
    await until(() => lesson()?.phase === 'warmup', 3000, 50)
    expect(screen.getByText("Outside my checked zone. I can explain and sketch, but I can't verify this the way I verify maths.")).toBeInTheDocument()
  })

  test('a live API-key source enables the topic box and starts a lesson through a mocked provider stream', async () => {
    keyStore.set('gemini', 'gk', false)
    useUi.getState().updateSettings({ sourceId: 'openai-compatible', provider: 'gemini' })
    const plan = jsonl({ t: 'scope', verdict: 'declined', reason: 'Not maths.', suggest: ['A', 'B'] })
    const f = vi.fn(async (_u: string, _i?: RequestInit) =>
      new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: plan } }] })}\n\ndata: [DONE]\n\n`, { status: 200 }))
    vi.stubGlobal('fetch', f)
    const { user } = renderApp()
    const box = screen.getByLabelText('What are you stuck on?')
    expect(box).toBeEnabled()
    expect(screen.getByTestId('source-badge')).toHaveTextContent('LIVE · Gemini API · gemini-3.8-flash')
    await user.type(box, 'completing the square')
    await user.click(screen.getByRole('button', { name: 'Start lesson' }))
    await tick(200)
    expect(f).toHaveBeenCalled()
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect(JSON.parse(init!.body as string).messages[1].content).toContain('completing the square')
    keyStore.forgetAll()
  })

  test('a live source with no key says it is not connected instead of starting', async () => {
    keyStore.forgetAll()
    useUi.getState().updateSettings({ sourceId: 'anthropic' })
    const { user } = renderApp()
    await user.type(screen.getByLabelText('What are you stuck on?'), 'x')
    await user.click(screen.getByRole('button', { name: 'Start lesson' }))
    expect(await screen.findByText(/isn't connected yet/)).toBeInTheDocument()
  })

  test('settings persist under whyboard.settings without unknown fields', () => {
    useUi.getState().updateSettings({ sourceId: 'anthropic', ...({ apiKey: 'sk-secret' } as object) })
    const raw = localStorage.getItem(SETTINGS_KEY) ?? ''
    expect(JSON.parse(raw).sourceId).toBe('anthropic')
    expect(raw).not.toContain('sk-secret')
  })
})
