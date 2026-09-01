/**
 * `CanvasRenderingContext2D` for GPUIV — a pure-TypeScript software
 * rasterizer.
 *
 * The context owns a premultiplied RGBA buffer as the source of truth
 * (exactly the relationship a DOM canvas has to its backing store) and
 * pushes straight-alpha bytes through the existing `uploadCanvasPixels`
 * channel; the Rust side is untouched. Draws are coalesced: everything a
 * JS task paints reaches the GPU in one upload on the following microtask.
 *
 * Deliberately NOT implemented (documented in README "Canvas"): text
 * (`fillText`/`strokeText`/`measureText` — they throw, glyph rasterization
 * is a separate project), `toDataURL`/`toBlob`, shadows, `filter`,
 * `createPattern`, conic gradients, WebGL, and `HTMLImageElement` as a
 * `drawImage` source (JS never sees decoded `<img>` pixels).
 */

import { parseColor, serializeColor, type RgbaColor } from "./color.js"
import { GpuixCanvasGradient } from "./gradient.js"
import { GpuixImageData } from "./image-data.js"
import {
  applyMatrix,
  identityMatrix,
  invertMatrix,
  maxScaleOf,
  multiplyMatrix,
  rotationMatrix,
  scalingMatrix,
  translationMatrix,
  type GpuixMatrix2D,
} from "./matrix.js"
import { flattenPath, GpuixPathBuilder, type Poly } from "./path.js"
import {
  pointInPolys,
  rasterizeCoverage,
  type CoverageBuffer,
  type FillRule,
} from "./raster.js"
import { buildStrokeGeometry, type StrokeParams } from "./stroke.js"
import type { NativeRenderer } from "../types.js"

export { GpuixImageData } from "./image-data.js"

export type GpuixLineCap = "butt" | "round" | "square"
export type GpuixLineJoin = "round" | "bevel" | "miter"
export type GpuixFillRule = "nonzero" | "evenodd"

/** Every composite mode the DOM accepts as a `globalCompositeOperation`
 *  value. The separable/non-separable blend modes are accepted (the getter
 *  must echo them back) but currently rasterize as `source-over`. */
export type GpuixCompositeOperation =
  | "source-over"
  | "source-in"
  | "source-out"
  | "source-atop"
  | "destination-over"
  | "destination-in"
  | "destination-out"
  | "destination-atop"
  | "lighter"
  | "copy"
  | "xor"
  | "clear"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity"

const COMPOSITE_OPERATIONS: ReadonlySet<string> = new Set([
  "source-over",
  "source-in",
  "source-out",
  "source-atop",
  "destination-over",
  "destination-in",
  "destination-out",
  "destination-atop",
  "lighter",
  "copy",
  "xor",
  "clear",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
])

/** A CSS color object (`{ r, g, b, a? }`, channels 0–1) — the structured
 *  form `fillStyle`/`strokeStyle` accept alongside strings and gradients. */
export interface GpuixColorObject {
  r: number
  g: number
  b: number
  a?: number
}

export type GpuixFillStyle = string | GpuixColorObject | GpuixCanvasGradient

export interface GpuixTextMetrics {
  width: number
}

/** Anything with a 2D context works as a `drawImage` source; today that is
 *  another (or the same) `GpuixCanvas`. */
export interface GpuixDrawImageSource {
  getContext(type: "2d"): GpuixCanvasRenderingContext2D | null
}

/** Where uploads go. The component supplies a live getter so the context
 *  survives id/renderer changes without JS-side re-wiring. */
export interface GpuixUploadTarget {
  renderer: NativeRenderer
  id: number
}

interface DrawingState {
  m: GpuixMatrix2D
  /** Coverage mask; null means "no clip". Snapshotted per save() — clip()
   *  always writes a fresh array, so restoring never mutates history. */
  clip: Float32Array | null
  fillStyle: GpuixFillStyle
  fill: RgbaColor | null
  strokeStyle: GpuixFillStyle
  stroke: RgbaColor | null
  globalAlpha: number
  lineWidth: number
  lineCap: GpuixLineCap
  lineJoin: GpuixLineJoin
  miterLimit: number
  lineDash: number[]
  lineDashOffset: number
  composite: GpuixCompositeOperation
  imageSmoothingEnabled: boolean
}

const NOT_SUPPORTED_TEXT =
  "GpuixCanvas: text rendering (fillText/strokeText/measureText) is not implemented. " +
  "Glyph rasterization is tracked as follow-up work; see the README Canvas section."

function finite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v))
}

/** Buffer dimension: an integer magnitude, zero allowed (a DOM canvas can be
 *  sized 0×n; every paint loop is simply empty). */
