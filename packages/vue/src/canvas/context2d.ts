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

import { parseColor, type RgbaColor } from "./color.js"
import { GpuixCanvasGradient } from "./gradient.js"
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

export type GpuixLineCap = "butt" | "round" | "square"
export type GpuixLineJoin = "round" | "bevel" | "miter"
export type GpuixCompositeOperation = "source-over" | "destination-out" | "copy"
export type GpuixFillRule = "nonzero" | "evenodd"
export type GpuixFillStyle = string | GpuixCanvasGradient

export interface GpuixImageData {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
  readonly colorSpace: "srgb"
}

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

  constructor(width: number, height: number, getUpload: () => GpuixUploadTarget | null) {
    this.width = Math.max(1, Math.floor(width) || 1)
    this.height = Math.max(1, Math.floor(height) || 1)
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
    this.width = Math.max(1, Math.floor(width) || 1)
    this.height = Math.max(1, Math.floor(height) || 1)
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
    return this.state.fillStyle
  }

  set fillStyle(value: GpuixFillStyle) {
    if (typeof value === "string") {
      const parsed = parseColor(value)
      if (!parsed) return // invalid assignments leave the style untouched
      this.state.fillStyle = value
      this.state.fill = parsed
    } else if (value instanceof GpuixCanvasGradient) {
      this.state.fillStyle = value
      this.state.fill = null
    }
  }

  get strokeStyle(): GpuixFillStyle {
    return this.state.strokeStyle
  }

  set strokeStyle(value: GpuixFillStyle) {
    if (typeof value === "string") {
      const parsed = parseColor(value)
      if (!parsed) return
      this.state.strokeStyle = value
      this.state.stroke = parsed
    } else if (value instanceof GpuixCanvasGradient) {
      this.state.strokeStyle = value
      this.state.stroke = null
    }
  }

  get globalAlpha(): number {
    return this.state.globalAlpha
  }

  set globalAlpha(value: number) {
    if (finite(value) && value >= 0 && value <= 1) this.state.globalAlpha = value
  }

  get lineWidth(): number {
    return this.state.lineWidth
  }

  set lineWidth(value: number) {
    if (finite(value) && value > 0) this.state.lineWidth = value
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
    if (finite(value) && value > 0) this.state.miterLimit = value
  }

  get lineDashOffset(): number {
    return this.state.lineDashOffset
  }

  set lineDashOffset(value: number) {
    if (finite(value)) this.state.lineDashOffset = value
  }

  get globalCompositeOperation(): GpuixCompositeOperation {
    return this.state.composite
  }

  set globalCompositeOperation(value: GpuixCompositeOperation) {
    if (value === "source-over" || value === "destination-out" || value === "copy") {
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
    if (!segments.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0)) return
    let dash = [...segments]
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
    return { ...this.state.m }
  }

  setTransform(transform?: GpuixMatrix2D, a?: number, b?: number, c?: number, d?: number, e?: number, f?: number): void {
    if (transform && typeof transform === "object") {
      const { a: ma, b: mb, c: mc, d: md, e: me, f: mf } = transform
      if (finite(ma, mb, mc, md, me, mf)) this.state.m = { a: ma, b: mb, c: mc, d: md, e: me, f: mf }
      return
    }
    if (a === undefined) {
      this.state.m = identityMatrix()
      return
    }
    if (b === undefined || c === undefined || d === undefined || e === undefined || f === undefined) return
    if (finite(a, b, c, d, e, f)) {
      this.state.m = { a, b, c, d, e, f }
    }
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

  // ── Path building (user space) ────────────────────────────────────────

  beginPath(): void {
    this.path = new GpuixPathBuilder()
  }

  moveTo(x: number, y: number): void {
    this.path.moveTo(x, y)
  }

  lineTo(x: number, y: number): void {
    this.path.lineTo(x, y)
  }

  closePath(): void {
    this.path.closePath()
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.path.quadraticCurveTo(cpx, cpy, x, y)
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.path.bezierCurveTo(c1x, c1y, c2x, c2y, x, y)
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    this.path.arcTo(x1, y1, x2, y2, radius)
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, anticlockwise?: boolean): void {
    this.path.arc(x, y, radius, startAngle, endAngle, anticlockwise)
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
    this.path.ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, anticlockwise)
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.path.rect(x, y, w, h)
  }

  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii?: number | Array<number | { x?: number; y?: number }>,
  ): void {
    this.path.roundRect(x, y, w, h, radii ?? 0)
  }

  // ── Drawing ──────────────────────────────────────────────────────────

  fill(fillRule: GpuixFillRule = "nonzero"): void {
    const polys = flattenPath(this.path.subpaths, this.state.m, 0.15)
    this.paintPolys(polys, fillRule, "fill")
  }

  stroke(): void {
    // Stroke geometry is built in user space, so the CTM (however skewed)
    // shapes it exactly like the DOM. The path is flattened at identity with
    // a tolerance tightened by the transform's max scale.
    const tol = 0.15 / Math.max(1e-6, maxScaleOf(this.state.m))
    const userPolys = flattenPath(this.path.subpaths, identityMatrix(), tol)
    const params: StrokeParams = {
      lineWidth: this.state.lineWidth,
      lineCap: this.state.lineCap,
      lineJoin: this.state.lineJoin,
      miterLimit: this.state.miterLimit,
      lineDash: this.state.lineDash,
      lineDashOffset: this.state.lineDashOffset,
    }
    const outlines = buildStrokeGeometry(userPolys, params)
    const polys = outlines.map((poly) => transformPoly(poly, this.state.m))
    this.paintPolys(polys, "nonzero", "stroke")
  }

  clip(fillRule: GpuixFillRule = "nonzero"): void {
    const polys = flattenPath(this.path.subpaths, this.state.m, 0.15)
    this.cover.data.fill(0)
    const bbox = rasterizeCoverage(polys, fillRule, this.cover)
    if (!bbox) return
    const next = new Float32Array(this.width * this.height)
    const current = this.state.clip
    if (current) {
      for (let i = 0; i < next.length; i++) {
        next[i] = current[i]! * this.cover.data[i]!
      }
    } else {
      next.set(this.cover.data)
    }
    this.state.clip = next
  }

  isPointInPath(x: number, y: number, fillRule: GpuixFillRule = "nonzero"): boolean {
    if (!finite(x, y)) return false
    const polys = flattenPath(this.path.subpaths, this.state.m, 0.15)
    return pointInPolys(polys, x, y, fillRule)
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    if (!finite(x, y, w, h)) return
    const builder = new GpuixPathBuilder()
    builder.rect(x, y, w, h)
    const polys = flattenPath(builder.subpaths, this.state.m, 0.15)
    this.paintPolys(polys, "nonzero", "fill")
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    if (!finite(x, y, w, h)) return
    const builder = new GpuixPathBuilder()
    builder.rect(x, y, w, h)
    this.strokeBuilderPath(builder)
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    if (!finite(x, y, w, h) || w === 0 || h === 0) return
    const builder = new GpuixPathBuilder()
    builder.rect(x, y, w, h)
    const polys = flattenPath(builder.subpaths, this.state.m, 0.15)
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
    if (r0 < 0 || r1 < 0) {
      throw new Error("createRadialGradient: radii must not be negative")
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
    let w: number
    let h: number
    if (typeof widthOrImage === "number") {
      w = widthOrImage
      h = height ?? 0
    } else {
      w = widthOrImage.width
      h = widthOrImage.height
    }
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
      throw new Error("createImageData: dimensions must be positive integers")
    }
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" }
  }

  getImageData(sx: number, sy: number, sw: number, sh: number): GpuixImageData {
    if (sw === 0 || sh === 0) {
      throw new Error("getImageData: width and height must not be zero")
    }
    let x = sx
    let y = sy
    let w = sw
    let h = sh
    if (w < 0) {
      x += w
      w = -w
    }
    if (h < 0) {
      y += h
      h = -h
    }
    const data = new Uint8ClampedArray(w * h * 4)
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const px = Math.round(x) + col
        const py = Math.round(y) + row
        if (px < 0 || py < 0 || px >= this.width || py >= this.height) continue
        const src = (py * this.width + px) * 4
        const dst = (row * w + col) * 4
        const a = this.premul[src + 3]!
        if (a === 0) continue
        data[dst] = unpremultiply(this.premul[src]!, a)
        data[dst + 1] = unpremultiply(this.premul[src + 1]!, a)
        data[dst + 2] = unpremultiply(this.premul[src + 2]!, a)
        data[dst + 3] = a
      }
    }
    return { width: w, height: h, data, colorSpace: "srgb" }
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
    const w = dirtyWidth ?? imagedata.width - dirtyX
    const h = dirtyHeight ?? imagedata.height - dirtyY
    for (let row = 0; row < h; row++) {
      const dstY = dy + dirtyY + row
      if (dstY < 0 || dstY >= this.height) continue
      for (let col = 0; col < w; col++) {
        const dstX = dx + dirtyX + col
        if (dstX < 0 || dstX >= this.width) continue
        const src = ((dirtyY + row) * imagedata.width + (dirtyX + col)) * 4
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

  /** Shared paint path for fill(), stroke(), fillRect(), strokeRect(). */
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

  private strokeBuilderPath(builder: GpuixPathBuilder): void {
    const tol = 0.15 / Math.max(1e-6, maxScaleOf(this.state.m))
    const userPolys = flattenPath(builder.subpaths, identityMatrix(), tol)
    const params: StrokeParams = {
      lineWidth: this.state.lineWidth,
      lineCap: this.state.lineCap,
      lineJoin: this.state.lineJoin,
      miterLimit: this.state.miterLimit,
      lineDash: this.state.lineDash,
      lineDashOffset: this.state.lineDashOffset,
    }
    const outlines = buildStrokeGeometry(userPolys, params)
    const polys = outlines.map((poly) => transformPoly(poly, this.state.m))
    this.paintPolys(polys, "nonzero", "stroke")
  }

  /** Blend a straight-RGBA source into the premultiplied buffer at `p`,
   *  with `e` the effective source alpha (coverage × style × global). */
  private compositePixel(
    p: number,
    rgba: ArrayLike<number>,
    e: number,
    composite: GpuixCompositeOperation,
  ): void {
    const premul = this.premul
    if (composite === "destination-out") {
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
    const ia = 1 - e
    premul[p] = rgba[0]! * e + premul[p]! * ia
    premul[p + 1] = rgba[1]! * e + premul[p + 1]! * ia
    premul[p + 2] = rgba[2]! * e + premul[p + 2]! * ia
    premul[p + 3] = 255 * e + premul[p + 3]! * ia
  }

  /** One upload per microtask, however many draws the task made. */
  private scheduleUpload(): void {
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
