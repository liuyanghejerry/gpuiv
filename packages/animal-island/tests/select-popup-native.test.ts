/** Pixel readback is supported by the macOS/Windows test renderer only.
 * Linux runs the host silhouette and real-window row-hit regressions. */
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inflateSync } from "node:zlib"
import { defineComponent, h } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../../vue/src/testing.js"
import { Select } from "../src/components/Select.js"
import { FloatingLayer } from "../../vue/src/components/floating.js"

// GPUI captureScreenshot saves an 8-bit, non-interlaced RGB/RGBA PNG.
// Keep this small decoder local to the pixel test; no image dependency is
// needed to recover the standard PNG scanline filters for four samples.
function readPng(bytes: Buffer) {
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
  let width = 0, height = 0, channels = 0
  const chunks: Buffer[] = []
  for (let cursor = 8; cursor < bytes.length;) {
    const size = bytes.readUInt32BE(cursor), kind = bytes.toString("ascii", cursor + 4, cursor + 8)
    const data = bytes.subarray(cursor + 8, cursor + 8 + size)
    if (kind === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      expect(data[8]).toBe(8)
      expect([2, 6]).toContain(data[9])
      expect([...data.subarray(10, 13)]).toEqual([0, 0, 0])
      channels = data[9] === 6 ? 4 : 3
    } else if (kind === "IDAT") chunks.push(data)
    cursor += size + 12
  }
  expect(width * height * channels).toBeGreaterThan(0)
  const stride = width * channels, filtered = inflateSync(Buffer.concat(chunks))
  expect(filtered.length).toBe((stride + 1) * height)
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)]!
    expect(filter).toBeLessThanOrEqual(4)
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x
      const left = x >= channels ? pixels[index - channels]! : 0
      const up = y ? pixels[index - stride]! : 0
      const upperLeft = y && x >= channels ? pixels[index - stride - channels]! : 0
      const p = left + up - upperLeft
      const distances = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upperLeft)]
      const paeth = distances[0]! <= distances[1]! && distances[0]! <= distances[2]! ? left : distances[1]! <= distances[2]! ? up : upperLeft
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth][filter]!
      pixels[index] = (filtered[y * (stride + 1) + 1 + x]! + predictor) & 255
    }
  }
  return { width, height, pixel(x: number, y: number) {
    const index = (y * width + x) * channels
    return [...pixels.subarray(index, index + 3)]
  } }
}

const describeNative = hasNativeTestRenderer ? describe : describe.skip
describeNative("Select popup painted corners", () => {
  it.each(["transparent", "translucent"] as const)("preserves a %s anchored surface without a black fallback or repeated alpha", async variant => {
    const viewport = { width: 500, height: 400 }
    const app = createTestApp(defineComponent(() => () => h("div", {
      style: { ...viewport, paddingLeft: 100, paddingTop: 200, backgroundColor: "#224466" },
    }, h("div", { style: { position: "relative", width: 100 } }, h(FloatingLayer, {
      testId: "surface", style: { width: 100, height: 80,
        backgroundColor: variant === "transparent" ? "transparent" : "rgba(255, 255, 255, 0.5)",
      },
    }, { default: () => variant === "transparent" ? h("div", {
      style: { width: 100, height: 80, borderRadius: 40, backgroundColor: "#ffeea0" },
    }) : null })))), viewport)
    const folder = mkdtempSync(join(tmpdir(), "gpuiv-floating-fill-"))
    try {
      await app.settle()
      const panel = app.renderer.getElementBounds(app.renderer.findByTestId("surface")!.id)!
      const path = join(folder, "surface.png")
      app.renderer.captureScreenshot(path)
      const image = readPng(readFileSync(path)), actualViewport = app.renderer.getWindowSize()
      const scaleX = image.width / actualViewport.width, scaleY = image.height / actualViewport.height
      expect(scaleX).toBeCloseTo(scaleY, 4)
      const sample = (x: number, y: number, color: number[]) => image.pixel(Math.floor(x * scaleX), Math.floor(y * scaleY))
        .forEach((value, channel) => expect(Math.abs(value - color[channel]!)).toBeLessThanOrEqual(2))
      if (variant === "transparent") {
        sample(panel.x + 2, panel.y + 2, [34, 68, 102])
        sample(panel.x + panel.width - 2, panel.y + panel.height - 2, [34, 68, 102])
        sample(panel.x + panel.width / 2, panel.y + panel.height / 2, [255, 238, 160])
      } else {
        sample(panel.x + panel.width / 2, panel.y + panel.height / 2, [145, 162, 179])
      }
    } finally {
      app.unmount()
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it("keeps first and last option shoulders outside the 28px arc clear", async () => {
    const viewport = { width: 500, height: 400 }
    const app = createTestApp(defineComponent(() => () => h("div", {
      style: { ...viewport, paddingLeft: 100, paddingTop: 260, backgroundColor: "#224466" },
    }, h(Select, {
      testId: "shape", options: [{ key: "one", label: "One" }, { key: "two", label: "Two" }, { key: "three", label: "Three" }],
      style: { width: 220 },
    }))), viewport)
    const folder = mkdtempSync(join(tmpdir(), "gpuiv-select-corners-"))
    try {
      app.renderer.clockPause()
      const trigger = app.renderer.findByTestId("shape")!
      const triggerBounds = app.renderer.getElementBounds(trigger.id)!
      app.renderer.nativeSimulateClick(triggerBounds.x + triggerBounds.width / 2, triggerBounds.y + triggerBounds.height / 2)
      await app.settle()
      app.renderer.clockFastForward(500)
      await app.settle()
      await app.settle()
      const panel = app.renderer.getElementBounds(app.renderer.findByTestId("shape-popup")!.id)!
      const path = join(folder, "popup.png")
      app.renderer.captureScreenshot(path)
      const image = readPng(readFileSync(path))
      // The Windows offscreen surface may use the platform's negotiated
      // client size rather than the requested test dimensions. Pixel scale
      // comes from that actual client viewport, not our root's CSS size.
      const actualViewport = app.renderer.getWindowSize()
      const scaleX = image.width / actualViewport.width, scaleY = image.height / actualViewport.height
      expect(scaleX).toBeGreaterThan(0)
      expect(scaleX).toBeCloseTo(scaleY, 4)
      const expectColor = (x: number, y: number, expected: number[]) => {
        const actual = image.pixel(Math.floor(x * scaleX), Math.floor(y * scaleY))
        actual.forEach((value, channel) => expect(Math.abs(value - expected[channel]!)).toBeLessThanOrEqual(2))
      }
      // paddingY=12 places the old rectangular row fill at y=13.5, while
      // x=1.5 is still safely outside the panel's 28px circular corner.
      for (const x of [panel.x + 1.5, panel.x + panel.width - 1.5]) {
        expectColor(x, panel.y + 13.5, [34, 68, 102])
        expectColor(x, panel.y + panel.height - 13.5, [34, 68, 102])
      }
      expectColor(panel.x + panel.width / 2, panel.y + 5, [255, 238, 160])
      expectColor(panel.x + panel.width / 2, panel.y + panel.height - 5, [255, 238, 160])
    } finally {
      app.renderer.clockResume()
      app.unmount()
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
