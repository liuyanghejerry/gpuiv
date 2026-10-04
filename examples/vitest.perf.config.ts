import { defineConfig } from "vitest/config"

// Do not inherit the normal suite's THROTTLE re-exec or silent native skip.
if (process.env.THROTTLE) throw new Error("Unset THROTTLE before running the performance gate.")
if (process.platform !== "darwin") throw new Error("Performance budgets require a macOS runner.")

export default defineConfig({
  test: {
    include: ["beautiful-ui.perf.test.tsx"],
    fileParallelism: false,
    testTimeout: 30_000,
    env: { NODE_ENV: "production", GPUIV_PERF_GATE: "1" },
    reporters: ["default", "json"],
    outputFile: { json: "../tmp/beautiful-ui-perf-gate/tests.json" },
  },
})
