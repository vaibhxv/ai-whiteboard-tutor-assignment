import { beforeEach, expect, test, vi } from 'vitest'
import { keyStore } from '../../../src/sources/key-store'

beforeEach(() => { keyStore.forgetAll(); sessionStorage.clear(); localStorage.clear() })

test('default is memory only: sessionStorage stays empty', () => {
  keyStore.set('gemini', 'k1', false)
  expect(keyStore.get('gemini')).toBe('k1')
  expect(sessionStorage.length).toBe(0)
})

test('keepInTab writes sessionStorage; localStorage is never written', () => {
  const ls = vi.spyOn(Storage.prototype, 'setItem')
  keyStore.set('openai', 'k2', true)
  expect(sessionStorage.getItem('whyboard.key.openai')).toBe('k2')
  expect(localStorage.length).toBe(0)
  expect(ls.mock.contexts.every((c) => c === sessionStorage)).toBe(true)
  ls.mockRestore()
})

test('setting again without keepInTab removes the kept copy; forget and forgetAll clear both', () => {
  keyStore.set('groq', 'k', true)
  keyStore.set('groq', 'k', false)
  expect(sessionStorage.getItem('whyboard.key.groq')).toBeNull()
  keyStore.set('groq', 'a', true)
  keyStore.set('openrouter', 'b', true)
  keyStore.forget('groq')
  expect(keyStore.get('groq')).toBeUndefined()
  expect(sessionStorage.getItem('whyboard.key.groq')).toBeNull()
  keyStore.forgetAll()
  expect(keyStore.get('openrouter')).toBeUndefined()
  expect(sessionStorage.length).toBe(0)
})

test('rehydrate restores kept keys into memory', () => {
  sessionStorage.setItem('whyboard.key.anthropic', 'kept')
  expect(keyStore.get('anthropic')).toBeUndefined()
  keyStore.rehydrate()
  expect(keyStore.get('anthropic')).toBe('kept')
})
