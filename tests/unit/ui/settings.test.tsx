import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { keyStore } from '../../../src/sources/key-store'
import { SETTINGS_KEY } from '../../../src/storage/settings'
import { useUi } from '../../../src/ui/store'
import { renderApp, setup, teardown } from './helpers'

vi.mock('../../../src/recordings/manifest', async () => ({ manifest: (await import('./manifest')).MANIFEST }))

beforeEach(async () => { await setup(); keyStore.forgetAll(); sessionStorage.clear() })
afterEach(async () => { keyStore.forgetAll(); await teardown() })

async function open() {
  const r = renderApp()
  await r.user.click(screen.getByRole('button', { name: 'Open settings' }))
  return r
}

test('public build: both subscription options are disabled with the exact copy and a README link', async () => {
  await open()
  for (const n of ['Claude Code subscription (this computer)', 'Codex subscription (this computer)']) {
    expect(screen.getByRole('radio', { name: n })).toBeDisabled()
  }
  expect(screen.getAllByText(/Only available when you run Whyboard on your own computer\./)).toHaveLength(2)
  const link = screen.getAllByRole('link', { name: /run it locally/i })[0]!
  expect(link).toHaveAttribute('href', 'https://github.com/vaibhxv/ai-whiteboard-tutor-assignment#run-locally')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})

test('choosing My API key saves immediately and shows the key controls; the key is not in settings', async () => {
  const { user } = await open()
  expect(screen.getByRole('radio', { name: 'Recorded lessons' })).toBeChecked()
  await user.click(screen.getByRole('radio', { name: 'My API key' }))
  expect(useUi.getState().settings.sourceId).toBe('openai-compatible')
  const input = screen.getByLabelText('API key')
  expect(input).toHaveAttribute('type', 'password')
  expect(input).toHaveAttribute('autocomplete', 'off')
  await user.type(input, 'sk-secret')
  expect(keyStore.get('gemini')).toBe('sk-secret')
  expect(sessionStorage.length).toBe(0)
  expect(localStorage.getItem(SETTINGS_KEY)).not.toContain('sk-secret')
  expect(screen.getAllByText(/Free tier, no card needed/).length).toBeGreaterThanOrEqual(1)
  const get = screen.getByRole('link', { name: 'Get a key' })
  expect(get).toHaveAttribute('href', 'https://aistudio.google.com/apikey')
  expect(get).toHaveAttribute('target', '_blank')
})

