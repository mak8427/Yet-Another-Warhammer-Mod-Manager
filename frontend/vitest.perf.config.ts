import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Non-blocking render guard (WAR-7). Kept out of `pnpm test` so the normal suite stays fast and
 * timing output never mixes with correctness gates. Run with `pnpm test:perf`.
 */
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    include: ['src/perf/**/*.perf.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
