import { defineConfig } from 'vitest/config'
import type { Plugin, UserConfig } from 'vite'
import react from '@vitejs/plugin-react'

const LOCAL = process.env.WHYBOARD_LOCAL === '1'
const VITE_PORT = Number(process.env.VITE_PORT ?? 5173)
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? 8787)

/**
 * Local runs only (`npm run dev`): hands the page the bridge's per-start token. Dev server only, so a
 * build never contains a token.
 */
function bridgeToken(): Plugin {
  return {
    name: 'whyboard-bridge-token',
    apply: 'serve',
    transformIndexHtml() {
      const token = process.env.BRIDGE_TOKEN
      return token ? [{ tag: 'meta', attrs: { name: 'whyboard-bridge-token', content: token }, injectTo: 'head' }] : []
    },
  }
}

const server: UserConfig['server'] = LOCAL
  ? {
      host: '127.0.0.1',
      port: VITE_PORT,
      strictPort: true, // the bridge only accepts this port as an Origin
      // Vite's default CORS lets any localhost origin read dev responses (index.html carries the token, and
      // proxied bridge replies would gain Access-Control-* headers). Same-origin only.
      cors: false,
      proxy: { '/bridge': { target: `http://127.0.0.1:${BRIDGE_PORT}`, changeOrigin: true } },
    }
  : { host: '127.0.0.1' }

export default defineConfig({
  plugins: [react(), ...(LOCAL ? [bridgeToken()] : [])],
  define: { __LOCAL__: JSON.stringify(LOCAL) },
  server,
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    // UI tests render whole lessons; a loaded machine must not turn a slow first test into a cascade.
    testTimeout: 20_000,
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/golden/**/*.test.ts', 'tests/bridge/**/*.test.ts'],
  },
})