function dimensionOf(value: number): number {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export class GpuixCanvasRenderingContext2D {
  readonly canvas: { readonly width: number; readonly height: number }

  private width: number
  private height: number
  private getUpload: () => GpuixUploadTarget | null
  private premul: Uint8ClampedArray
  private cover: CoverageBuffer
  private straightScratch: Uint8Array | null = null
  private state: DrawingState
  private stack: DrawingState[] = []
  private path = new GpuixPathBuilder()
  private uploadScheduled = false
  private disposed = false
  private drawCount = 0

  /** Parse what a style setter was given into a colour, or null when the
   *  value is not assignable. Strings go through the CSS parser; objects
   *  with numeric `r`/`g`/`b` (0–1) are the structured colour form;
   *  anything else is stringified first, exactly like WebIDL. */
  private static parseStyleValue(value: GpuixFillStyle): RgbaColor | null {
    if (typeof value === "string") return parseColor(value)
    if (value instanceof GpuixCanvasGradient) return null
    if (typeof value === "object" && value !== null) {
      const { r, g, b, a } = value as GpuixColorObject
      if (
        typeof r === "number" && Number.isFinite(r) &&
        typeof g === "number" && Number.isFinite(g) &&
        typeof b === "number" && Number.isFinite(b)
      ) {
        const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
        return {
          r: clamp01(r) * 255,
          g: clamp01(g) * 255,
          b: clamp01(b) * 255,
          a: a === undefined ? 1 : clamp01(Number(a) || 0),
        }
      }
      const asString = String(value)
      return parseColor(asString)
    }
    return parseColor(String(value))
  }

  constructor(width: number, height: number, getUpload: () => GpuixUploadTarget | null) {
    this.width = dimensionOf(width)
    this.height = dimensionOf(height)
    this.getUpload = getUpload
    this.premul = new Uint8ClampedArray(this.width * this.height * 4)
    this.cover = { width: this.width, height: this.height, data: new Float32Array(this.width * this.height) }
    this.state = defaultState()
    const self = this
    this.canvas = {
      get width() {
        return self.width
      },
      get height() {
        return self.height
      },
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /** Drop pending uploads; the component calls this on unmount. */
  dispose(): void {
    this.disposed = true
  }

  /**
   * A new buffer size clears the bitmap and resets the state, like setting
   * `width`/`height` on a DOM canvas. The context identity survives.
   */
  resize(width: number, height: number): void {
    this.width = dimensionOf(width)
    this.height = dimensionOf(height)
    this.premul = new Uint8ClampedArray(this.width * this.height * 4)
    this.cover = { width: this.width, height: this.height, data: new Float32Array(this.width * this.height) }
    this.straightScratch = null
    this.state = defaultState()
    this.stack = []
    this.path = new GpuixPathBuilder()
    this.scheduleUpload()
  }

  // ── Styles ───────────────────────────────────────────────────────────

  get fillStyle(): GpuixFillStyle {
    const style = this.state.fillStyle
    return style instanceof GpuixCanvasGradient ? style : serializeColor(this.state.fill!)
  }

  set fillStyle(value: GpuixFillStyle) {
    if (value instanceof GpuixCanvasGradient) {
      this.state.fillStyle = value
      this.state.fill = null
      return
    }
    const parsed = GpuixCanvasRenderingContext2D.parseStyleValue(value)
    if (!parsed) return // invalid assignments leave the style untouched
    this.state.fillStyle = value as string | GpuixColorObject
    this.state.fill = parsed
  }

  get strokeStyle(): GpuixFillStyle {
    const style = this.state.strokeStyle
    return style instanceof GpuixCanvasGradient ? style : serializeColor(this.state.stroke!)
  }

  set strokeStyle(value: GpuixFillStyle) {
    if (value instanceof GpuixCanvasGradient) {
      this.state.strokeStyle = value
      this.state.stroke = null
      return
    }
    const parsed = GpuixCanvasRenderingContext2D.parseStyleValue(value)
    if (!parsed) return
    this.state.strokeStyle = value as string | GpuixColorObject
    this.state.stroke = parsed
  }

  get globalAlpha(): number {
    return this.state.globalAlpha
  }

  set globalAlpha(value: number) {
    const n = Number(value)
    if (Number.isFinite(n) && n >= 0 && n <= 1) this.state.globalAlpha = n
  }

  get lineWidth(): number {
    return this.state.lineWidth
  }

  set lineWidth(value: number) {
    // WebIDL `double`: strings and valueOf-objects convert before the check,
    // so `ctx.lineWidth = "1e1"` stores 10 like in the DOM.
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) this.state.lineWidth = n
  }

  get lineCap(): GpuixLineCap {
    return this.state.lineCap
  }

  set lineCap(value: GpuixLineCap) {
    if (value === "butt" || value === "round" || value === "square") this.state.lineCap = value
  }

  get lineJoin(): GpuixLineJoin {
    return this.state.lineJoin
  }

  set lineJoin(value: GpuixLineJoin) {
    if (value === "round" || value === "bevel" || value === "miter") this.state.lineJoin = value
  }

  get miterLimit(): number {
    return this.state.miterLimit
  }

  set miterLimit(value: number) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) this.state.miterLimit = n
  }

  get lineDashOffset(): number {
    return this.state.lineDashOffset
  }

  set lineDashOffset(value: number) {
    const n = Number(value)
    if (Number.isFinite(n)) this.state.lineDashOffset = n
  }

  get globalCompositeOperation(): GpuixCompositeOperation {
    return this.state.composite
  }

  set globalCompositeOperation(value: GpuixCompositeOperation) {
    if (typeof value === "string" && COMPOSITE_OPERATIONS.has(value)) {
      this.state.composite = value
    }
  }

  get imageSmoothingEnabled(): boolean {
    return this.state.imageSmoothingEnabled
  }

  set imageSmoothingEnabled(value: boolean) {
    this.state.imageSmoothingEnabled = !!value
  }

  setLineDash(segments: number[]): void {
    if (!Array.isArray(segments)) return
    const converted = segments.map((v) => Number(v))
    if (!converted.every((v) => Number.isFinite(v) && v >= 0)) return
    let dash = [...converted]
    if (dash.length % 2 === 1) dash = dash.concat(dash)
    this.state.lineDash = dash
  }

  getLineDash(): number[] {
    return [...this.state.lineDash]
  }

  // ── State stack ──────────────────────────────────────────────────────

  save(): void {
    this.stack.push(copyState(this.state))
  }

  restore(): void {
    const restored = this.stack.pop()
    if (restored) this.state = restored
  }

  // ── Transforms ───────────────────────────────────────────────────────

  getTransform(): GpuixMatrix2D {
    const { a, b, c, d, e, f } = this.state.m
    return {
      a,
      b,
      c,
      d,
      e,
      f,
      isIdentity: a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0,
    }
  }

  setTransform(
    transform?: GpuixMatrix2D | number,
    b?: number,
    c?: number,
    d?: number,
    e?: number,
    f?: number,
  ): void {
    // Two call shapes share the name: setTransform(matrix) and
    // setTransform(a, b, c, d, e, f). A leading number is the six-argument
    // form — the DOM shifts it into the `a` slot, it does not swallow it.
    if (typeof transform === "number") {
      const ma = transform
      if (b === undefined || c === undefined || d === undefined || e === undefined || f === undefined) return
      if (finite(ma, b, c, d, e, f)) {
        this.state.m = { a: ma, b, c, d, e, f }
      }
      return
    }
    if (transform && typeof transform === "object") {
      const { a: ma, b: mb, c: mc, d: md, e: me, f: mf } = transform
      if (finite(ma, mb, mc, md, me, mf)) this.state.m = { a: ma, b: mb, c: mc, d: md, e: me, f: mf }
      return
    }
    // setTransform() with no arguments resets to the identity matrix.
    this.state.m = identityMatrix()
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    if (!finite(a, b, c, d, e, f)) return
    // DOM accumulation: the new matrix applies to the point FIRST, then the
    // existing one — drawing happens "inside" the current frame.
    this.state.m = multiplyMatrix({ a, b, c, d, e, f }, this.state.m)
  }

  translate(tx: number, ty: number): void {
    if (!finite(tx, ty)) return
    this.state.m = multiplyMatrix(translationMatrix(tx, ty), this.state.m)
  }

  rotate(angle: number): void {
    if (!finite(angle)) return
    this.state.m = multiplyMatrix(rotationMatrix(angle), this.state.m)
  }

  scale(sx: number, sy: number): void {
    if (!finite(sx, sy)) return
    this.state.m = multiplyMatrix(scalingMatrix(sx, sy), this.state.m)
  }

  resetTransform(): void {
    this.state.m = identityMatrix()
  }

  /** DOM `reset()`: back to a freshly created context — default state, empty
   *  path, cleared bitmap — keeping the current size. */
  reset(): void {
    this.resetTransform()
    this.premul.fill(0)
    this.cover.data.fill(0)
    this.state = defaultState()
    this.stack = []
    this.path = new GpuixPathBuilder()
    this.scheduleUpload()
  }

  // ── Path building (user space; the CTM is baked in per segment) ────────

  beginPath(): void {
    this.path = new GpuixPathBuilder()
  }

  moveTo(x: number, y: number): void {
    this.path.moveTo(x, y, this.state.m)
  }

  lineTo(x: number, y: number): void {
    this.path.lineTo(x, y, this.state.m)
  }

  closePath(): void {
    this.path.closePath()
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.path.quadraticCurveTo(cpx, cpy, x, y, this.state.m)
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.path.bezierCurveTo(c1x, c1y, c2x, c2y, x, y, this.state.m)
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    this.path.arcTo(x1, y1, x2, y2, radius, this.state.m)
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, anticlockwise?: boolean): void {
    this.path.arc(x, y, radius, startAngle, endAngle, anticlockwise, this.state.m)
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    anticlockwise?: boolean,
  ): void {
    this.path.ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, anticlockwise, this.state.m)
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.path.rect(x, y, w, h, this.state.m)
  }

  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii?: number | Array<number | { x?: number; y?: number }>,
  ): void {
    this.path.roundRect(x, y, w, h, radii ?? 0, this.state.m)
  }

  // ── Drawing ──────────────────────────────────────────────────────────

  fill(fillRule: GpuixFillRule = "nonzero"): void {
    // The path already carries its construction-time matrices; drawing does
    // not re-transform it.
    const polys = flattenPath(this.path.subpaths, 0.15)
    this.paintPolys(polys, fillRule, "fill")
  }

  stroke(): void {
    this.strokeBuilderPath(this.path)
  }

  clip(fillRule: GpuixFillRule = "nonzero"): void {
    const polys = flattenPath(this.path.subpaths, 0.15)
    this.cover.data.fill(0)
    const bbox = rasterizeCoverage(polys, fillRule, this.cover)
    const next = new Float32Array(this.width * this.height)
    if (bbox) {
      const current = this.state.clip
      if (current) {
        for (let i = 0; i < next.length; i++) {
          next[i] = current[i]! * this.cover.data[i]!
        }
      } else {
        next.set(this.cover.data)
      }
    }
    // Without a bbox the clip path was empty: the region becomes empty too
    // (an all-zero mask), so later draws touch nothing.
    this.state.clip = next
  }

  /** The point is in device space — the DOM hit-tests the bitmap, not the
   *  current user space. */
  isPointInPath(x: number, y: number, fillRule: GpuixFillRule = "nonzero"): boolean {
    if (!finite(x, y)) return false
    const polys = flattenPath(this.path.subpaths, 0.15)
    return pointInPolys(polys, x, y, fillRule)
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    if (!finite(x, y, w, h)) return
    const builder = new GpuixPathBuilder()
    builder.rect(x, y, w, h, this.state.m)
    const polys = flattenPath(builder.subpaths, 0.15)
    this.paintPolys(polys, "nonzero", "fill")
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    // A zero extent strokes the degenerate line — its band is visible, like
    // the DOM. Only non-finite arguments make the call a no-op.
    if (!finite(x, y, w, h)) return
    const builder = new GpuixPathBuilder()
    builder.rect(x, y, w, h, this.state.m)
    this.strokeBuilderPath(builder)
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    if (!finite(x, y, w, h) || w === 0 || h === 0) return
    const builder = new GpuixPathBuilder()
    builder.rect(x, y, w, h, this.state.m)
    const polys = flattenPath(builder.subpaths, 0.15)
    this.cover.data.fill(0)
    const bbox = rasterizeCoverage(polys, "nonzero", this.cover)
    if (!bbox) return
    const clip = this.state.clip
    const { width, data } = this.cover
    for (let row = bbox.minY; row <= bbox.maxY; row++) {
      const base = row * width
      for (let col = bbox.minX; col <= bbox.maxX; col++) {
        const idx = base + col
        let e = data[idx]!
        if (e <= 0) continue
        if (clip) e *= clip[idx]!
        if (e <= 0) continue
        const p = idx * 4
        const keep = 1 - e
        this.premul[p] = this.premul[p]! * keep
        this.premul[p + 1] = this.premul[p + 1]! * keep
        this.premul[p + 2] = this.premul[p + 2]! * keep
        this.premul[p + 3] = this.premul[p + 3]! * keep
      }
    }
    this.scheduleUpload()
  }

  // ── Gradients ────────────────────────────────────────────────────────

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): GpuixCanvasGradient {
    if (!finite(x0, y0, x1, y1)) {
      throw new TypeError("createLinearGradient: arguments must be finite")
    }
    return new GpuixCanvasGradient("linear", x0, y0, 0, x1, y1, 0)
  }

  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): GpuixCanvasGradient {
    if (!finite(x0, y0, r0, x1, y1, r1)) {
      throw new TypeError("createRadialGradient: arguments must be finite")
    }
    if (r0 < 0 || r1 < 0) {
      throw new DOMException("createRadialGradient: radii must not be negative", "IndexSizeError")
    }
    return new GpuixCanvasGradient("radial", x0, y0, r0, x1, y1, r1)
  }

  // ── Images ───────────────────────────────────────────────────────────

  drawImage(
    source: GpuixDrawImageSource,
    a1: number,
    a2: number,
    a3?: number,
    a4?: number,
    a5?: number,
    a6?: number,
    a7?: number,
    a8?: number,
  ): void {
    const srcCtx = source.getContext("2d")
    if (!srcCtx) return
    if (!finite(a1, a2) || (a3 !== undefined && !finite(a3)) || (a4 !== undefined && !finite(a4))) return

    // 3-arg: (dx, dy). 5-arg: (dx, dy, dw, dh). 9-arg: (sx, sy, sw, sh, dx, dy, dw, dh).
    let srcX = 0
    let srcY = 0
    let srcW = srcCtx.width
    let srcH = srcCtx.height
    let dstX: number
    let dstY: number
    let dstW: number
    let dstH: number
    if (a5 !== undefined && a6 !== undefined && a7 !== undefined && a8 !== undefined) {
      if (!finite(a5, a6, a7, a8)) return
      srcX = a1
      srcY = a2
      srcW = a3 ?? srcW
      srcH = a4 ?? srcH
      dstX = a5
      dstY = a6
      dstW = a7
      dstH = a8
    } else if (a3 !== undefined && a4 !== undefined) {
      dstX = a1
      dstY = a2
      dstW = a3
      dstH = a4
    } else {
      dstX = a1
      dstY = a2
      dstW = srcW
      dstH = srcH
    }
    if (srcW === 0 || srcH === 0 || dstW === 0 || dstH === 0) return
    if (srcW < 0) {
      srcX += srcW
      srcW = -srcW
    }
    if (srcH < 0) {
      srcY += srcH
      srcH = -srcH
    }
    if (dstW < 0) {
      dstX += dstW
      dstW = -dstW
    }
    if (dstH < 0) {
      dstY += dstH
      dstH = -dstH
    }

    // Snapshot the source region — required for correctness when drawing a
    // canvas onto itself, and it bounds the sampling reads either way.
    const snap = snapshotRegion(srcCtx, srcX, srcY, srcW, srcH)
    if (!snap) return

    const m = this.state.m
    const inv = invertMatrix(m)
    if (!inv) return
    const quad: Poly = {
      pts: [
        ...applyMatrix(m, dstX, dstY),
        ...applyMatrix(m, dstX + dstW, dstY),
        ...applyMatrix(m, dstX + dstW, dstY + dstH),
        ...applyMatrix(m, dstX, dstY + dstH),
      ],
      closed: true,
    }
    this.cover.data.fill(0)
    const bbox = rasterizeCoverage([quad], "nonzero", this.cover)
    if (!bbox) return
    if (this.state.composite === "copy") this.premul.fill(0)

    const clip = this.state.clip
    const alpha = this.state.globalAlpha
    const smoothing = this.state.imageSmoothingEnabled
    const composite = this.state.composite
    const { width, data } = this.cover

    for (let row = bbox.minY; row <= bbox.maxY; row++) {
      const base = row * width
      for (let col = bbox.minX; col <= bbox.maxX; col++) {
        const idx = base + col
        const cov = data[idx]!
        if (cov <= 0) continue
        let e = cov * alpha
        if (clip) e *= clip[idx]!
        if (e <= 1 / 510) continue
        const [ux, uy] = applyMatrix(inv, col + 0.5, row + 0.5)
        const su = srcX + ((ux - dstX) / dstW) * srcW
        const sv = srcY + ((uy - dstY) / dstH) * srcH
        const rgba = smoothing
          ? sampleBilinear(snap, su - srcX, sv - srcY)
          : sampleNearest(snap, su - srcX, sv - srcY)
        const srcAlpha = rgba[3]! / 255
        if (srcAlpha <= 0) continue
        const eff = e * srcAlpha
        this.compositePixel(idx * 4, rgba, eff, composite)
      }
    }
    this.scheduleUpload()
  }

  createImageData(widthOrImage: number | GpuixImageData, height?: number): GpuixImageData {
    if (!(this instanceof GpuixCanvasRenderingContext2D)) {
      throw new TypeError("createImageData must be called on a GpuixCanvasRenderingContext2D")
    }
    if (typeof widthOrImage === "number") {
      if (height === undefined) {
        throw new TypeError("createImageData: constructor needs both dimensions")
      }
      // WebIDL: convert, truncate, and use the absolute magnitude; a
      // non-finite value is a TypeError, a zero result an IndexSizeError.
      const w = Math.trunc(Number(widthOrImage))
      const h = Math.trunc(Number(height))
      if (!Number.isFinite(w) || !Number.isFinite(h)) {
        throw new TypeError("createImageData: dimensions must be finite")
      }
      return new GpuixImageData(Math.abs(w), Math.abs(h))
    }
    return new GpuixImageData(widthOrImage.width, widthOrImage.height)
  }

  getImageData(sx: number, sy: number, sw: number, sh: number): GpuixImageData {
    if (!(this instanceof GpuixCanvasRenderingContext2D)) {
      throw new TypeError("getImageData must be called on a GpuixCanvasRenderingContext2D")
    }
    // WebIDL `long` conversions: truncate, and reject non-finite values.
    const numbers = [sx, sy, sw, sh].map((v) => Math.trunc(Number(v)))
    if (numbers.some((n) => !Number.isFinite(n))) {
      throw new TypeError("getImageData: arguments must be finite")
    }
    const [x, y, w, h] = numbers
    if (w === 0 || h === 0) {
      throw new DOMException("getImageData: width and height must not be zero", "IndexSizeError")
    }
    let left = x
    let top = y
    let width = w
    let height = h
    if (width < 0) {
      left += width
      width = -width
    }
    if (height < 0) {
      top += height
      height = -height
    }
    const data = new Uint8ClampedArray(width * height * 4)
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const px = left + col
        const py = top + row
        if (px < 0 || py < 0 || px >= this.width || py >= this.height) continue
        const src = (py * this.width + px) * 4
        const dst = (row * width + col) * 4
        const a = this.premul[src + 3]!
        if (a === 0) continue
        data[dst] = unpremultiply(this.premul[src]!, a)
        data[dst + 1] = unpremultiply(this.premul[src + 1]!, a)
        data[dst + 2] = unpremultiply(this.premul[src + 2]!, a)
        data[dst + 3] = a
      }
    }
    return new GpuixImageData(data, width, height)
  }

  putImageData(
    imagedata: GpuixImageData,
    dx: number,
    dy: number,
    dirtyX = 0,
    dirtyY = 0,
    dirtyWidth?: number,
    dirtyHeight?: number,
  ): void {
    if (!(imagedata instanceof GpuixImageData)) {
      throw new TypeError("putImageData: first argument must be ImageData")
    }
    const numbers = [dx, dy, dirtyX, dirtyY, dirtyWidth ?? 0, dirtyHeight ?? 0].map((v) =>
      Math.trunc(Number(v)),
    )
    if (numbers.some((n) => !Number.isFinite(n))) {
      throw new TypeError("putImageData: arguments must be finite")
    }
    const [destX, destY] = numbers
    // The dirty rectangle normalizes its corners, so a negative width or
    // height swaps sides instead of emptying the rectangle.
    let x0 = numbers[2]
    let y0 = numbers[3]
    let x1 = x0 + numbers[4]
    let y1 = y0 + numbers[5]
    if (dirtyWidth === undefined) x1 = imagedata.width
    if (dirtyHeight === undefined) y1 = imagedata.height
    if (x1 < x0) [x0, x1] = [x1, x0]
    if (y1 < y0) [y0, y1] = [y1, y0]
    for (let row = y0; row < y1; row++) {
      const dstY = destY + row
      if (dstY < 0 || dstY >= this.height) continue
      for (let col = x0; col < x1; col++) {
        const dstX = destX + col
        if (dstX < 0 || dstX >= this.width) continue
        if (row < 0 || col < 0 || row >= imagedata.height || col >= imagedata.width) continue
        const src = (row * imagedata.width + col) * 4
        const dst = (dstY * this.width + dstX) * 4
        const a = imagedata.data[src + 3]!
        this.premul[dst] = (imagedata.data[src]! * a) / 255
        this.premul[dst + 1] = (imagedata.data[src + 1]! * a) / 255
        this.premul[dst + 2] = (imagedata.data[src + 2]! * a) / 255
        this.premul[dst + 3] = a
      }
    }
    this.scheduleUpload()
  }

  // ── Text — deliberately unsupported ──────────────────────────────────

  fillText(_text: string, _x: number, _y: number, _maxWidth?: number): void {
    throw new Error(NOT_SUPPORTED_TEXT)
  }

  strokeText(_text: string, _x: number, _y: number, _maxWidth?: number): void {
    throw new Error(NOT_SUPPORTED_TEXT)
  }

  measureText(_text: string): GpuixTextMetrics {
    throw new Error(NOT_SUPPORTED_TEXT)
  }

  // ── Internals ────────────────────────────────────────────────────────

  /** @internal — source-buffer access for `drawImage` on this context. */
  getBacking(): { width: number; height: number; premul: Uint8ClampedArray } {
    return { width: this.width, height: this.height, premul: this.premul }
  }

  /** @internal — how many mutating draws ran; lets tests tell "drew
   *  nothing" from "drew and matched". */
  get stats(): { drawCount: number } {
    return { drawCount: this.drawCount }
  }

  /** Shared paint path for fill(), stroke(), fillRect(), strokeRect().
   *  Strokes are unions of same-orientation pieces, which additive nonzero
   *  spans resolve exactly — including the AA across piece seams. */
  private paintPolys(polys: Poly[], rule: FillRule, which: "fill" | "stroke"): void {
    if (polys.length === 0) return
    this.cover.data.fill(0)
    const bbox = rasterizeCoverage(polys, rule, this.cover)
    if (!bbox) return
    if (this.state.composite === "copy") this.premul.fill(0)

    const style = which === "fill" ? this.state.fillStyle : this.state.strokeStyle
    const solid = which === "fill" ? this.state.fill : this.state.stroke
    const gradient = style instanceof GpuixCanvasGradient ? style : null
    const alpha = this.state.globalAlpha
    const composite = this.state.composite
    const clip = this.state.clip
    const m = this.state.m
    const { width, data } = this.cover

    const rgba: RgbaColor = { r: 0, g: 0, b: 0, a: 0 }
    if (gradient) {
      // Degenerate gradients (zero-length axis, identical circles) paint
      // nothing at all — the whole fill is a no-op.
      if (gradient.empty) return
    }
    for (let row = bbox.minY; row <= bbox.maxY; row++) {
      const base = row * width
      for (let col = bbox.minX; col <= bbox.maxX; col++) {
        const idx = base + col
        const cov = data[idx]!
        if (cov <= 0) continue
        let e = cov * alpha
        if (clip) e *= clip[idx]!
        if (e <= 1 / 510) continue
        if (gradient) {
          const sampled = gradient.evaluateDevice(col + 0.5, row + 0.5, m)
          if (!sampled) continue // outside the gradient's reach: untouched
          rgba.r = sampled.r
          rgba.g = sampled.g
          rgba.b = sampled.b
          e *= sampled.a
          if (e <= 1 / 510) continue
        } else if (solid) {
          e *= solid.a
          if (e <= 1 / 510) continue
          rgba.r = solid.r
          rgba.g = solid.g
          rgba.b = solid.b
        } else {
          return
        }
        this.compositePixel(idx * 4, [rgba.r, rgba.g, rgba.b, 255], e, composite)
      }
    }
    this.scheduleUpload()
  }

  /** Stroke with DOM semantics: the path flattens in device space (its
   *  segments carry their construction-time CTM), then maps back through the
   *  CURRENT matrix so the outline — and the line width — live in user
   *  space, and maps forward again. This is what makes a scaled transform
   *  widen strokes without re-transforming the baked-in path. */
  private strokeBuilderPath(builder: GpuixPathBuilder): void {
    const m = this.state.m
    const inv = invertMatrix(m)
    if (!inv) return // a non-invertible CTM strokes nothing
    // Flatten tighter for wide strokes: a centerline chord error of ε shows
    // up on the offset outline amplified by roughly (1 + h/r) at the local
    // curvature radius, so wide curves need a much finer polyline.
    const halfWidthDevice = (this.state.lineWidth / 2) * maxScaleOf(m)
    const tol = Math.max(1e-4, 0.15 / (1 + halfWidthDevice))
    const devicePolys = flattenPath(builder.subpaths, tol)
    const userPolys = devicePolys.map((poly) => transformPoly(poly, inv))
    const params: StrokeParams = {
      lineWidth: this.state.lineWidth,
      lineCap: this.state.lineCap,
      lineJoin: this.state.lineJoin,
      miterLimit: this.state.miterLimit,
      lineDash: this.state.lineDash,
      lineDashOffset: this.state.lineDashOffset,
    }
    const outlines = buildStrokeGeometry(userPolys, params)
    const polys = outlines.map((poly) => transformPoly(poly, m))
    this.paintPolys(polys, "nonzero", "stroke")
  }

  /** Blend a straight-RGBA source into the premultiplied buffer at `p`,
   *  with `e` the effective source alpha (coverage × style × global). Blend
   *  modes beyond the Porter-Duff set rasterize as `source-over` for now. */
  private compositePixel(
    p: number,
    rgba: ArrayLike<number>,
    e: number,
    composite: GpuixCompositeOperation,
  ): void {
    const premul = this.premul
    const dstA = premul[p + 3]! / 255

    if (composite === "clear" || composite === "destination-out") {
      const keep = 1 - e
      premul[p] = premul[p]! * keep
      premul[p + 1] = premul[p + 1]! * keep
      premul[p + 2] = premul[p + 2]! * keep
      premul[p + 3] = premul[p + 3]! * keep
      return
    }
    if (composite === "copy") {
      premul[p] = rgba[0]! * e
      premul[p + 1] = rgba[1]! * e
      premul[p + 2] = rgba[2]! * e
      premul[p + 3] = 255 * e
      return
    }
    if (composite === "xor") {
      // Porter-Duff Xor: source shows only where the destination is empty,
      // and vice versa.
      const keepDst = 1 - e
      const srcR = rgba[0]! * e * (1 - dstA)
      const srcG = rgba[1]! * e * (1 - dstA)
      const srcB = rgba[2]! * e * (1 - dstA)
      const srcA = e * (1 - dstA)
      premul[p] = srcR + premul[p]! * keepDst
      premul[p + 1] = srcG + premul[p + 1]! * keepDst
      premul[p + 2] = srcB + premul[p + 2]! * keepDst
      premul[p + 3] = 255 * (srcA + dstA * keepDst)
      return
    }
    if (composite === "lighter") {
      premul[p] = Math.min(255, premul[p]! + rgba[0]! * e)
      premul[p + 1] = Math.min(255, premul[p + 1]! + rgba[1]! * e)
      premul[p + 2] = Math.min(255, premul[p + 2]! + rgba[2]! * e)
      premul[p + 3] = Math.min(255, premul[p + 3]! + 255 * e)
      return
    }
    if (composite === "destination-over") {
      const back = 1 - dstA
      premul[p] = rgba[0]! * e * back + premul[p]!
      premul[p + 1] = rgba[1]! * e * back + premul[p + 1]!
      premul[p + 2] = rgba[2]! * e * back + premul[p + 2]!
      premul[p + 3] = 255 * (e + dstA * back)
      return
    }
    if (composite === "source-in" || composite === "source-out" || composite === "source-atop" || composite === "destination-in" || composite === "destination-atop") {
      let outR = 0
      let outG = 0
      let outB = 0
      let outA = 0
      const srcR = rgba[0]! * e
      const srcG = rgba[1]! * e
      const srcB = rgba[2]! * e
      switch (composite) {
        case "source-in":
          outA = e * dstA
          outR = srcR * dstA
          outG = srcG * dstA
          outB = srcB * dstA
          break
        case "source-out":
          outA = e * (1 - dstA)
          outR = srcR * (1 - dstA)
          outG = srcG * (1 - dstA)
          outB = srcB * (1 - dstA)
          break
        case "source-atop":
          outA = dstA
          outR = srcR * dstA + premul[p]! * (1 - e)
          outG = srcG * dstA + premul[p + 1]! * (1 - e)
          outB = srcB * dstA + premul[p + 2]! * (1 - e)
          break
        case "destination-in":
          outA = dstA * e
          outR = premul[p]! * e
          outG = premul[p + 1]! * e
          outB = premul[p + 2]! * e
          break
        case "destination-atop":
          outA = e + dstA * (1 - e)
          outR = srcR + premul[p]! * (1 - e)
          outG = srcG + premul[p + 1]! * (1 - e)
          outB = srcB + premul[p + 2]! * (1 - e)
          break
      }
      premul[p] = outR
      premul[p + 1] = outG
      premul[p + 2] = outB
      premul[p + 3] = 255 * outA
      return
    }
    const ia = 1 - e
    premul[p] = rgba[0]! * e + premul[p]! * ia
    premul[p + 1] = rgba[1]! * e + premul[p + 1]! * ia
    premul[p + 2] = rgba[2]! * e + premul[p + 2]! * ia
    premul[p + 3] = 255 * e + premul[p + 3]! * ia
  }

  /** One upload per microtask, however many draws the task made. */
  private scheduleUpload(): void {
    this.drawCount++
    if (this.disposed || this.uploadScheduled) return
    this.uploadScheduled = true
    queueMicrotask(() => {
      this.uploadScheduled = false
      if (this.disposed) return
      const target = this.getUpload()
      if (!target?.renderer.uploadCanvasPixels) return
      const straight = this.straightScratch ?? new Uint8Array(this.width * this.height * 4)
      this.straightScratch = straight
      const premul = this.premul
      for (let i = 0; i < straight.length; i += 4) {
        const a = premul[i + 3]!
        if (a === 0) {
          straight[i] = 0
          straight[i + 1] = 0
          straight[i + 2] = 0
          straight[i + 3] = 0
        } else {
          straight[i] = unpremultiply(premul[i]!, a)
          straight[i + 1] = unpremultiply(premul[i + 1]!, a)
          straight[i + 2] = unpremultiply(premul[i + 2]!, a)
          straight[i + 3] = a
        }
      }
      target.renderer.uploadCanvasPixels(target.id, this.width, this.height, straight)
    })
  }
}

