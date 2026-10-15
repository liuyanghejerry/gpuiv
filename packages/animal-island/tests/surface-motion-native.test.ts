/** Pointer-triggered native paint evidence for the actual Animal Island
 * surfaces. Headless GPU readback is available on macOS and Windows only. */
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineComponent, h } from "vue"
import { describe, expect, it, vi } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../../vue/src/testing.js"
import { readPng } from "../../vue/src/__tests__/png-readback.js"
import { Button } from "../src/components/Button.js"
import { ColorSurface } from "../src/components/surface-motion.js"
import type { StyleDesc } from "@gpuiv/vue"

const describeNative = hasNativeTestRenderer ? describe : describe.skip
const close = (actual: number[], expected: number[]) => actual.forEach((value, index) => {
  expect(Math.abs(value - expected[index]!)).toBeLessThanOrEqual(3)
})

describeNative("Animal Island surface paint motion", () => {
  it("fades a hover surface and its shadow through native intermediate frames and reverses without a jump", async () => {
    const entered = vi.fn(), left = vi.fn()
    const app = createTestApp(defineComponent(() => () => h("div", { style: {
      width: 500, height: 400, backgroundColor: "white", paddingLeft: 100, paddingTop: 100,
    } }, h(ColorSurface, {
      testId: "surface", role: "button", onMouseEnter: entered, onMouseLeave: left,
      transition: { duration: 1, ease: "linear" }, style: { width: 100, height: 80, backgroundColor: "red",
        hover: { backgroundColor: "rgba(0,0,255,0.5)", boxShadow: { offsetX: 16, offsetY: 0, blurRadius: 0, spreadRadius: 0, color: "red" } },
      },
    }))), { width: 500, height: 400 })
    const folder = mkdtempSync(join(tmpdir(), "animal-surface-motion-"))
    let captureIndex = 0
    const bounds = () => app.renderer.getElementBounds(app.renderer.findByTestId("surface")!.id)!
    const sample = () => {
      const path = join(folder, `${captureIndex++}.png`)
      app.renderer.captureScreenshot(path)
      const image = readPng(readFileSync(path)), viewport = app.renderer.getWindowSize(), box = bounds()
      const scaleX = image.width / viewport.width, scaleY = image.height / viewport.height
      return [image.pixel(Math.floor((box.x + 50) * scaleX), Math.floor((box.y + 40) * scaleY)),
        image.pixel(Math.floor((box.x + 102) * scaleX), Math.floor((box.y + 40) * scaleY))]
    }
    try {
      app.renderer.clockPause()
      await app.settle()
      const box = bounds()
      app.renderer.nativeSimulateMouseMove(box.x + 50, box.y + 40)
      await app.settle()
      expect(entered).toHaveBeenCalledOnce()
      app.renderer.clockFastForward(500)
      await app.settle()
      const middle = sample()
      close(middle[0]!, [191, 64, 128])
      close(middle[1]!, [255, 128, 128])
      app.renderer.nativeSimulateMouseMove(450, 350)
      await app.settle()
      expect(left).toHaveBeenCalledOnce()
      const reversed = sample()
      close(reversed[0]!, middle[0]!)
      close(reversed[1]!, middle[1]!)
      app.renderer.clockFastForward(500)
      await app.settle()
      const returnMiddle = sample()
      close(returnMiddle[0]!, [223, 32, 64])
      close(returnMiddle[1]!, [255, 191, 191])
      app.renderer.clockFastForward(500)
      await app.settle()
      const end = sample()
      close(end[0]!, [255, 0, 0])
      close(end[1]!, [255, 255, 255])
    } finally {
      app.renderer.clockResume(); app.unmount(); rmSync(folder, { recursive: true, force: true })
    }
  })

  it("animates Button background and hard-shadow colors on actual hover/press/release", async () => {
    const clicked = vi.fn(), entered = vi.fn()
    const style: StyleDesc = {
      width: 100, height: 80, paddingLeft: 0, paddingRight: 0, borderWidth: 0, borderRadius: 0,
      backgroundColor: "#ff0000", boxShadow: { offsetX: 16, offsetY: 0, blurRadius: 0, spreadRadius: 0, color: "#ff0000" },
      hover: { backgroundColor: "#0000ff", boxShadow: { offsetX: 32, offsetY: 0, blurRadius: 0, spreadRadius: 0, color: "#0000ff" } },
      active: { backgroundColor: "#00ff00", boxShadow: { offsetX: 8, offsetY: 0, blurRadius: 0, spreadRadius: 0, color: "#00ff00" } },
    }
    const app = createTestApp(defineComponent(() => () => h("div", { style: {
      width: 500, height: 400, backgroundColor: "white", paddingLeft: 100, paddingTop: 100,
    } }, h(Button, { type: "primary", testId: "button", style, onMouseEnter: entered, onClick: clicked }))), { width: 500, height: 400 })
    const folder = mkdtempSync(join(tmpdir(), "animal-button-paint-motion-"))
    let captureIndex = 0
    const bounds = () => app.renderer.getElementBounds(app.renderer.findByTestId("button")!.id)!
    const sample = () => {
      const path = join(folder, `${captureIndex++}.png`)
      app.renderer.captureScreenshot(path)
      const image = readPng(readFileSync(path)), viewport = app.renderer.getWindowSize(), box = bounds()
      const scaleX = image.width / viewport.width, scaleY = image.height / viewport.height
      return [image.pixel(Math.floor((box.x + 50) * scaleX), Math.floor((box.y + 40) * scaleY)),
        image.pixel(Math.floor((box.x + 104) * scaleX), Math.floor((box.y + 40) * scaleY))]
    }
    try {
      app.renderer.clockPause()
      await app.settle()
      let box = bounds()
      app.renderer.nativeSimulateMouseMove(box.x + 50, box.y + 40)
      await app.settle()
      expect(entered).toHaveBeenCalledOnce()
      app.renderer.clockFastForward(125)
      await app.settle()
      // React's ease curve has crossed the halfway color at t=125ms, but
      // has not reached either endpoint. Both fill and shadow must move.
      for (const pixel of sample()) {
        expect(pixel[0]).toBeGreaterThan(10); expect(pixel[0]).toBeLessThan(245)
        expect(pixel[2]).toBeGreaterThan(10); expect(pixel[2]).toBeLessThan(245)
        expect(pixel[1]).toBeLessThanOrEqual(3)
      }
      app.renderer.clockFastForward(125)
      await app.settle()
      for (const pixel of sample()) close(pixel, [0, 0, 255])
      box = bounds()
      app.renderer.nativeSimulateMouseDown(box.x + 50, box.y + 40)
      await app.settle()
      app.renderer.clockFastForward(125)
      await app.settle()
      for (const pixel of sample()) {
        expect(pixel[1]).toBeGreaterThan(10); expect(pixel[1]).toBeLessThan(245)
        expect(pixel[2]).toBeGreaterThan(10); expect(pixel[2]).toBeLessThan(245)
        expect(pixel[0]).toBeLessThanOrEqual(3)
      }
      app.renderer.clockFastForward(125)
      await app.settle()
      for (const pixel of sample()) close(pixel, [0, 255, 0])
      box = bounds()
      app.renderer.nativeSimulateMouseUp(box.x + 50, box.y + 40)
      await app.settle()
      expect(clicked).toHaveBeenCalledOnce()
      app.renderer.clockFastForward(250)
      await app.settle()
      for (const pixel of sample()) close(pixel, [0, 0, 255])
      app.renderer.nativeSimulateMouseMove(450, 350)
      await app.settle()
      app.renderer.clockFastForward(250)
      await app.settle()
      for (const pixel of sample()) close(pixel, [255, 0, 0])
    } finally {
      app.renderer.clockResume(); app.unmount(); rmSync(folder, { recursive: true, force: true })
    }
  })
})
