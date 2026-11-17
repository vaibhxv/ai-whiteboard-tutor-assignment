// @vitest-environment node
import { expect, test } from 'vitest'
import { assertLocalOnly, checkFetchSite, checkHost, checkOrigin, checkToken } from '../../bridge/guards'

const ALLOWED = ['http://localhost:5173', 'http://127.0.0.1:5173']

test('checkHost allows only 127.0.0.1:<port> and localhost:<port>', () => {
  expect(checkHost('127.0.0.1:8787', 8787)).toBe(true)
  expect(checkHost('localhost:8787', 8787)).toBe(true)
  expect(checkHost('LOCALHOST:8787', 8787)).toBe(true)
  for (const h of ['evil.com', 'evil.com:8787', '127.0.0.1', 'localhost', '127.0.0.1:8788', '0.0.0.0:8787',
    '[::1]:8787', 'localhost.evil.com:8787', '127.0.0.1:8787.evil.com', '', undefined]) {
    expect(checkHost(h, 8787), String(h)).toBe(false)
  }
})

test('checkOrigin: listed origins pass; absent origin only for GET /bridge/status', () => {
  const gen = { method: 'POST', path: '/bridge/generate' }
  const status = { method: 'GET', path: '/bridge/status' }
  expect(checkOrigin('http://localhost:5173', ALLOWED, gen)).toBe(true)
  expect(checkOrigin('http://127.0.0.1:5173', ALLOWED, gen)).toBe(true)
  expect(checkOrigin('https://evil.com', ALLOWED, gen)).toBe(false)
  expect(checkOrigin('https://evil.com', ALLOWED, status)).toBe(false)
  expect(checkOrigin('null', ALLOWED, status)).toBe(false)
  expect(checkOrigin('http://localhost:5174', ALLOWED, gen)).toBe(false)
  expect(checkOrigin(undefined, ALLOWED, status)).toBe(true)
  expect(checkOrigin(undefined, ALLOWED, gen)).toBe(false)
  expect(checkOrigin(undefined, ALLOWED, { method: 'POST', path: '/bridge/status' })).toBe(false)
})

test('checkToken compares in constant time and rejects missing, short, long or repeated values', () => {
  const token = 'a'.repeat(64)
  expect(checkToken(token, token)).toBe(true)
  expect(checkToken(undefined, token)).toBe(false)
  expect(checkToken('', token)).toBe(false)
  expect(checkToken('a'.repeat(63), token)).toBe(false)
  expect(checkToken('a'.repeat(65), token)).toBe(false)
  expect(checkToken('b'.repeat(64), token)).toBe(false)
  expect(checkToken([token, token], token)).toBe(false)
  expect(checkToken('', '')).toBe(false) // an unset token never matches
})

test('assertLocalOnly throws with VERCEL=1 and with bind 0.0.0.0', () => {
  expect(() => assertLocalOnly({}, '127.0.0.1')).not.toThrow()
  expect(() => assertLocalOnly({ VERCEL: '1' }, '127.0.0.1')).toThrow(/hosting/i)
  for (const k of ['NETLIFY', 'RENDER', 'FLY_APP_NAME', 'K_SERVICE', 'AWS_LAMBDA_FUNCTION_NAME', 'RAILWAY_ENVIRONMENT']) {
    expect(() => assertLocalOnly({ [k]: 'x' }, '127.0.0.1'), k).toThrow()
  }
  expect(() => assertLocalOnly({}, '0.0.0.0')).toThrow(/127\.0\.0\.1/)
  expect(() => assertLocalOnly({}, '::')).toThrow()
  expect(() => assertLocalOnly({}, 'localhost')).toThrow()
})

test('checkFetchSite refuses requests another site triggered', () => {
  expect(checkFetchSite(undefined)).toBe(true)
  expect(checkFetchSite('same-origin')).toBe(true)
  expect(checkFetchSite('none')).toBe(true)
  expect(checkFetchSite('cross-site')).toBe(false)
  expect(checkFetchSite('same-site')).toBe(false)
})
