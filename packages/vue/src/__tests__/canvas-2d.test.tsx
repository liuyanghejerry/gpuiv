/// Pixel-level tests for the pure-TS CanvasRenderingContext2D rasterizer,
/// plus GPU-backed integration through the real upload bridge. The pure
/// tests run without a window: the context only needs a renderer with
/// `uploadCanvasPixels`, which a spy provides.

import path from "path"
import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import {
  GpuixCanvas,
  createTestApp,
  hasNativeTestRenderer,
  type GpuixCanvasInstance,
  type GpuixCanvasRenderingContext2D,
  type GpuixImageData,
} from "../index.js"
import { GpuixCanvasRenderingContext2D as Context2D } from "../canvas/context2d.js"
import { SHOTS_DIR, expectScreenshotsDiffer } from "./test-utils.js"
import fs from "fs"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

interface UploadRecord {
  id: number
  width: number
  height: number
  pixels: Uint8Array
}

function makeContext(width = 16, height = 16) {
  const uploads: UploadRecord[] = []
  const renderer = {
    uploadCanvasPixels(id: number, w: number, h: number, pixels: Uint8Array) {
      uploads.push({ id, width: w, height: h, pixels })
    },
  }
  const ctx = new Context2D(width, height, () => ({ id: 7, renderer }))
  return { ctx, uploads }
}

/** Let the coalescing microtask run. */
const flushUploads = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function px(ctx: GpuixCanvasRenderingContext2D, x: number, y: number): [number, number, number, number] {
  const data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data
  const i = (y * ctx.canvas.width + x) * 4
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]
}

function expectPixelClose(
  actual: [number, number, number, number],
  expected: [number, number, number, number],
  tolerance = 3,
): void {
  for (let i = 0; i < 4; i++) {
    expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(tolerance)
  }
}

