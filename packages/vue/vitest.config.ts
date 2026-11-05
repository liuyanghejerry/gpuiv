import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    // Examples import the public entry. Resolve it before package exports:
    // CI runs source tests without building dist, and all components must
    // share the test renderer's Vue injection keys.
    alias: [{ find: /^@gpuiv\/vue$/, replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)) }],
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // The bar the CI gate enforces: 90% statements and lines for every
      // module. Functions/branches are deliberately ungated — select.tsx
      // carries defensive context placeholders that setup replaces before
      // any child can call them, and branch floors on platform-switch code
      // measure the CI matrix more than the tests.
      thresholds: {
        statements: 90,
        lines: 90,
        perFile: true,
      },
      // Test helpers are infrastructure, not shipped library code.
      // src/testing.ts is the harness every GPU-backed suite runs on; measuring
      // the harness with the suites it powers is circular, and its native-only
      // half cannot run on Linux at all. src/types.ts is type-only (zero
      // runtime exports) and the src/**/index.ts files are pure re-export
      // barrels — the v8 provider scores a module with no executable
      // statements as 0%, which says nothing about test quality.
      exclude: [
        "src/__tests__/**",
        "src/testing.ts",
        "src/types.ts",
        "src/index.ts",
        "src/components/index.ts",
        "src/automation/index.ts",
        "src/hmr/index.ts",
        "dist/**",
        "**/*.d.ts",
      ],
      reporter: ["text", "html", "json-summary", "json"],
    },
  },
})
