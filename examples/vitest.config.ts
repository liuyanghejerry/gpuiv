import { applyMacCpuThrottleFromEnv } from '@gpuiv/vue'
import { defineConfig } from 'vitest/config'

applyMacCpuThrottleFromEnv()

// Chat perf budgets assert wall-clock draw/mount times, and the live
// automation test opens a real GPU window. Running test files in parallel
// let that window steal CPU/GPU from the budgets and redden CI, so the
// suite runs one file at a time.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
})
