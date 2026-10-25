import { configDefaults, defineConfig } from 'vitest/config'

// Chat perf budgets assert wall-clock draw/mount times, and the live
// automation test opens a real GPU window. Running test files in parallel
// let that window steal CPU/GPU from the budgets and redden CI, so the
// suite runs one file at a time.
export default defineConfig({
  test: {
    fileParallelism: false,
    setupFiles: ['./vitest.setup.ts'],
    exclude: [...configDefaults.exclude, 'memory-leak.test.ts'],
  },
})
