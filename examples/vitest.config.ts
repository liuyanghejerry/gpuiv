import { applyMacCpuThrottleFromEnv } from '@gpuiv/vue'
import { defineConfig } from 'vitest/config'

applyMacCpuThrottleFromEnv()

export default defineConfig({})