function defaultState(): DrawingState {
  return {
    m: identityMatrix(),
    clip: null,
    fillStyle: "#000000",
    fill: parseColor("#000000")!,
    strokeStyle: "#000000",
    stroke: parseColor("#000000")!,
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    lineDash: [],
    lineDashOffset: 0,
    composite: "source-over",
    imageSmoothingEnabled: true,
  }
}

function copyState(state: DrawingState): DrawingState {
  return { ...state, m: { ...state.m }, lineDash: [...state.lineDash] }
}

function transformPoly(poly: Poly, m: GpuixMatrix2D): Poly {
  const pts = new Array<number>(poly.pts.length)
  for (let i = 0; i < poly.pts.length; i += 2) {
    const [x, y] = applyMatrix(m, poly.pts[i]!, poly.pts[i + 1]!)
    pts[i] = x
    pts[i + 1] = y
  }
  return { pts, closed: poly.closed }
}

function unpremultiply(p: number, a: number): number {
  return Math.min(255, Math.round((p * 255) / a))
}

interface SourceSnapshot {
  data: Uint8ClampedArray
  width: number
  height: number
  /** Snapshot origin within the requested source rect, for sampling. */
  ox: number
  oy: number
}

/** Copy a source-rect region of another context's premultiplied buffer,
 *  clipped to its bounds; null when the intersection is empty. */
