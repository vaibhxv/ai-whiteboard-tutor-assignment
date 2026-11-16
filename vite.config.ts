import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: { __LOCAL__: JSON.stringify(process.env.WHYBOARD_LOCAL === '1') },
  server: { host: '127.0.0.1' },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/golden/**/*.test.ts', 'tests/bridge/**/*.test.ts'],
  },
})
