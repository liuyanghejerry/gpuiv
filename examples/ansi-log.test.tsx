import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "@gpuiv/vue/testing"
import { connectTest } from "@gpuiv/vue/automation"
import { AnsiLogExample } from "./ansi-log.js"

describe.skipIf(!hasNativeTestRenderer)("ANSI log example", () => {
  it("shows streamed coloured output through the built package", async () => {
    const app = createTestApp(AnsiLogExample, { width: 720, height: 520 })
    try {
      const automation = await connectTest(app.renderer, app.settle)
      await app.settle(); await app.settle()
      expect(app.renderer.getPaintedText().join("\n")).toContain("[199]")
      await automation.getByTestId("append").click()
      await app.settle(); await app.settle()
      expect(app.renderer.getPaintedText().join("\n")).toContain("New output: 你好")
      const shots = new URL("../packages/vue/screenshots/", import.meta.url)
      mkdirSync(shots, { recursive: true })
      app.renderer.captureScreenshot(fileURLToPath(new URL("ansi-log-example.png", shots)))
    } finally { app.unmount() }
  })
})
