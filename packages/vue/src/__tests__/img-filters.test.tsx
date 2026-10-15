/** Real GPUI paint/readback for the background image-filter asset pipeline.
 * Linux has no screenshot test renderer; macOS and Windows run every pixel
 * assertion, including CI. Rust tests separately cover animation frame delay. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineComponent, h, nextTick, ref, type Ref } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer, type TestApp } from "../testing.js"
import type { EventPayload } from "@gpuiv/native"
import { readPng } from "./png-readback.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip
const WHITE = [255, 255, 255]
const GREEN = [0, 255, 0]
const MAGENTA = [255, 0, 255]

function near(actual: number[], expected: number[], tolerance = 2) {
  expect(actual).toHaveLength(3)
  actual.forEach((value, index) => expect(Math.abs(value - expected[index]!), `${actual} vs ${expected}, channel ${index}`).toBeLessThanOrEqual(tolerance))
}
function matches(actual: number[], expected: number[]) {
  return actual.length === 3 && actual.every((value, index) => Math.abs(value - expected[index]!) <= 2)
}
function bounds(app: TestApp, testId = "image") {
  const element = app.renderer.findByTestId(testId)
  expect(element, `missing ${testId}`).toBeDefined()
  const painted = app.renderer.getElementBounds(element!.id)
  expect(painted, `missing painted bounds for ${testId}`).not.toBeNull()
  return painted!
}
function fixture(filter: Ref<string>, options: { src?: Ref<string>; size?: Ref<number>; radius?: number; objectFit?: "fill" | "cover"; sibling?: boolean } = {}) {
  const loads: Array<{ src: string; generation: number; naturalWidth: number; naturalHeight: number }> = []
  const app = createTestApp(defineComponent(() => () => h("div", {
    style: { width: "100%", height: "100%", display: "flex", alignItems: "flex-start", paddingLeft: 120, paddingTop: 120, backgroundColor: "#ffffff" },
  }, [
    h("img", { src: options.src?.value ?? "", filter: filter.value, objectFit: options.objectFit ?? "fill", testId: "image",
      onLoad: (event: EventPayload) => loads.push(JSON.parse(event.value!)),
      style: { width: options.size?.value ?? 64, height: options.size?.value ?? 64, flexShrink: 0, borderRadius: options.radius ?? 0 } }),
    options.sibling ? h("div", { testId: "sibling", style: { width: 12, height: 12, marginLeft: 40, backgroundColor: "#224466" } }) : null,
  ])), { width: 500, height: 400 })
  const folder = mkdtempSync(join(tmpdir(), "gpuiv-img-filters-"))
  const path = join(folder, "paint.png")
  function capture() {
    app.renderer.captureScreenshot(path)
    const image = readPng(readFileSync(path)), viewport = app.renderer.getWindowSize()
    const scaleX = image.width / viewport.width, scaleY = image.height / viewport.height
    expect(scaleX).toBeCloseTo(scaleY, 4)
    expect(scaleX).toBeGreaterThan(0)
    const pixel = (x: number, y: number) => image.pixel(Math.floor((x + 0.5) * scaleX), Math.floor((y + 0.5) * scaleY))
    // The actual native window may differ from the requested test dimensions.
    // Derive pixels from its current size and prove the reference matte exists.
    near(pixel(24, 24), WHITE)
    return { pixel, relative: (x: number, y: number) => {
      const box = bounds(app); return pixel(box.x + x, box.y + y)
    }, imagePoint: (x: number, y: number) => {
      const box = bounds(app)
      return [(Math.floor((box.x + x + 0.5) * scaleX) + 0.5) / scaleX - box.x - 0.5,
        (Math.floor((box.y + y + 0.5) * scaleY) + 0.5) / scaleY - box.y - 0.5]
    } }
  }
  async function painted(expected: number[], x = 32, y = 32) {
    const deadline = Date.now() + 3000
    let last: number[] = []
    do {
      await app.settle()
      const shot = capture()
      last = shot.relative(x, y)
      if (matches(last, expected)) return shot
      await new Promise(resolve => setTimeout(resolve, 10))
    } while (Date.now() < deadline)
    near(last, expected)
    throw new Error("unreachable pixel mismatch")
  }
  function upload(width: number, height: number, color: (x: number, y: number) => number[]) {
    const pixels = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(color(x, y), (y * width + x) * 4)
    app.renderer.setImagePixels(app.renderer.findByTestId("image")!.id, width, height, pixels, "bgra")
  }
  return { app, loads, capture, painted, upload, dispose() { app.unmount(); rmSync(folder, { recursive: true, force: true }) } }
}

/** Continuous Gaussian convolution of an opaque CSS rectangle. Integrate the
 * standard normal independently of the native raster/filter algorithm; the
 * source bitmap's dimensions do not enter this reference. */
