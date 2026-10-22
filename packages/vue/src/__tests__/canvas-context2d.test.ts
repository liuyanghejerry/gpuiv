/// Gap tests for the pure-TS `CanvasRenderingContext2D` facade — the paths
/// the pixel suite and the WPT table leave cold: gradient stroke paints,
/// dispose() racing the upload microtask, lenient setters, roundRect's
/// DOMPointInit radii, the negative-radius throws, and every drawImage
/// argument shape including mirrored (negative-extent) source and dest
/// rectangles. Runs headless like canvas-2d.test.tsx: the context only
/// needs a renderer stub with `uploadCanvasFromContext`.

import { describe, expect, it } from "vitest"
import { GpuixCanvasRenderingContext2D as Context2D } from "../canvas/context2d.js"

interface UploadRecord {
  id: number
  width: number
  height: number
}

function makeContext(width = 16, height = 16) {
  const uploads: UploadRecord[] = []
  const renderer = {
    uploadCanvasFromContext(id: number, core: { getWidth(): number; getHeight(): number }) {
      uploads.push({ id, width: core.getWidth(), height: core.getHeight() })
    },
  }
  const ctx = new Context2D(width, height, () => ({ id: 7, renderer }))
  return { ctx, uploads }
}

/** Let the coalescing upload microtask run. */
const flushUploads = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function px(ctx: Context2D, x: number, y: number): [number, number, number, number] {
  const data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data
  const i = (y * ctx.canvas.width + x) * 4
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]
}

function expectIndexSizeError(fn: () => void): void {
  try {
    fn()
    expect.unreachable("expected IndexSizeError")
  } catch (e) {
    expect(e).toBeInstanceOf(DOMException)
    expect((e as DOMException).name).toBe("IndexSizeError")
  }
}

/** A 4×4 solid-red source canvas for drawImage. */
function makeRedSource() {
  const { ctx } = makeContext(4, 4)
  ctx.fillStyle = "#ff0000"
  ctx.fillRect(0, 0, 4, 4)
  return { getContext: () => ctx }
}

describe("context lifecycle", () => {
  it("drops draws and pending uploads after dispose()", async () => {
    const { ctx, uploads } = makeContext()
    ctx.fillRect(0, 0, 4, 4)
    ctx.dispose()
    ctx.fillRect(0, 0, 4, 4)
    await flushUploads()
    expect(uploads).toEqual([])
    expect(ctx.stats.drawCount).toBeGreaterThan(0)
  })
})

describe("style and state getters/setters", () => {
  it("strokes with an assigned gradient and returns it from the getter", async () => {
    const { ctx, uploads } = makeContext(8, 8)
    const grad = ctx.createLinearGradient(0, 0, 0, 8)
    grad.addColorStop(0, "#ff0000")
    grad.addColorStop(1, "#0000ff")
    ctx.strokeStyle = grad
    expect(ctx.strokeStyle).toBe(grad)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(1, 4)
    ctx.lineTo(7, 4)
    ctx.stroke()
    await flushUploads()
    expect(uploads.length).toBe(1)
    expect(px(ctx, 4, 4)[3]).toBe(255)
  })

  it("reads back lineDashOffset and imageSmoothingEnabled", () => {
    const { ctx } = makeContext()
    expect(ctx.lineDashOffset).toBe(0)
    ctx.lineDashOffset = 2.5
    expect(ctx.lineDashOffset).toBe(2.5)
    expect(ctx.imageSmoothingEnabled).toBe(true)
    ctx.imageSmoothingEnabled = false
    expect(ctx.imageSmoothingEnabled).toBe(false)
  })

  it("ignores setLineDash arguments that are not finite non-negative lists", () => {
    const { ctx } = makeContext()
    ctx.setLineDash([3, 4])
    expect(ctx.getLineDash()).toEqual([3, 4])
    ctx.setLineDash("3 4" as unknown as number[])
    expect(ctx.getLineDash()).toEqual([3, 4])
    ctx.setLineDash([3, -4])
    expect(ctx.getLineDash()).toEqual([3, 4])
    ctx.setLineDash([3, NaN])
    ctx.setLineDash([3, Infinity])
    expect(ctx.getLineDash()).toEqual([3, 4])
  })

  it("ignores a numeric setTransform missing trailing components", () => {
    const { ctx } = makeContext()
    ctx.translate(3, 4)
    ctx.setTransform(1, 0, 0, 1, 5)
    const t = ctx.getTransform()
    expect(t.e).toBe(3)
    expect(t.f).toBe(4)
    expect(t.isIdentity).toBe(false)
    // The zero-argument form resets to the identity.
    ctx.setTransform()
    expect(ctx.getTransform().isIdentity).toBe(true)
  })
})

