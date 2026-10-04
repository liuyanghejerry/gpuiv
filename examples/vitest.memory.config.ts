import { defineConfig } from 'vitest/config'

if (process.platform !== 'darwin') throw new Error('Memory gate requires a macOS runner.')
if (process.env.THROTTLE) throw new Error('Unset THROTTLE before running the memory gate.')

export default defineConfig({ test: {
  include: ['memory-leak.test.ts'], fileParallelism: false,
  env: { NODE_ENV: 'production' }, reporters: ['default', 'json'],
  outputFile: { json: '../tmp/memory-leak-gate/tests.json' },
} })