function gaussianRectAlpha(x: number, y: number, width: number, height: number, left = 0) {
  const mass = (from: number, until: number) => {
    const low = Math.max(-8, from), high = Math.min(8, until)
    if (high <= low) return 0
    const segments = Math.ceil((high - low) * 128), step = (high - low) / segments
    let sum = 0
    for (let i = 0; i < segments; i++) {
      const z = low + (i + 0.5) * step
      sum += Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)
    }
    return sum * step
  }
  return mass((x - left - width) / 4, (x - left) / 4) * mass((y - height) / 4, y / 4)
}

describeNative("native img CSS filters", () => {
  it("paints the exact stamp matrix and updates filter pixels without reloading its source", async () => {
    const filter = ref("none"), test = fixture(filter)
    try {
      test.upload(64, 64, () => [40, 120, 220, 255])
      await test.painted([220, 120, 40])
      expect(test.loads).toHaveLength(1)
      expect(test.loads[0]).toMatchObject({ naturalWidth: 64, naturalHeight: 64 })
      const original = bounds(test.app)
      filter.value = "saturate(.93) contrast(1.03)"
      await test.painted([217, 121, 44])
      expect(bounds(test.app)).toEqual(original)
      expect(test.loads).toHaveLength(1)
      filter.value = "none"
      await test.painted([220, 120, 40])
      expect(test.loads).toHaveLength(1)
    } finally { test.dispose() }
  })

  it("blurs transparent blue pixels without dark fringes and paints outside the original layout box", async () => {
    const test = fixture(ref("blur(4px)"))
    try {
      // The hidden blue RGB must contribute no color to the red alpha halo.
      test.upload(64, 64, x => x < 8 ? [255, 0, 0, 0] : [0, 0, 255, 255])
      const shot = await test.painted([255, 0, 0])
      expect(bounds(test.app)).toMatchObject({ width: 64, height: 64 })
      for (const [x, y] of [[4, 32], [66, 32]]) {
        const [sourceX, sourceY] = shot.imagePoint(x, y)
        const white = Math.round(255 * (1 - gaussianRectAlpha(sourceX! + 0.5, sourceY! + 0.5, 56, 64, 8)))
        expect(white).toBeGreaterThan(100)
        expect(white).toBeLessThan(245)
        near(shot.relative(x, y), [255, white, white], 3)
      }
      near(shot.relative(80, 32), WHITE)
    } finally { test.dispose() }
  })

  it("keeps a 4px CSS Gaussian halo when a 1px source is enlarged and resized", async () => {
    const size = ref(32), test = fixture(ref("blur(4px)"), { size })
    try {
      test.upload(1, 1, () => [0, 0, 255, 255])
      const silhouettes: number[][] = []
      for (const displaySize of [32, 64]) {
        size.value = displaySize
        const shot = await test.painted([255, 0, 0], displaySize / 2, displaySize / 2)
        expect(bounds(test.app)).toMatchObject({ width: displaySize, height: displaySize })
        // These offsets are CSS pixels past the displayed edge. A blur in the
        // 1x1 source grid, subsequently enlarged, produces a much wider fringe.
        for (const [x, y] of [[displaySize + 2, displaySize / 2], [displaySize + 6, displaySize / 2], [displaySize / 2, -3]]) {
          const [sampleX, sampleY] = shot.imagePoint(x, y)
          const white = Math.round(255 * (1 - gaussianRectAlpha(sampleX! + 0.5, sampleY! + 0.5, displaySize, displaySize)))
          expect(white).toBeGreaterThan(120)
          expect(white).toBeLessThan(250)
          near(shot.relative(x, y), [255, white, white], 3)
        }
        near(shot.relative(displaySize + 16, displaySize / 2), WHITE)
        silhouettes.push(shot.relative(displaySize + 2, displaySize / 2))
      }
      // Only the image's actual dimensions change; the same 4px filter keeps
      // the same halo, and the live source is not decoded/loaded a second time.
      near(silhouettes[0]!, silhouettes[1]!, 2)
      expect(test.loads).toHaveLength(1)
      expect(test.loads[0]).toMatchObject({ naturalWidth: 1, naturalHeight: 1 })
    } finally { test.dispose() }
  })

  it("extends drop-shadow pixels without squeezing the source or moving its next sibling", async () => {
    const filter = ref("none"), test = fixture(filter, { sibling: true })
    try {
      test.upload(64, 64, () => [0, 255, 0, 255])
      await test.painted(GREEN)
      const original = bounds(test.app), sibling = bounds(test.app, "sibling")
      expect(original).toMatchObject({ width: 64, height: 64 })
      expect(sibling.x - original.x - original.width).toBeCloseTo(40, 3)
      filter.value = "drop-shadow(20px 0 0 red)"
      const shot = await test.painted([255, 0, 0], 74, 32)
      near(shot.relative(4, 32), GREEN)
      near(shot.relative(60, 32), GREEN)
      near(shot.relative(88, 32), WHITE)
      expect(bounds(test.app)).toEqual(original)
      expect(bounds(test.app, "sibling")).toEqual(sibling)
    } finally { test.dispose() }
  })

  it("clips cover's offscreen red/blue bands before generating the green image's shadow", async () => {
    const test = fixture(ref("drop-shadow(20px 0 0 magenta)"), { objectFit: "cover" })
    try {
      test.upload(128, 64, x => x < 32 ? [0, 0, 255, 255] : x >= 96 ? [255, 0, 0, 255] : [0, 255, 0, 255])
      const shot = await test.painted(MAGENTA, 74, 32)
      near(shot.relative(-12, 32), WHITE)
      near(shot.relative(4, 32), GREEN)
      near(shot.relative(60, 32), GREEN)
      near(shot.relative(88, 32), WHITE)
      expect(bounds(test.app)).toMatchObject({ width: 64, height: 64 })
    } finally { test.dispose() }
  })

  it("clips rounded source corners before casting an unclipped circular shadow", async () => {
    const test = fixture(ref("drop-shadow(20px 0 0 magenta)"), { radius: 32 })
    try {
      test.upload(64, 64, () => [0, 255, 0, 255])
      const shot = await test.painted(MAGENTA, 74, 32)
      near(shot.relative(32, 32), GREEN)
      near(shot.relative(2, 2), WHITE)
      near(shot.relative(78, 2), WHITE)
      near(shot.relative(88, 32), WHITE)
      expect(bounds(test.app)).toMatchObject({ width: 64, height: 64 })
    } finally { test.dispose() }
  })

  it("never repaints a stale filtered source after rapid source/filter replacement", async () => {
    const svg = (color: string) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`).toString("base64")}`
    const sources = [svg("red"), svg("#00ff00"), svg("blue")]
    const src = ref(sources[0]!), filter = ref("invert(1)"), test = fixture(filter, { src })
    try {
      await test.painted([0, 255, 255])
      for (const [index, expected] of [[1, [255, 0, 255]], [2, [255, 255, 0]], [0, [0, 255, 255]]] as const) {
        // Put an intermediate source/filter into the retained tree without
        // waiting for a paint, then replace it. Source invalidation must also
        // retire a previous filtered result and its completion observer.
        src.value = sources[(index + 1) % sources.length]!
        filter.value = "grayscale(1)"
        await nextTick(); test.app.flushMutations()
        src.value = sources[index]!
        filter.value = "invert(1)"
        await nextTick(); test.app.flushMutations()
        const first = test.capture().relative(32, 32)
        expect(matches(first, WHITE) || matches(first, [...expected]), `stale first-frame pixel ${first}`).toBe(true)
        await test.painted([...expected])
        const latest = test.loads.at(-1)!
        expect(latest.src).toBe(sources[index])
        await test.app.settle()
        near(test.capture().relative(32, 32), [...expected])
        expect(test.loads.at(-1)).toEqual(latest)
      }
      expect(test.loads.length).toBeGreaterThanOrEqual(4)
      test.loads.slice(1).forEach((load, index) => expect(load.generation).toBeGreaterThan(test.loads[index]!.generation))
    } finally { test.dispose() }
  })
})