describe("path argument validation", () => {
  it("throws IndexSizeError for negative arcTo and arc radii", () => {
    const { ctx } = makeContext()
    expectIndexSizeError(() => ctx.arcTo(0, 0, 4, 0, -1))
    expectIndexSizeError(() => ctx.arc(0, 0, -2, 0, Math.PI))
  })

  it("silently ignores an ellipse with non-finite radii", () => {
    const { ctx } = makeContext()
    expect(() => ctx.ellipse(NaN, 0, 1, 1, 0, 0, Math.PI)).not.toThrow()
    expect(() => ctx.ellipse(0, 0, 1, Infinity, 0, 0, Math.PI)).not.toThrow()
  })

  it("reads roundRect radii from DOMPointInit entries with missing or coercible members", () => {
    // `{}` and `[null]` mean square corners: the pixel at (0, 0) fills.
    const square = makeContext(12, 12)
    square.ctx.fillStyle = "#ff0000"
    square.ctx.beginPath()
    square.ctx.roundRect(0, 0, 10, 10, {})
    square.ctx.fill()
    expect(px(square.ctx, 0, 0)).toEqual([255, 0, 0, 255])

    const nullEntry = makeContext(12, 12)
    nullEntry.ctx.fillStyle = "#ff0000"
    nullEntry.ctx.beginPath()
    nullEntry.ctx.roundRect(0, 0, 10, 10, [null as unknown as number])
    nullEntry.ctx.fill()
    expect(px(nullEntry.ctx, 0, 0)).toEqual([255, 0, 0, 255])

    // A string `x` converts; the rounded corner leaves (0, 0) empty.
    const rounded = makeContext(12, 12)
    rounded.ctx.fillStyle = "#ff0000"
    rounded.ctx.beginPath()
    rounded.ctx.roundRect(0, 0, 10, 10, [{ x: "4", y: 4 }])
    rounded.ctx.fill()
    expect(px(rounded.ctx, 0, 0)).toEqual([0, 0, 0, 0])
    expect(px(rounded.ctx, 5, 5)).toEqual([255, 0, 0, 255])
  })
})

describe("drawImage argument shapes", () => {
  it("returns without drawing for unusable sources and non-finite arguments", async () => {
    const { ctx, uploads } = makeContext()
    const before = ctx.stats.drawCount
    ctx.drawImage({ getContext: () => null } as unknown as Parameters<typeof ctx.drawImage>[0], 0, 0)
    const src = makeRedSource()
    ctx.drawImage(src, NaN, 0)
    ctx.drawImage(src, 0, 0, Infinity)
    ctx.drawImage(src, 0, 0, 4, 4, Number.NaN, 0, 4, 4)
    expect(ctx.stats.drawCount).toBe(before)
    await flushUploads()
    expect(uploads).toEqual([])
  })

  it("draws with the five-argument destination rectangle", async () => {
    const { ctx, uploads } = makeContext()
    ctx.drawImage(makeRedSource(), 2, 3, 4, 4)
    await flushUploads()
    expect(uploads.length).toBe(1)
    expect(px(ctx, 3, 4)).toEqual([255, 0, 0, 255])
    expect(px(ctx, 1, 3)).toEqual([0, 0, 0, 0])
    expect(px(ctx, 6, 7)).toEqual([0, 0, 0, 0])
  })

  it("mirrors a negative destination extent to the opposite corner", async () => {
    const wide = makeContext()
    wide.ctx.drawImage(makeRedSource(), 6, 3, -4, 4)
    expect(px(wide.ctx, 2, 3)).toEqual([255, 0, 0, 255])
    expect(px(wide.ctx, 6, 3)).toEqual([0, 0, 0, 0])

    const tall = makeContext()
    tall.ctx.drawImage(makeRedSource(), 2, 7, 4, -4)
    expect(px(tall.ctx, 2, 3)).toEqual([255, 0, 0, 255])
    expect(px(tall.ctx, 2, 7)).toEqual([0, 0, 0, 0])
    await flushUploads()
  })

  it("normalizes negative source extents before sampling", () => {
    const { ctx } = makeContext()
    ctx.drawImage(makeRedSource(), 4, 0, -4, 4, 0, 0, 4, 4)
    expect(px(ctx, 0, 0)).toEqual([255, 0, 0, 255])
    const other = makeContext()
    other.ctx.drawImage(makeRedSource(), 0, 4, 4, -4, 0, 0, 4, 4)
    expect(px(other.ctx, 0, 0)).toEqual([255, 0, 0, 255])
  })

  it("skips the draw when any source or destination extent is zero", () => {
    const { ctx } = makeContext()
    const before = ctx.stats.drawCount
    ctx.drawImage(makeRedSource(), 0, 0, 0, 4, 0, 0, 4, 4)
    ctx.drawImage(makeRedSource(), 0, 0, 4, 0, 0, 0, 4, 4)
    ctx.drawImage(makeRedSource(), 0, 0, 4, 4, 0, 0, 0, 4)
    ctx.drawImage(makeRedSource(), 0, 0, 4, 4, 0, 0, 4, 0)
    ctx.drawImage(makeRedSource(), 2, 3, 0, 0)
    expect(ctx.stats.drawCount).toBe(before)
    expect(px(ctx, 0, 0)).toEqual([0, 0, 0, 0])
  })
})

describe("ImageData entry points", () => {
  it("rejects createImageData(width) without a height", () => {
    const { ctx } = makeContext()
    expect(() => ctx.createImageData(4)).toThrow(TypeError)
  })

  it("rejects getImageData detached from a context instance", () => {
    const unbound = Context2D.prototype.getImageData
    expect(() => unbound.call({}, 0, 0, 1, 1)).toThrow(TypeError)
  })
})
