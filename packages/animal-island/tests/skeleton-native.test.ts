/** Real native-clock movement and pixels; Linux has no readback renderer. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineComponent, h, ref } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../../vue/src/testing.js"
import { readPng } from "../../vue/src/__tests__/png-readback.js"
import { Skeleton } from "../src/components/Skeleton.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip
const close = (actual: number[], expected: number[]) => actual.forEach((channel, index) => {
  expect(Math.abs(channel - expected[index]!), `${actual} vs ${expected}`).toBeLessThanOrEqual(3)
})

describeNative("Skeleton native shimmer", () => {
  it("moves the highlight across a stable box, clips overflow and repeats on completion", async () => {
    const active = ref(true)
    const app = createTestApp(defineComponent(() => () => h("div", { style: {
      width: 500, height: 300, backgroundColor: "white", paddingLeft: 100, paddingTop: 100,
    } }, h(Skeleton, { testId: "skeleton", variant: "rect", active: active.value, widthValue: 200, heightValue: 40,
      style: { borderRadius: 0 } }))), { width: 500, height: 300 })
    const folder = mkdtempSync(join(tmpdir(), "animal-skeleton-"))
    let captureIndex = 0
    const surface = () => app.renderer.getElementBounds(app.renderer.findByTestId("skeleton")!.id)!
    const band = () => app.renderer.findByTestId("skeleton-shimmer")
    const position = () => app.renderer.getElementBounds(band()!.id)!.x - surface().x
    const capture = () => {
      const path = join(folder, `${captureIndex++}.png`)
      app.renderer.captureScreenshot(path)
      const image = readPng(readFileSync(path)), viewport = app.renderer.getWindowSize(), box = surface()
      return (x: number, y: number) => image.pixel(Math.floor((box.x + x) * image.width / viewport.width),
        Math.floor((box.y + y) * image.height / viewport.height))
    }
    try {
      app.renderer.clockPause()
      const deadline = Date.now() + 3000
      do {
        await app.settle()
        if (band()) break
        await new Promise(resolve => setTimeout(resolve, 20))
      } while (Date.now() < deadline)
      expect(band()).toBeDefined()
      expect(position()).toBeCloseTo(-200, 1)
      const originalBox = surface()
      close(capture()(100, 20), [234, 229, 219])
      app.renderer.clockFastForward(400)
      await app.settle()
      expect(position()).toBeLessThan(-100)
      close(capture()(-2, 20), [255, 255, 255])
      app.renderer.clockFastForward(400)
      await app.settle()
      expect(position()).toBeCloseTo(0, 1)
      // Decode/upload runs asynchronously even while the native clock is frozen.
      let center: number[] = []
      const loadedDeadline = Date.now() + 3000
      do {
        await app.settle()
        center = capture()(100, 20)
        if (center[0]! > 240) break
        await new Promise(resolve => setTimeout(resolve, 20))
      } while (Date.now() < loadedDeadline)
      close(center, [246, 242, 232])
      const pixels = capture()
      close(pixels(-2, 20), [255, 255, 255])
      close(pixels(202, 20), [255, 255, 255])
      expect(surface()).toEqual(originalBox)
      const firstId = band()!.id
      app.renderer.clockFastForward(800)
      await app.settle()
      expect(band()!.id).not.toBe(firstId)
      expect(position()).toBeCloseTo(-200, 1)
      close(capture()(100, 20), [234, 229, 219])
      active.value = false
      await app.settle()
      expect(band()).toBeUndefined()
      close(capture()(100, 20), [234, 229, 219])
    } finally {
      app.renderer.clockResume(); app.unmount(); rmSync(folder, { recursive: true, force: true })
    }
  }, 15000)
})
