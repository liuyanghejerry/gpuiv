import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    // Examples import the public entry. Resolve it before package exports:
    // CI runs source tests without building dist, and all components must
    // share the test renderer's Vue injection keys.
    alias: [{ find: /^@gpuiv\/vue$/, replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)) }],
  },
})
