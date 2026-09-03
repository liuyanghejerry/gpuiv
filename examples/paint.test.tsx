/**
 * Paint app smoke test: mounts the real demo through the GPU test renderer
 * and drives it end-to-end — brush stroke, undo/redo, eraser, filled shape,
 * clear — asserting on the uploaded pixels rather than the JS state.
 *
 * The demo canvas fills the whole 900x600 window, so simulated window
 * coordinates are canvas coordinates.
 */

import { describe, expect, it } from "vitest"
import { connectTest } from "@gpuiv/vue/automation"
import { createTestApp, hasNativeTestRenderer } from "@gpuiv/vue/testing"
import { App } from "./paint"

const W = 800
const H = 600

const describeNative = hasNativeTestRenderer ? describe : describe.skip

function at(
  pixels: Uint8Array,
  x: number,
  y: number,
): [number, number, number, number] {
  const i = (y * W + x) * 4
  return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, pixels[i + 3]!]
}

/** "No ink" — paper (#ffffff) or grid line (#e7e7e7). Ink starts at
 *  #11111b (red ≈ 0x11); the threshold is between the two. */
function isLight(p: [number, number, number, number]): boolean {
  return p[0] >= 0xc0 && p[1] >= 0xc0 && p[2] >= 0xc0
}

describeNative("vue paint example", () => {
  it("mounts the paper and uploads a full-white buffer", async () => {
    const app = createTestApp(App, { width: W, height: H })
    await app.settle()

    const texts = app.renderer.getAllText().join("\n")
    expect(texts).toContain("Paint")
    expect(texts).toContain("Undo")
    expect(texts).toContain("Clear")

    const canvasId = app.renderer.findByType("canvas")[0]?.id
    expect(canvasId).toBeTypeOf("number")
    const pixels = app.renderer.readCanvasPixels(canvasId!)
    expect(pixels).not.toBeNull()
    expect(pixels!.length).toBe(W * H * 4)
    let painted = 0
    for (let i = 3; i < pixels!.length; i += 4) {
      if (pixels![i]! > 0) painted++
    }
    expect(painted).toBe(W * H)

    app.unmount()
  })

  it("draws a brush stroke and undoes/redoes it", async () => {
    const app = createTestApp(App, { width: W, height: H })
    await app.settle()
    const { renderer } = app
    const canvasId = renderer.findByType("canvas")[0]!.id!

    const before = renderer.readCanvasPixels(canvasId)!
    expect(isLight(at(before, 330, 310))).toBe(true)

    // A horizontal stroke across y=310, between two grid lines.
    renderer.nativeSimulateMouseDown(300, 310, 0)
    renderer.nativeSimulateMouseMove(330, 310, 0)
    renderer.nativeSimulateMouseMove(360, 310, 0)
    renderer.nativeSimulateMouseUp(360, 310, 0)
    await app.settle()

    const drawn = renderer.readCanvasPixels(canvasId)!
    expect(isLight(at(drawn, 330, 310))).toBe(false)

    const automation = await connectTest(renderer, app.settle)
    await automation.getByTestId("undo").click()
    await app.settle()
    const undone = renderer.readCanvasPixels(canvasId)!
    expect(isLight(at(undone, 330, 310))).toBe(true)

    await automation.getByTestId("redo").click()
    await app.settle()
    const redone = renderer.readCanvasPixels(canvasId)!
    expect(isLight(at(redone, 330, 310))).toBe(false)

    app.unmount()
  })

  it("erases ink with destination-out", async () => {
    const app = createTestApp(App, { width: W, height: H })
    await app.settle()
    const { renderer } = app
    const canvasId = renderer.findByType("canvas")[0]!.id!

    renderer.nativeSimulateMouseDown(300, 310, 0)
    renderer.nativeSimulateMouseMove(360, 310, 0)
    renderer.nativeSimulateMouseUp(360, 310, 0)
    await app.settle()

    const automation = await connectTest(renderer, app.settle)
    await automation.getByTestId("tool-eraser").click()
    await app.settle()

    // Erase the left half of the stroke.
    renderer.nativeSimulateMouseDown(300, 310, 0)
    renderer.nativeSimulateMouseMove(340, 310, 0)
    renderer.nativeSimulateMouseUp(340, 310, 0)
    await app.settle()

    const after = renderer.readCanvasPixels(canvasId)!
    // Erased area is fully transparent (destination-out); the untouched
    // right half still holds ink (eraser stroke ends at x=340).
    expect(at(after, 325, 310)[3]).toBe(0)
    expect(isLight(at(after, 355, 310))).toBe(false)

    app.unmount()
  })

  it("fills a rectangle with the shape tool", async () => {
    const app = createTestApp(App, { width: W, height: H })
    await app.settle()
    const { renderer } = app
    const canvasId = renderer.findByType("canvas")[0]!.id!

    const automation = await connectTest(renderer, app.settle)
    await automation.getByTestId("tool-rect").click()
    await app.settle()
    // Stroke → fill.
    await automation.getByTestId("fill-mode").click()
    await app.settle()

    renderer.nativeSimulateMouseDown(500, 400, 0)
    renderer.nativeSimulateMouseMove(560, 450, 0)
    renderer.nativeSimulateMouseUp(560, 450, 0)
    await app.settle()

    const pixels = renderer.readCanvasPixels(canvasId)!
    expect(isLight(at(pixels, 530, 425))).toBe(false) // center
    expect(isLight(at(pixels, 505, 405))).toBe(false) // near top-left corner
    expect(isLight(at(pixels, 505, 445))).toBe(false) // near bottom-left corner

    // Clearing drops back to paper.
    await automation.getByTestId("clear-canvas").click()
    await app.settle()
    const cleared = renderer.readCanvasPixels(canvasId)!
    expect(isLight(at(cleared, 530, 425))).toBe(true)
    expect(isLight(at(cleared, 330, 310))).toBe(true)

    app.unmount()
  })
})