describe("canvas 2d context (pure rasterizer)", () => {
  it("fills integer-aligned rectangles exactly, edges included", () => {
    const { ctx } = makeContext(16, 16)
    ctx.fillStyle = "#ff0000"
    ctx.fillRect(2, 2, 4, 3)
    expectPixelClose(px(ctx, 2, 2), [255, 0, 0, 255], 0)
    expectPixelClose(px(ctx, 5, 4), [255, 0, 0, 255], 0)
    expectPixelClose(px(ctx, 1, 2), [0, 0, 0, 0], 0)
    expectPixelClose(px(ctx, 6, 2), [0, 0, 0, 0], 0)
    expectPixelClose(px(ctx, 2, 5), [0, 0, 0, 0], 0)
  })

  it("anti-aliases a circle edge between full and empty pixels", () => {
    const { ctx } = makeContext(16, 16)
    ctx.fillStyle = "#00ff00"
    ctx.beginPath()
    ctx.arc(8, 8, 5, 0, Math.PI * 2)
    ctx.fill()
    const inside = px(ctx, 8, 8)
    const edge = px(ctx, 12, 8)
    const outside = px(ctx, 13, 8)
    expectPixelClose(inside, [0, 255, 0, 255], 0)
    expect(outside[3]).toBe(0)
    expect(edge[3]).toBeGreaterThan(100)
    expect(edge[3]).toBeLessThan(255)
    expect(edge[1]).toBeGreaterThan(100)
  })

  it("honors globalAlpha as a blend over existing pixels", () => {
    const { ctx } = makeContext(8, 8)
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, 8, 8)
    ctx.globalAlpha = 0.5
    ctx.fillStyle = "#000000"
    ctx.fillRect(0, 0, 8, 8)
    expectPixelClose(px(ctx, 3, 3), [128, 128, 128, 255], 2)
    // Invalid alphas are ignored, like the DOM.
    ctx.globalAlpha = 1.5
    expect(ctx.globalAlpha).toBe(0.5)
    ctx.globalAlpha = Number.NaN
    expect(ctx.globalAlpha).toBe(0.5)
  })

  it("saves and restores styles, alpha, transform and clip", () => {
    const { ctx } = makeContext(16, 16)
    ctx.save()
    ctx.fillStyle = "#ff0000"
    ctx.globalAlpha = 0.5
    ctx.translate(4, 0)
    ctx.beginPath()
    ctx.arc(8, 8, 4, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillRect(0, 0, 16, 16)
    // The clip circle lives at device (12, 8) — the translate moved it.
    expectPixelClose(px(ctx, 12, 8), [255, 0, 0, 128], 3)
    expect(px(ctx, 1, 1)[3]).toBe(0)
    ctx.restore()
    expect(ctx.fillStyle).toBe("#000000")
    expect(ctx.globalAlpha).toBe(1)
    expect(ctx.getTransform().e).toBe(0)
    ctx.fillRect(0, 0, 16, 16)
    expectPixelClose(px(ctx, 1, 1), [0, 0, 0, 255], 0)
  })

  it("composes translate/rotate/scale and reports the matrix", () => {
    const { ctx } = makeContext(16, 16)
    ctx.translate(8, 8)
    ctx.rotate(Math.PI / 2)
    ctx.scale(2, 2)
    const m = ctx.getTransform()
    // translate(8,8) · rotate(90°) · scale(2,2): maps (x, y) → (−2y + 8, 2x + 8)
    expect(m.e).toBeCloseTo(8)
    expect(m.f).toBeCloseTo(8)
    expect(m.a).toBeCloseTo(0)
    expect(m.b).toBeCloseTo(2)
    expect(m.c).toBeCloseTo(-2)
    expect(m.d).toBeCloseTo(0)

    ctx.fillStyle = "#0000ff"
    ctx.fillRect(-2, -2, 4, 4)
    // A 4x4 square scaled 2x, centered on (8, 8) → covers [4, 12)².
    expectPixelClose(px(ctx, 8, 8), [0, 0, 255, 255], 0)
    expectPixelClose(px(ctx, 4, 11), [0, 0, 255, 255], 0)
    expect(px(ctx, 3, 8)[3]).toBe(0)

    ctx.setTransform({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    expect(ctx.getTransform().e).toBe(0)
    ctx.transform(1, 0, 0, 1, 4, 0)
    expect(ctx.getTransform().e).toBe(4)
    ctx.resetTransform()
    expect(ctx.getTransform().d).toBe(1)
  })

  it("fills overlapping subpaths differently per fill rule", () => {
    // Two rects in one path: nonzero fills the union, even-odd XORs out the
    // overlap — the classic rule discriminator.
    const nonzero = makeContext(16, 16).ctx
    nonzero.beginPath()
    nonzero.rect(2, 2, 8, 8)
    nonzero.rect(6, 6, 8, 8)
    nonzero.fill("nonzero")
    expect(px(nonzero, 7, 7)[3]).toBe(255)

    const evenodd = makeContext(16, 16).ctx
    evenodd.beginPath()
    evenodd.rect(2, 2, 8, 8)
    evenodd.rect(6, 6, 8, 8)
    evenodd.fill("evenodd")
    expect(px(evenodd, 7, 7)[3]).toBe(0)
    expect(px(evenodd, 3, 3)[3]).toBe(255)
    expect(px(evenodd, 12, 12)[3]).toBe(255)
  })

  it("fills ellipses, roundRects and bezier curves", () => {
    const { ctx } = makeContext(20, 20)
    ctx.fillStyle = "#ff00ff"
    ctx.beginPath()
    ctx.ellipse(6, 6, 4, 2, 0, 0, Math.PI * 2)
    ctx.fill()
    expect(px(ctx, 6, 6)[3]).toBe(255)
    expect(px(ctx, 6, 2)[3]).toBe(0)

    ctx.beginPath()
    ctx.roundRect(10, 2, 8, 8, 3)
    ctx.fill()
    expect(px(ctx, 14, 6)[3]).toBe(255)
    expect(px(ctx, 10, 2)[3]).toBeLessThan(200) // corner rounded off

    ctx.beginPath()
    ctx.moveTo(2, 18)
    ctx.bezierCurveTo(2, 10, 18, 18, 18, 10)
    ctx.quadraticCurveTo(10, 4, 2, 10)
    ctx.fill()
    expect(px(ctx, 9, 12)[3]).toBeGreaterThan(0)
  })

  it("clips to a path and restores on restore()", () => {
    const { ctx } = makeContext(16, 16)
    ctx.save()
    ctx.beginPath()
    ctx.arc(8, 8, 5, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = "#ff0000"
    ctx.fillRect(0, 0, 16, 16)
    expect(px(ctx, 8, 8)[3]).toBe(255)
    expect(px(ctx, 1, 1)[3]).toBe(0)
    ctx.restore()
    ctx.fillRect(0, 0, 16, 16)
    expect(px(ctx, 1, 1)[3]).toBe(255)
  })

  it("strokes with width, caps, joins and dashes", () => {
    const { ctx } = makeContext(16, 16)
    ctx.strokeStyle = "#ff0000"
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(2, 8)
    ctx.lineTo(14, 8)
    ctx.stroke()
    expectPixelClose(px(ctx, 8, 7), [255, 0, 0, 255], 0)
    expectPixelClose(px(ctx, 8, 9), [255, 0, 0, 255], 0)
    expect(px(ctx, 8, 5)[3]).toBe(0) // above the stroke band
    expect(px(ctx, 1, 8)[3]).toBe(0) // butt cap: nothing before the end
    expectPixelClose(px(ctx, 13, 8), [255, 0, 0, 255], 0)

    const round = makeContext(16, 16).ctx
    round.strokeStyle = "#ff0000"
    round.lineWidth = 4
    round.lineCap = "round"
    round.beginPath()
    round.moveTo(2, 8)
    round.lineTo(14, 8)
    round.stroke()
    expect(px(round, 1, 8)[3]).toBeGreaterThan(200) // round cap extends past the end

    const miter = makeContext(16, 16).ctx
    miter.strokeStyle = "#ff0000"
    miter.lineWidth = 4
    miter.lineJoin = "miter"
    miter.beginPath()
    miter.moveTo(4, 4)
    miter.lineTo(4, 12)
    miter.lineTo(12, 12)
    miter.stroke()
    expect(px(miter, 2, 13)[3]).toBeGreaterThan(0) // sharp outer corner filled

    const bevel = makeContext(16, 16).ctx
    bevel.strokeStyle = "#ff0000"
    bevel.lineWidth = 4
    bevel.lineJoin = "bevel"
    bevel.beginPath()
    bevel.moveTo(4, 4)
    bevel.lineTo(4, 12)
    bevel.lineTo(12, 12)
    bevel.stroke()
    expect(px(bevel, 2, 13)[3]).toBe(0) // bevel cuts the corner diagonally

    const dashed = makeContext(16, 16).ctx
    dashed.strokeStyle = "#ff0000"
    dashed.lineWidth = 2
    dashed.setLineDash([4, 4])
    dashed.beginPath()
    dashed.moveTo(1, 8)
    dashed.lineTo(15, 8)
    dashed.stroke()
    expect(px(dashed, 2, 8)[3]).toBe(255)
    expect(px(dashed, 6, 8)[3]).toBe(0)
    expect(px(dashed, 10, 8)[3]).toBe(255)
    expect(px(dashed, 14, 8)[3]).toBe(0)

    const shifted = makeContext(16, 16).ctx
    shifted.strokeStyle = "#ff0000"
    shifted.lineWidth = 2
    shifted.setLineDash([4, 4])
    shifted.lineDashOffset = 2
    shifted.beginPath()
    shifted.moveTo(1, 8)
    shifted.lineTo(15, 8)
    shifted.stroke()
    // Phase 2 shifts the pattern 2 into the first dash: runs [1,3) and [7,11).
    expect(px(shifted, 4, 8)[3]).toBe(0)
    expect(px(shifted, 8, 8)[3]).toBe(255)
    // Odd dash lists are doubled, like the DOM.
    shifted.setLineDash([4])
    expect(shifted.getLineDash()).toEqual([4, 4])
  })

  it("paints linear and radial gradients", () => {
    const { ctx } = makeContext(16, 8)
    const gradient = ctx.createLinearGradient(0, 0, 16, 0)
    gradient.addColorStop(0, "#ff0000")
    gradient.addColorStop(1, "#0000ff")
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 16, 8)
    // Pixel centres: t = (x + 0.5) / 16.
    expectPixelClose(px(ctx, 0, 4), [247, 0, 8, 255], 3)
    expectPixelClose(px(ctx, 15, 4), [8, 0, 247, 255], 3)
    const mid = px(ctx, 7, 4)
    // Pixel centre (7.5, 4.5) → t = 7.5/16 → r = 255·(1−t) ≈ 135.
    expect(Math.abs(mid[0]! - 135)).toBeLessThanOrEqual(3)

    const radial = makeContext(16, 16).ctx
    const radialGradient = radial.createRadialGradient(8, 8, 0, 8, 8, 6)
    radialGradient.addColorStop(0, "#00ff00")
    radialGradient.addColorStop(1, "#000000")
    radial.fillStyle = radialGradient
    radial.fillRect(0, 0, 16, 16)
    // Pixel centre (8.5, 8.5) sits √0.5 from the gradient centre:
    // t = √0.5/6 → green = 255·(1−t) ≈ 225.
    expectPixelClose(px(radial, 8, 8), [0, 225, 0, 255], 3)
    expectPixelClose(px(radial, 8, 1), [0, 0, 0, 255], 3)

    expect(() => gradient.addColorStop(2, "#fff")).toThrow()
    expect(() => gradient.addColorStop(0.5, "notacolor")).toThrow()
  })

  it("supports destination-out and copy compositing", () => {
    const erase = makeContext(16, 16).ctx
    erase.fillStyle = "#ff0000"
    erase.fillRect(0, 0, 16, 16)
    erase.globalCompositeOperation = "destination-out"
    erase.fillStyle = "#ffffff"
    erase.beginPath()
    erase.arc(8, 8, 4, 0, Math.PI * 2)
    erase.fill()
    expect(px(erase, 8, 8)[3]).toBe(0)
    expectPixelClose(px(erase, 1, 1), [255, 0, 0, 255], 0)

    const copy = makeContext(16, 16).ctx
    copy.fillStyle = "#ff0000"
    copy.fillRect(0, 0, 16, 16)
    copy.globalCompositeOperation = "copy"
    copy.fillStyle = "#0000ff"
    copy.beginPath()
    copy.arc(8, 8, 4, 0, Math.PI * 2)
    copy.fill()
    expectPixelClose(px(copy, 8, 8), [0, 0, 255, 255], 0)
    expectPixelClose(px(copy, 1, 1), [0, 0, 0, 0], 0) // copy clears the rest

    // Unknown composite values are ignored.
    copy.globalCompositeOperation = "xor" as never
    expect(copy.globalCompositeOperation).toBe("copy")
  })

  it("clears rectangles through the clip mask", () => {
    const { ctx } = makeContext(16, 16)
    ctx.fillStyle = "#ff0000"
    ctx.fillRect(0, 0, 16, 16)
    ctx.clearRect(4, 4, 8, 8)
    expect(px(ctx, 5, 5)[3]).toBe(0)
    expectPixelClose(px(ctx, 3, 5), [255, 0, 0, 255], 0)
  })

  it("draws one canvas onto another with nearest and bilinear sampling", () => {
    const source = makeContext(4, 4).ctx
    source.fillStyle = "#ff0000"
    source.fillRect(0, 0, 2, 4)
    source.fillStyle = "#0000ff"
    source.fillRect(2, 0, 2, 4)
    const sourceHandle = { getContext: (type: string) => (type === "2d" ? source : null) }

    const nearest = makeContext(8, 8).ctx
    nearest.imageSmoothingEnabled = false
    nearest.drawImage(sourceHandle, 0, 0, 4, 4, 0, 0, 8, 8)
    expectPixelClose(px(nearest, 3, 3), [255, 0, 0, 255], 0)
    expectPixelClose(px(nearest, 5, 3), [0, 0, 255, 255], 0)

    const smooth = makeContext(8, 8).ctx
    smooth.drawImage(sourceHandle, 0, 0, 4, 4, 0, 0, 8, 8)
    const seam = px(smooth, 4, 3)
    expect(seam[0]).toBeGreaterThan(30)
    expect(seam[0]).toBeLessThan(225) // bilinear mixes the seam pixel
  })

  it("round-trips pixels through getImageData/putImageData/createImageData", () => {
    const { ctx } = makeContext(8, 8)
    const gradient = ctx.createLinearGradient(0, 0, 8, 8)
    gradient.addColorStop(0, "#ffffff")
    gradient.addColorStop(1, "#000000")
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 8, 8)

    const snapshot: GpuixImageData = ctx.getImageData(0, 0, 8, 8)
    expect(snapshot.width).toBe(8)
    expect(snapshot.height).toBe(8)
    expect(snapshot.data.length).toBe(8 * 8 * 4)

    const other = makeContext(8, 8).ctx
    other.putImageData(snapshot, 0, 0)
    const roundTrip = other.getImageData(0, 0, 8, 8)
    expect(Array.from(roundTrip.data)).toEqual(Array.from(snapshot.data))

    const blank = ctx.createImageData(3, 2)
    expect(blank.width).toBe(3)
    expect(blank.height).toBe(2)
    expect(blank.data.every((v) => v === 0)).toBe(true)
    expect(() => ctx.createImageData(0, 2)).toThrow()
    expect(() => ctx.getImageData(0, 0, 0, 2)).toThrow()
  })

  it("coalesces every draw in a task into one pixel upload", async () => {
    const { ctx, uploads } = makeContext(8, 8)
    ctx.fillStyle = "#ff0000"
    ctx.fillRect(0, 0, 4, 4)
    ctx.fillStyle = "#00ff00"
    ctx.fillRect(4, 0, 4, 4)
    ctx.beginPath()
    ctx.arc(4, 6, 2, 0, Math.PI * 2)
    ctx.fill()
    expect(uploads.length).toBe(0) // nothing synchronous
    await flushUploads()
    expect(uploads.length).toBe(1)
    expect(uploads[0]!.id).toBe(7)
    expect(uploads[0]!.width).toBe(8)
    expect(uploads[0]!.pixels.length).toBe(8 * 8 * 4)

    const local = ctx.getImageData(0, 0, 8, 8).data
    expect(Array.from(uploads[0]!.pixels)).toEqual(Array.from(local))

    ctx.fillStyle = "#0000ff"
    ctx.fillRect(0, 0, 2, 2)
    await flushUploads()
    expect(uploads.length).toBe(2)
  })

  it("resizes by clearing the bitmap and resetting the state", () => {
    const { ctx } = makeContext(8, 8)
    ctx.fillStyle = "#ff0000"
    ctx.fillRect(0, 0, 8, 8)
    ctx.translate(3, 3)
    ctx.resize(8, 6)
    expect(ctx.canvas.width).toBe(8)
    expect(ctx.canvas.height).toBe(6)
    expect(ctx.getTransform().e).toBe(0)
    const data = ctx.getImageData(0, 0, 8, 6).data
    expect(data.every((v) => v === 0)).toBe(true)
  })

  it("ignores invalid styles like the DOM, keeps valid ones", () => {
    const { ctx } = makeContext(4, 4)
    expect(ctx.fillStyle).toBe("#000000")
    ctx.fillStyle = "notacolor"
    expect(ctx.fillStyle).toBe("#000000")
    ctx.fillStyle = "rgb(10, 20, 30)"
    expect(ctx.fillStyle).toBe("rgb(10, 20, 30)")
    ctx.fillStyle = "nonsense"
    expect(ctx.fillStyle).toBe("rgb(10, 20, 30)")
    ctx.strokeStyle = "hsl(120, 100%, 50%)"
    expect(ctx.strokeStyle).toBe("hsl(120, 100%, 50%)")
    ctx.strokeStyle = 42 as never
    expect(ctx.strokeStyle).toBe("hsl(120, 100%, 50%)")
  })

  it("reports isPointInPath in canvas space regardless of transform", () => {
    const { ctx } = makeContext(16, 16)
    ctx.beginPath()
    ctx.moveTo(2, 2)
    ctx.lineTo(14, 2)
    ctx.lineTo(8, 14)
    ctx.closePath()
    expect(ctx.isPointInPath(8, 7)).toBe(true)
    expect(ctx.isPointInPath(8, 1)).toBe(false)
    expect(ctx.isPointInPath(Number.NaN, 5)).toBe(false)

    const moved = makeContext(16, 16).ctx
    moved.translate(4, 0)
    moved.beginPath()
    moved.moveTo(2, 2)
    moved.lineTo(14, 2)
    moved.lineTo(8, 14)
    moved.closePath()
    expect(moved.isPointInPath(8, 7)).toBe(false)
    expect(moved.isPointInPath(12, 7)).toBe(true)
  })

  it("throws NotSupported for text APIs instead of drawing nothing", () => {
    const { ctx } = makeContext(4, 4)
    expect(() => ctx.fillText("hi", 1, 1)).toThrow(/not implemented/i)
    expect(() => ctx.strokeText("hi", 1, 1)).toThrow(/not implemented/i)
    expect(() => ctx.measureText("hi")).toThrow(/not implemented/i)
  })
})

describeNative("canvas 2d context (native bridge)", () => {
  it("uploads reach the native store byte-identical", async () => {
    const canvas = ref<GpuixCanvasInstance | null>(null)
    const App = defineComponent({
      setup() {
        return () => <GpuixCanvas ref={canvas} width={8} height={8} style={{ width: 64, height: 64 }} />
      },
    })
    const app = createTestApp(App)
    await app.settle()

    const ctx = canvas.value!.getContext("2d")!
    expect(ctx).not.toBeNull()
    // Same identity every call; other context types are refused, like the DOM.
    expect(canvas.value!.getContext("2d")).toBe(ctx)
    expect(canvas.value!.getContext("webgl" as "2d")).toBeNull()
    ctx.fillStyle = "#ff0000"
    ctx.fillRect(0, 0, 8, 4)
    const gradient = ctx.createLinearGradient(0, 0, 8, 8)
    gradient.addColorStop(0, "#ffffff")
    gradient.addColorStop(1, "#3366aa")
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(4, 4, 3, 0, Math.PI * 2)
    ctx.fill()
    await app.settle()

    const id = canvas.value!.id!
    const native = app.renderer.readCanvasPixels(id)
    expect(native).not.toBeNull()
    const local = ctx.getImageData(0, 0, 8, 8).data
    expect(Array.from(native!)).toEqual(Array.from(local))
    app.unmount()
  })

  it("repaints the GPU output when the 2d context draws", async () => {
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

    const before = path.join(SHOTS_DIR, "canvas-2d-before.png")
    const after = path.join(SHOTS_DIR, "canvas-2d-after.png")
    app.renderer.captureScreenshot(before)

    const ctx = canvas.value!.getContext("2d")!
    const gradient = ctx.createLinearGradient(0, 0, 32, 32)
    gradient.addColorStop(0, "#ff5533")
    gradient.addColorStop(1, "#3355ff")
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 32, 32)
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 3
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.arc(16, 16, 10, 0, Math.PI * 2)
    ctx.stroke()
    await app.settle()
    app.renderer.captureScreenshot(after)
    expectScreenshotsDiffer(before, after)
    app.unmount()
  })
})