function snapshotRegion(
  srcCtx: GpuixCanvasRenderingContext2D,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): SourceSnapshot | null {
  const backing = srcCtx.getBacking()
  const x0 = Math.max(0, Math.floor(sx))
  const y0 = Math.max(0, Math.floor(sy))
  const x1 = Math.min(backing.width, Math.ceil(sx + sw))
  const y1 = Math.min(backing.height, Math.ceil(sy + sh))
  if (x1 <= x0 || y1 <= y0) return null
  const w = x1 - x0
  const h = y1 - y0
  const data = new Uint8ClampedArray(w * h * 4)
  for (let row = 0; row < h; row++) {
    const srcBase = ((y0 + row) * backing.width + x0) * 4
    data.set(backing.premul.subarray(srcBase, srcBase + w * 4), row * w * 4)
  }
  return { data, width: w, height: h, ox: x0 - sx, oy: y0 - sy }
}

// Sampling helpers work in snapshot-local pixel coordinates.
function sampleNearest(snap: SourceSnapshot, u: number, v: number): [number, number, number, number] {
  const px = Math.floor(u + snap.ox)
  const py = Math.floor(v + snap.oy)
  if (px < 0 || py < 0 || px >= snap.width || py >= snap.height) return [0, 0, 0, 0]
  return unpremulPixel(snap.data, (py * snap.width + px) * 4)
}

