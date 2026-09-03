/**
 * Smoke test for the canvas paint example: mounts the real app through the
 * GPU test renderer, proves the 2D context uploaded its gradient scene to
 * the native store, and drives the toolbar buttons.
 */

import { describe, expect, it } from "vitest"
import { connectTest } from "@gpuiv/vue/automation"
import { createTestApp, hasNativeTestRenderer } from "@gpuiv/vue/testing"
import { App } from "./canvas-paint"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("vue canvas paint example", () => {
  it("renders and uploads the gradient scene to the native canvas store", async () => {
    const app = createTestApp(App)
    await app.settle()

    const texts = app.renderer.getAllText().join("\n")
    expect(texts).toContain("Canvas paint")
    expect(texts).toContain("Gradient demo")

    // The mounted gradientScene() painted and the coalesced upload landed.
    const canvasId = app.renderer.findByType("canvas")[0]?.id
    expect(canvasId).toBeTypeOf("number")
    const pixels = app.renderer.readCanvasPixels(canvasId!)
    expect(pixels).not.toBeNull()
    expect(pixels!.length).toBe(560 * 400 * 4)
    // The scene fills every pixel; a blank buffer would be all zeros.
    let painted = 0
    for (let i = 3; i < pixels!.length; i += 4) {
      if (pixels![i]! > 0) painted++
    }
    expect(painted).toBe(560 * 400)

    app.unmount()
  })

  it("drives the toolbar buttons", async () => {
    const app = createTestApp(App)
    await app.settle()

    const automation = await connectTest(app.renderer, app.settle)
    const canvasId = app.renderer.findByType("canvas")[0]!.id!
    await app.settle()
    const before = app.renderer.readCanvasPixels(canvasId)!

    await automation.getByTestId("clear-canvas").click()
    await app.settle()
    const cleared = app.renderer.readCanvasPixels(canvasId)!
    expect(Array.from(cleared)).not.toEqual(Array.from(before))

    await automation.getByTestId("gradient-demo").click()
    await app.settle()
    const restored = app.renderer.readCanvasPixels(canvasId)!
    expect(Array.from(restored)).not.toEqual(Array.from(cleared))

    app.unmount()
  })
})
