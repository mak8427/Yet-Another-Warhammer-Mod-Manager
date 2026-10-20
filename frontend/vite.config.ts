import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const devHost = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: devHost || false,
    hmr: devHost
      ? {
          protocol: 'ws',
          host: devHost,
          port: 1421,
        }
      : undefined,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
})
