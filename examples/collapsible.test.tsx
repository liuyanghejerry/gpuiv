import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "@gpuiv/vue/testing"
import { connectTest } from "@gpuiv/vue/automation"
import { CollapsibleExample } from "./collapsible.js"

describe.skipIf(!hasNativeTestRenderer)("Collapsible example", () => {
  it("preserves a server field across animated close and reopen", async () => {
    const app = createTestApp(CollapsibleExample, { width: 620, height: 420 })
    try {
      const automation = await connectTest(app.renderer, app.settle)
      await automation.clock.pause()
      await automation.getByTestId("server").fill("https://localhost:3000")
      await expect.poll(async () => {
        await app.settle()
        return app.renderer.findByTestId("connection-panel")?.customProps?.motion
      }).toBeDefined()
      await automation.getByTestId("connection").press("enter")
      await automation.clock.fastForward(300); await app.settle(); await app.settle()
      expect(app.renderer.getPaintedText()).not.toContain("Server address")
      await automation.getByTestId("connection").press("space")
      await automation.clock.fastForward(300); await app.settle()
      expect(app.renderer.getPaintedText()).toContain("https://localhost:3000")
      const shots = new URL("../packages/vue/screenshots/", import.meta.url)
      mkdirSync(shots, { recursive: true })
      app.renderer.captureScreenshot(fileURLToPath(new URL("collapsible-example.png", shots)))
    } finally { app.unmount() }
  })
})
