/// GPU-backed tests for the native `<canvas>` element: the JS→Rust pixel
/// bridge (`uploadCanvasPixels` / `readCanvasPixels`) and proof that an upload
/// changes what the GPU paints (screenshot diff, the same convention the other
/// visual tests use).

import fs from "fs"
import path from "path"
import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import { GpuixCanvas, createTestApp, hasNativeTestRenderer, type GpuixCanvasInstance } from "../index.js"
import { SHOTS_DIR, expectScreenshotsDiffer } from "./test-utils.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

/** A 2x2 buffer: red, green, blue, white. */
function fourPixels(): Uint8ClampedArray {
  return new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
}

/** The same buffer with every pixel darkened, so a repaint must differ. */
function darkened(pixels: Uint8ClampedArray): Uint8ClampedArray {
  const next = new Uint8ClampedArray(pixels.length)
  for (let i = 0; i < pixels.length; i += 4) {
    next[i] = pixels[i]! >> 1
    next[i + 1] = pixels[i + 1]! >> 1
    next[i + 2] = pixels[i + 2]! >> 1
    next[i + 3] = pixels[i + 3]
  }
  return next
}

/** A SIZE x SIZE checkerboard so the screenshot diff has real texture. */
function checkerboard(size: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = ((x >> 2) + (y >> 2)) % 2 === 0
      const offset = (y * size + x) * 4
      pixels[offset] = on ? 255 : 40
      pixels[offset + 1] = on ? 120 : 40
      pixels[offset + 2] = on ? 40 : 200
      pixels[offset + 3] = 255
    }
  }
  return pixels
}

describeNative("canvas pixel bridge (vue)", () => {
  it("round-trips an upload through readCanvasPixels", async () => {
    const canvas = ref<GpuixCanvasInstance | null>(null)
    const App = defineComponent({
      setup() {
        return () => (
          <GpuixCanvas ref={canvas} width={2} height={2} style={{ width: 64, height: 64 }} />
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()

    const id = canvas.value?.id
    expect(id).toBeTypeOf("number")
    expect(app.renderer.readCanvasPixels(id!)).toBeNull()

    const pixels = new Uint8Array(fourPixels())
    app.renderer.uploadCanvasPixels(id!, 2, 2, pixels)
    expect(Array.from(app.renderer.readCanvasPixels(id!)!)).toEqual(Array.from(pixels))
    app.unmount()
  })

  it("rejects a buffer whose length does not match the dimensions", async () => {
    const canvas = ref<GpuixCanvasInstance | null>(null)
    const App = defineComponent({
      setup() {
        return () => <GpuixCanvas ref={canvas} width={2} height={2} style={{ width: 64, height: 64 }} />
      },
    })
    const app = createTestApp(App)
    await app.settle()
    expect(() =>
      app.renderer.uploadCanvasPixels(canvas.value!.id!, 2, 2, new Uint8Array(12)),
    ).toThrow()
    app.unmount()
  })

  it("repaints the GPU output when the buffer changes", async () => {
    fs.mkdirSync(SHOTS_DIR, { recursive: true })
    const canvas = ref<GpuixCanvasInstance | null>(null)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", padding: 40, backgroundColor: "#101010" }}>
            <GpuixCanvas ref={canvas} width={32} height={32} style={{ width: 200, height: 200 }} />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    const id = canvas.value!.id!

    const before = path.join(SHOTS_DIR, "canvas-before.png")
    const after = path.join(SHOTS_DIR, "canvas-after.png")
    app.renderer.captureScreenshot(before)
    app.renderer.uploadCanvasPixels(id, 32, 32, darkened(checkerboard(32)))
    app.renderer.captureScreenshot(after)
    expectScreenshotsDiffer(before, after)
    app.unmount()
  })
})
