import { defineConfig, mergeConfig } from 'vitest/config'
import config from './vite.config.ts'

export default mergeConfig(config, defineConfig({
  test: { include: ['src/**/*.bench.tsx'] },
}))