test('provider select, Keep checkbox writes sessionStorage, Forget key clears everything', async () => {
  const { user } = await open()
  await user.click(screen.getByRole('radio', { name: 'My API key' }))
  await user.selectOptions(screen.getByLabelText('Provider'), 'anthropic')
  expect(useUi.getState().settings).toMatchObject({ sourceId: 'anthropic', provider: 'anthropic' })
  expect(screen.getByTestId('source-badge')).toHaveTextContent('LIVE · Anthropic API · claude-sonnet-5-5')
  await user.type(screen.getByLabelText('API key'), 'k1')
  await user.click(screen.getByLabelText('Keep until I close this tab'))
  expect(sessionStorage.getItem('whyboard.key.anthropic')).toBe('k1')
  expect(localStorage.getItem('whyboard.key.anthropic')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Forget key' }))
  expect(keyStore.get('anthropic')).toBeUndefined()
  expect(sessionStorage.getItem('whyboard.key.anthropic')).toBeNull()
  expect(screen.getByLabelText('API key')).toHaveValue('')
})

test('advanced model field overrides the default and shows in the badge', async () => {
  const { user } = await open()
  await user.click(screen.getByRole('radio', { name: 'My API key' }))
  await user.selectOptions(screen.getByLabelText('Provider'), 'groq')
  await user.click(screen.getByText('Advanced'))
  expect(screen.getByLabelText('Model')).toHaveAttribute('placeholder', 'openai/gpt-oss-120b')
  await user.type(screen.getByLabelText('Model'), 'foo-1')
  expect(useUi.getState().settings.model).toBe('foo-1')
  expect(screen.getByTestId('source-badge')).toHaveTextContent('LIVE · Groq · foo-1')
})

test('Test shows ✓ Works, or the error copy', async () => {
  const { user } = await open()
  await user.click(screen.getByRole('radio', { name: 'My API key' }))
  await user.type(screen.getByLabelText('API key'), 'gk')
  const f = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', f)
  await user.click(screen.getByRole('button', { name: 'Test' }))
  expect(await screen.findByText('Works')).toBeInTheDocument()
  expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://generativelanguage.googleapis.com/v1beta/openai/models')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
  await user.click(screen.getByRole('button', { name: 'Test' }))
  expect(await screen.findByText(/That key didn't work/)).toBeInTheDocument()
})

test('"What is sent where" has a paragraph per source', async () => {
  const { user } = await open()
  await user.click(screen.getByText('What is sent where'))
  expect(screen.getByText(/Nothing leaves your device except loading the recording file from this site/)).toBeInTheDocument()
  expect(screen.getByText(/your key is sent only to/i)).toBeInTheDocument()
  expect(screen.getByText(/Nothing goes to this site/)).toBeInTheDocument()
})

test('Test with no key says "Paste a key first." and makes no request', async () => {
  const { user } = await open()
  await user.click(screen.getByRole('radio', { name: 'My API key' }))
  const f = vi.fn()
  vi.stubGlobal('fetch', f)
  await user.click(screen.getByRole('button', { name: 'Test' }))
  expect(screen.getByText('Paste a key first.')).toBeInTheDocument()
  expect(f).not.toHaveBeenCalled()
})

test('Test gives up after 15 s with the offline copy', async () => {
  const { user } = await open()
  await user.click(screen.getByRole('radio', { name: 'My API key' }))
  await user.type(screen.getByLabelText('API key'), 'gk')
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  await user.click(screen.getByRole('button', { name: 'Test' }))
  expect(screen.getByText('Testing…')).toBeInTheDocument()
  await act(async () => { await vi.advanceTimersByTimeAsync(15_100) })
  expect(screen.getByText(/Can't reach the internet/)).toBeInTheDocument()
})

function stubBridgeStatus(body: unknown) {
  const f = vi.fn(async (url: string) => {
    if (url === '/bridge/status') return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', f)
  return f
}

test('local build: subscription options show the real bridge status and next steps', async () => {
  vi.stubGlobal('__LOCAL__', true)
  const f = stubBridgeStatus({
    claude: { installed: true, version: '2.1.326', signedIn: true, plan: 'max' },
    codex: { installed: false },
  })
  const { user } = await open()
  expect(await screen.findByText('Ready · max plan · Claude Code 2.1.326')).toBeInTheDocument()
  expect(screen.getByText('Not installed. Install Codex, then run "codex" once to sign in.')).toBeInTheDocument()
  expect(screen.queryByText(/Only available when you run Whyboard/)).toBeNull()
  expect(f).toHaveBeenCalledWith('/bridge/status', expect.anything())
  const radio = screen.getByRole('radio', { name: 'Claude Code subscription (this computer)' })
  expect(radio).toBeEnabled()
  await user.click(radio)
  expect(useUi.getState().settings.sourceId).toBe('claude-code')
  expect(screen.getByTestId('source-badge')).toHaveTextContent('LIVE · Claude Code on this computer')
})

test('local build: signed out shows the sign-in step, and Check again re-reads the status', async () => {
  vi.stubGlobal('__LOCAL__', true)
  stubBridgeStatus({ claude: { installed: true, version: '2.1.326', signedIn: false }, codex: { installed: true, version: '0.99.0', signedIn: false } })
  const { user } = await open()
  expect(await screen.findByText('Signed out. Run "claude" in a terminal and sign in.')).toBeInTheDocument()
  expect(screen.getByText('Signed out. Run "codex" in a terminal and sign in.')).toBeInTheDocument()
  const f = stubBridgeStatus({ claude: { installed: true, version: '2.1.326', signedIn: true, plan: 'pro' }, codex: { installed: false } })
  await user.click(screen.getByRole('button', { name: 'Check again' }))
  expect(await screen.findByText('Ready · pro plan · Claude Code 2.1.326')).toBeInTheDocument()
  expect(f).toHaveBeenCalled()
})

test('local build: an unreachable bridge says how to start it', async () => {
  vi.stubGlobal('__LOCAL__', true)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
  await open()
  expect((await screen.findAllByText(/Can't reach the local bridge/)).length).toBe(2)
})

test('choosing a subscription clears a model left over from an API key', async () => {
  vi.stubGlobal('__LOCAL__', true)
  stubBridgeStatus({ claude: { installed: true, signedIn: true }, codex: { installed: false } })
  const { user } = await open()
  act(() => { useUi.getState().updateSettings({ sourceId: 'anthropic', provider: 'anthropic', model: 'claude-opus-5-5' }) })
  await user.click(screen.getByRole('radio', { name: 'Claude Code subscription (this computer)' }))
  expect(useUi.getState().settings.model).toBeUndefined()
})
