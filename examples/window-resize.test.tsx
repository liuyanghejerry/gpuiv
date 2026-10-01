import { describe, expect, it } from "vitest"
import { launch } from "@gpuiv/vue/automation"
import { fileURLToPath } from "node:url"

describe.skipIf(process.platform !== "darwin")("window resize (live)", () => {
  it("resizes the second native window without changing the main viewport", async () => {
    const app = await launch({ command: "bun", args: ["window-resize.tsx"],
      cwd: fileURLToPath(new URL(".", import.meta.url)), env: { GPUIX_BACKGROUND: "1", VITEST: "" } })
    try {
      const main = app.getByTestId("size")
      await main.waitFor({ timeoutMs: 30_000 })
      const second = app.window(1)
      await second.getByTestId("resize").waitFor({ timeoutMs: 10_000 })
      const originalMainBounds = await app.getByTestId("viewport").bounds()
      await second.getByTestId("resize").click()
      await expect.poll(() => second.getByTestId("size").textContent(), { timeout: 10_000 }).toBe("Second: 700 × 420")
      expect(await app.getByTestId("viewport").bounds()).toEqual(originalMainBounds)
      const resized = await second.getByTestId("viewport").bounds()
      expect(resized?.width).toBe(700)
      expect(resized?.height).toBe(420)
      await app.getByTestId("resize").click()
      await expect.poll(() => main.textContent(), { timeout: 10_000 }).toBe("Main: 700 × 420")
    } finally { await app.close() }
  }, 60_000)
})
