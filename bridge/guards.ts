/**
 * Request guards for the loopback bridge. Together they stop another website (or a DNS-rebinding page)
 * from driving the user's CLI: the Host must be loopback, a present Origin must be ours, and generation
 * needs the per-start token, sent in a custom header that cross-origin pages cannot add without a CORS
 * preflight the bridge never answers.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

/** Only `127.0.0.1:<port>` and `localhost:<port>` (the Host a DNS-rebinding page sends is its own name). */
export function checkHost(host: string | undefined, port: number): boolean {
  if (!host) return false
  const h = host.toLowerCase()
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`
}

/** A present Origin must be listed. An absent one is allowed only for `GET /bridge/status`. */
export function checkOrigin(origin: string | undefined, allowed: readonly string[], req: { method?: string; path: string }): boolean {
  if (origin === undefined) return req.method === 'GET' && req.path === '/bridge/status'
  return allowed.includes(origin)
}

/**
 * Browsers label every request with Sec-Fetch-Site. Anything another site triggers (an <img> or form
 * pointed at the bridge, which carries no Origin) says `cross-site` or `same-site`; the app's own fetches
 * say `same-origin`. Absent (non-browser clients such as curl) is left to the other guards.
 */
export function checkFetchSite(value: string | undefined): boolean {
  return value === undefined || value === 'same-origin' || value === 'none'
}

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest()

/** Constant-time comparison (hashing first makes unequal lengths take the same time too). */
export function checkToken(header: string | string[] | undefined, token: string): boolean {
  if (typeof header !== 'string' || !header || !token) return false
  return timingSafeEqual(digest(header), digest(token))
}

const HOSTING_VARS = ['VERCEL', 'NETLIFY', 'RENDER', 'FLY_APP_NAME', 'K_SERVICE', 'AWS_LAMBDA_FUNCTION_NAME', 'RAILWAY_ENVIRONMENT']

/** Refuses to run anywhere but the user's own computer, bound to loopback. */
export function assertLocalOnly(env: NodeJS.ProcessEnv, bindHost: string): void {
  const hosted = HOSTING_VARS.filter((k) => env[k] !== undefined && env[k] !== '')
  if (hosted.length) {
    throw new Error(`The Whyboard bridge only runs on your own computer; refusing to start in a hosting environment (${hosted.join(', ')}).`)
  }
  if (bindHost !== '127.0.0.1') {
    throw new Error(`The Whyboard bridge binds 127.0.0.1 only; refusing to bind ${bindHost}.`)
  }
}