function sampleBilinear(snap: SourceSnapshot, u: number, v: number): [number, number, number, number] {
  const fx = u + snap.ox - 0.5
  const fy = v + snap.oy - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  // Blend in premultiplied space (translucent edges stay symmetric), then
  // un-premultiply once at the end.
  const corners: Array<[number, number, number, number]> = []
  for (const [ox, oy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    const px = x0 + ox
    const py = y0 + oy
    if (px < 0 || py < 0 || px >= snap.width || py >= snap.height) {
      corners.push([0, 0, 0, 0])
    } else {
      const i = (py * snap.width + px) * 4
      const d = snap.data
      corners.push([d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!])
    }
  }
  const top = blendStraight(corners[0]!, corners[1]!, tx)
  const bottom = blendStraight(corners[2]!, corners[3]!, tx)
  const blended = blendStraight(top, bottom, ty)
  const a = blended[3]
  if (a <= 0) return [0, 0, 0, 0]
  return [unpremultiply(blended[0], a), unpremultiply(blended[1], a), unpremultiply(blended[2], a), a]
}

function blendStraight(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
}

function unpremulPixel(data: Uint8ClampedArray, i: number): [number, number, number, number] {
  const a = data[i + 3]!
  if (a === 0) return [0, 0, 0, 0]
  return [unpremultiply(data[i]!, a), unpremultiply(data[i + 1]!, a), unpremultiply(data[i + 2]!, a), a]
}
