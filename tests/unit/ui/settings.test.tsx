import { screen } from '@testing-library/react'
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
