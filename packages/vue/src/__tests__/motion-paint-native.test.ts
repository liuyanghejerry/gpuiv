/** Actual GPU paint samples for native color/shadow motion. Linux has no
 * readback test renderer; the matching Rust and host tests still run there. */
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineComponent, h, ref } from "vue"
import { describe, expect, it, vi } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { motion } from "../components/motion.js"
import type { BoxShadow, MotionStyle } from "../types.js"
import { readPng } from "./png-readback.js"


const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("native paint motion", () => {
  it("paints premultiplied colors, reverses without a jump, and completes only the latest target", async () => {
    const target = ref<MotionStyle>({ backgroundColor: "red", borderColor: "#00ff00" })
    const completed = vi.fn()
    const App = defineComponent(() => () => h("div", {
      style: { width: 500, height: 400, backgroundColor: "white", paddingLeft: 100, paddingTop: 100 },
    }, h(motion.div, {
      testId: "paint", initial: false, animate: target.value,
      transition: { duration: 1, ease: "linear" }, onMotionComplete: completed,
      style: { width: 100, height: 80, borderWidth: 8, borderStyle: "solid" },
    })))
    const app = createTestApp(App, { width: 500, height: 400 })
    const folder = mkdtempSync(join(tmpdir(), "gpuiv-motion-color-"))
    let captureIndex = 0
    const sample = () => {
      const panel = app.renderer.getElementBounds(app.renderer.findByTestId("paint")!.id)!
      const path = join(folder, `${captureIndex++}.png`)
      app.renderer.captureScreenshot(path)
      const image = readPng(readFileSync(path)), viewport = app.renderer.getWindowSize()
      const xScale = image.width / viewport.width, yScale = image.height / viewport.height
      return [image.pixel(Math.floor((panel.x + 50) * xScale), Math.floor((panel.y + 40) * yScale)),
        image.pixel(Math.floor((panel.x + 2) * xScale), Math.floor((panel.y + 40) * yScale))]
    }
    const close = (actual: number[][], expected: number[][]) => actual.forEach((pixel, index) => pixel.forEach((channel, component) => {
      expect(Math.abs(channel - expected[index]![component]!)).toBeLessThanOrEqual(3)
    }))
    try {
      app.renderer.clockPause()
      await app.settle()
      close(sample(), [[255, 0, 0], [0, 255, 0]])
      target.value = { backgroundColor: "rgba(0,0,255,0.5)", borderColor: "yellow" }
      await app.settle()
      app.renderer.clockFastForward(500)
      await app.settle()
      const middle = sample()
      close(middle, [[191, 64, 128], [128, 255, 0]])
      target.value = { backgroundColor: "transparent", borderColor: "transparent" }
      await app.settle()
      close(sample(), middle)
      app.renderer.clockFastForward(500)
      await app.settle()
      // GPUI paints translucent borders over the sampled background color,
      // then composites that quad over the white parent.
      close(sample(), [[223, 159, 191], [175, 207, 96]])
      expect(completed).not.toHaveBeenCalled()
      app.renderer.clockFastForward(500)
      await app.settle()
      close(sample(), [[255, 255, 255], [255, 255, 255]])
      expect(completed).toHaveBeenCalledOnce()
    } finally {
      app.renderer.clockResume()
      app.unmount()
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it("fades missing drop/inset layers and clears their pixels at the exact target", async () => {
    const shadows = ref<BoxShadow[]>([])
    const app = createTestApp(defineComponent(() => () => h("div", {
      style: { width: 500, height: 400, backgroundColor: "white", paddingLeft: 100, paddingTop: 100 },
    }, h(motion.div, {
      testId: "paint", initial: false, animate: { boxShadow: shadows.value },
      transition: { duration: 1, ease: "linear" },
      style: { width: 100, height: 80, backgroundColor: "white" },
    }))), { width: 500, height: 400 })
    const folder = mkdtempSync(join(tmpdir(), "gpuiv-motion-shadow-"))
    let captureIndex = 0
    const sample = () => {
      const panel = app.renderer.getElementBounds(app.renderer.findByTestId("paint")!.id)!
      const path = join(folder, `${captureIndex++}.png`)
      app.renderer.captureScreenshot(path)
      const image = readPng(readFileSync(path)), viewport = app.renderer.getWindowSize()
      const xScale = image.width / viewport.width, yScale = image.height / viewport.height
      return [image.pixel(Math.floor((panel.x + 104) * xScale), Math.floor((panel.y + 40) * yScale)),
        image.pixel(Math.floor((panel.x + 50) * xScale), Math.floor((panel.y + 2) * yScale))]
    }
    const close = (actual: number[][], expected: number[][]) => actual.forEach((pixel, index) => pixel.forEach((channel, component) => {
      expect(Math.abs(channel - expected[index]![component]!)).toBeLessThanOrEqual(3)
    }))
    try {
      app.renderer.clockPause()
      await app.settle()
      shadows.value = [
        { offsetX: 16, offsetY: 0, blurRadius: 0, spreadRadius: 0, color: "red" },
        { offsetX: 0, offsetY: 16, blurRadius: 0, spreadRadius: 0, color: "rgba(0,0,0,0.5)", inset: true },
      ]
      await app.settle()
      app.renderer.clockFastForward(500)
      await app.settle()
      const middle = sample()
      close(middle, [[255, 128, 128], [191, 191, 191]])
      shadows.value = []
      await app.settle()
      close(sample(), middle)
      app.renderer.clockFastForward(1000)
      await app.settle()
      close(sample(), [[255, 255, 255], [255, 255, 255]])
    } finally {
      app.renderer.clockResume()
      app.unmount()
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
