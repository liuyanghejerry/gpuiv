/**
 * `CanvasRenderingContext2D` for GPUIV — the WebIDL facade over the Rust
 * rasterization core (`GpuixCanvas2DCore` in `@gpuiv/native`).
 *
 * This layer owns everything script-visible except pixels: argument
 * conversion (valueOf objects, strings-as-numbers, truncation), validation
 * with DOM exception types, style parsing and getter serialization, and the
 * upload schedule. The native class owns the drawing state, the recorded
 * display list, and the premultiplied buffer — draws are recorded per call
 * and rasterized once per flush (upload or pixel read), Rust to Rust, so
 * pixel bytes never cross the bridge in either direction.
 *
 * Getters read a JS shadow of the drawing state, kept in lockstep because
 * every state mutation flows through one setter here (the same trick the
 * save/restore stack uses). Reads that depend on rasterized pixels or
 * geometry — `getImageData`, `isPointInPath`, `getTransform` — cross the
 * bridge synchronously instead.
 *
 * Deliberately NOT implemented (documented in README "Canvas"): text
 * (`fillText`/`strokeText`/`measureText` — they throw, glyph rasterization
 * is a separate project), `toDataURL`/`toBlob`, shadows, `filter`,
 * `createPattern`, conic gradients, WebGL, and `HTMLImageElement` as a
 * `drawImage` source (JS never sees decoded `<img>` pixels).
 */

import { GpuixCanvas2DCore } from "@gpuiv/native"
import { parseColor, serializeColor, type RgbaColor } from "./color.js"
import { GpuixCanvasGradient } from "./gradient.js"
import { GpuixImageData } from "./image-data.js"
import type { GpuixMatrix2D } from "./matrix.js"
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

/**
 * The JS-visible half of the drawing state — everything a getter returns.
 * The native core keeps the authoritative copy for drawing; the two stay in
 * lockstep because every mutation flows through one setter on this class.
 */
interface ShadowState {
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

/** WebIDL double conversion for a radius member; BigInt is the one
 *  input the DOM rejects with a TypeError instead of coercing. */
function radiusNumber(value: unknown): number {
  if (typeof value === "bigint") {
    throw new TypeError("roundRect: radii cannot be BigInt")
  }
  if (typeof value === "number") return value
  if (value === undefined || value === null) return 0
  return Number(value)
}

interface CornerRadii {
  rx: number
  ry: number
}

/** Normalize the `roundRect` radii argument: validate and throw the DOM
 *  exceptions, spread 1–3 corners to four, and scale oversized corners down
 *  uniformly like the spec's border-radius. Non-finite radii return null —
 *  the whole call is then a silent no-op. Pure JS: it must run before the
 *  bridge because the exception types and valueOf side effects are
 *  script-visible. */
function normalizeRoundRectRadii(
  radii: number | Array<number | { x?: number; y?: number }>,
  w: number,
  h: number,
): [CornerRadii, CornerRadii, CornerRadii, CornerRadii] | null {
  const seq: Array<number | { x?: unknown; y?: unknown }> = Array.isArray(radii)
    ? radii
    : [radii]
  if (seq.length === 0) {
    throw new RangeError("roundRect: radii must not be empty")
  }
  if (seq.length > 4) {
    throw new RangeError("roundRect: at most four radii")
  }
  const corners: CornerRadii[] = seq.map((entry) => {
    if (typeof entry === "number" || typeof entry === "bigint") {
      return { rx: radiusNumber(entry), ry: radiusNumber(entry) }
    }
    // DOMPointInit: members are independent and default to 0 when absent,
    // which is why `{}`, `[]` and `[undefined]` all mean "square corner".
    const rawX = (entry as { x?: unknown } | null | undefined)?.x
    const rawY = (entry as { y?: unknown } | null | undefined)?.y
    return {
      rx: radiusNumber(rawX === undefined ? 0 : rawX),
      ry: radiusNumber(rawY === undefined ? 0 : rawY),
    }
  })
  // Non-finite radii make the whole call a silent no-op; a finite negative
  // radius is the RangeError case.
  if (corners.some((c) => !Number.isFinite(c.rx) || !Number.isFinite(c.ry))) return null
  if (corners.some((c) => c.rx < 0 || c.ry < 0)) {
    throw new RangeError("roundRect: radii must be finite and non-negative")
  }
  // CSS border-radius spreading: 1 → all, 2 → [a, b, a, b], 3 → [a, b, c, b].
  if (corners.length === 1) {
    corners.push(corners[0]!, corners[0]!, corners[0]!)
  } else if (corners.length === 2) {
    corners.push(corners[0]!, corners[1]!)
  } else if (corners.length === 3) {
    corners.push(corners[1]!)
  }
  const [tl, tr, br, bl] = corners as [CornerRadii, CornerRadii, CornerRadii, CornerRadii]
  // Scale oversized corners down uniformly, like the spec's border-radius.
  const k = Math.min(
    1,
    w / (tl.rx + tr.rx || 1),
    w / (bl.rx + br.rx || 1),
    h / (tl.ry + bl.ry || 1),
    h / (tr.ry + br.ry || 1),
  )
  if (k < 1) {
    for (const corner of corners) {
      corner.rx *= k
      corner.ry *= k
    }
  }
  return [tl, tr, br, bl]
}

export class GpuixCanvasRenderingContext2D {
  readonly canvas: { readonly width: number; readonly height: number }

  /** @internal — the native rasterization core this facade forwards to. */
  readonly native: GpuixCanvas2DCore

  private width: number
  private height: number
  private getUpload: () => GpuixUploadTarget | null
  private state: ShadowState
  private stack: ShadowState[] = []
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

  /** Push the parsed paint to the native core: a solid colour, or the
   *  descriptor form of a gradient object. */
  private static pushFill(
    native: GpuixCanvas2DCore,
    which: "fill" | "stroke",
    parsed: RgbaColor | null,
    style: GpuixFillStyle,
  ): void {
    const gradient = style instanceof GpuixCanvasGradient ? style : null
    if (gradient) {
      if (!gradient.empty) {
        const desc = gradient.toDescriptor()
        if (which === "fill") {
          native.setFillGradient(desc.radial, desc.x0, desc.y0, desc.r0, desc.x1, desc.y1, desc.r1, desc.stops)
        } else {
          native.setStrokeGradient(desc.radial, desc.x0, desc.y0, desc.r0, desc.x1, desc.y1, desc.r1, desc.stops)
        }
      }
      return
    }
    const rgba = parsed ?? { r: 0, g: 0, b: 0, a: 0 }
    if (which === "fill") {
      native.setFillRgba(rgba.r, rgba.g, rgba.b, rgba.a)
    } else {
      native.setStrokeRgba(rgba.r, rgba.g, rgba.b, rgba.a)
    }
  }

  /** Gradients are live objects in the DOM: mutating stops after the style
   *  was assigned still affects later draws. The native paint snapshots the
   *  descriptor, so every gradient draw re-pushes the current stops. Solid
   *  colours are immutable once parsed — no re-push needed. */
  private syncPaint(which: "fill" | "stroke"): void {
    const style = which === "fill" ? this.state.fillStyle : this.state.strokeStyle
    if (style instanceof GpuixCanvasGradient && !style.empty) {
      GpuixCanvasRenderingContext2D.pushFill(this.native, which, null, style)
    }
  }

  /** A degenerate gradient paints nothing at all — and the TS semantics
   *  were an early return *before* scheduling, so no upload, no draw count. */
  private paintIsEmpty(which: "fill" | "stroke"): boolean {
    const style = which === "fill" ? this.state.fillStyle : this.state.strokeStyle
    return style instanceof GpuixCanvasGradient && style.empty
  }

  constructor(width: number, height: number, getUpload: () => GpuixUploadTarget | null) {
    this.width = dimensionOf(width)
    this.height = dimensionOf(height)
    this.getUpload = getUpload
    this.native = new GpuixCanvas2DCore(this.width, this.height)
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
    this.native.resize(this.width, this.height)
    this.state = defaultState()
    this.stack = []
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
      GpuixCanvasRenderingContext2D.pushFill(this.native, "fill", null, value)
      return
    }
    const parsed = GpuixCanvasRenderingContext2D.parseStyleValue(value)
    if (!parsed) return // invalid assignments leave the style untouched
    this.state.fillStyle = value as string | GpuixColorObject
    this.state.fill = parsed
    GpuixCanvasRenderingContext2D.pushFill(this.native, "fill", parsed, value)
  }

  get strokeStyle(): GpuixFillStyle {
    const style = this.state.strokeStyle
    return style instanceof GpuixCanvasGradient ? style : serializeColor(this.state.stroke!)
  }

  set strokeStyle(value: GpuixFillStyle) {
    if (value instanceof GpuixCanvasGradient) {
      this.state.strokeStyle = value
      this.state.stroke = null
      GpuixCanvasRenderingContext2D.pushFill(this.native, "stroke", null, value)
      return
    }
    const parsed = GpuixCanvasRenderingContext2D.parseStyleValue(value)
    if (!parsed) return
    this.state.strokeStyle = value as string | GpuixColorObject
    this.state.stroke = parsed
    GpuixCanvasRenderingContext2D.pushFill(this.native, "stroke", parsed, value)
  }

  get globalAlpha(): number {
    return this.state.globalAlpha
  }

  set globalAlpha(value: number) {
    const n = Number(value)
    if (Number.isFinite(n) && n >= 0 && n <= 1) {
      this.state.globalAlpha = n
      this.native.setGlobalAlpha(n)
    }
  }

  get lineWidth(): number {
    return this.state.lineWidth
  }

  set lineWidth(value: number) {
    // WebIDL `double`: strings and valueOf-objects convert before the check,
    // so `ctx.lineWidth = "1e1"` stores 10 like in the DOM.
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) {
      this.state.lineWidth = n
      this.native.setLineWidth(n)
    }
  }

  get lineCap(): GpuixLineCap {
    return this.state.lineCap
  }

  set lineCap(value: GpuixLineCap) {
    if (value === "butt" || value === "round" || value === "square") {
      this.state.lineCap = value
      this.native.setLineCap(value)
    }
  }

  get lineJoin(): GpuixLineJoin {
    return this.state.lineJoin
  }

  set lineJoin(value: GpuixLineJoin) {
    if (value === "round" || value === "bevel" || value === "miter") {
      this.state.lineJoin = value
      this.native.setLineJoin(value)
    }
  }

  get miterLimit(): number {
    return this.state.miterLimit
  }

  set miterLimit(value: number) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) {
      this.state.miterLimit = n
      this.native.setMiterLimit(n)
    }
  }

  get lineDashOffset(): number {
    return this.state.lineDashOffset
  }

  set lineDashOffset(value: number) {
    const n = Number(value)
    if (Number.isFinite(n)) {
      this.state.lineDashOffset = n
      this.native.setLineDashOffset(n)
    }
  }

  get globalCompositeOperation(): GpuixCompositeOperation {
    return this.state.composite
  }

  set globalCompositeOperation(value: GpuixCompositeOperation) {
    if (typeof value === "string" && COMPOSITE_OPERATIONS.has(value)) {
      this.state.composite = value
      this.native.setComposite(value)
    }
  }

  get imageSmoothingEnabled(): boolean {
    return this.state.imageSmoothingEnabled
  }

  set imageSmoothingEnabled(value: boolean) {
    this.state.imageSmoothingEnabled = !!value
    this.native.setImageSmoothing(!!value)
  }

  setLineDash(segments: number[]): void {
    if (!Array.isArray(segments)) return
    const converted = segments.map((v) => Number(v))
    if (!converted.every((v) => Number.isFinite(v) && v >= 0)) return
    let dash = [...converted]
    if (dash.length % 2 === 1) dash = dash.concat(dash)
    this.state.lineDash = dash
    this.native.setLineDash(converted)
  }

  getLineDash(): number[] {
    return [...this.state.lineDash]
  }

  // ── State stack ──────────────────────────────────────────────────────

  save(): void {
    this.stack.push(copyState(this.state))
    this.native.save()
  }

  restore(): void {
    const restored = this.stack.pop()
    if (restored) {
      this.state = restored
      this.native.restore()
    }
  }

  // ── Transforms ───────────────────────────────────────────────────────

  getTransform(): GpuixMatrix2D {
    const { a, b, c, d, e, f } = this.native.getTransform()
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
      const nb = Number(b)
      const nc = Number(c)
      const nd = Number(d)
      const ne = Number(e)
      const nf = Number(f)
      if (finite(ma, nb, nc, nd, ne, nf)) {
        this.native.setTransform(ma, nb, nc, nd, ne, nf)
      }
      return
    }
    if (transform && typeof transform === "object") {
      const { a: ma, b: mb, c: mc, d: md, e: me, f: mf } = transform
      if (finite(ma, mb, mc, md, me, mf)) {
        this.native.setTransform(ma, mb, mc, md, me, mf)
      }
      return
    }
    // setTransform() with no arguments resets to the identity matrix.
    this.native.resetTransform()
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const na = Number(a)
    const nb = Number(b)
    const nc = Number(c)
    const nd = Number(d)
    const ne = Number(e)
    const nf = Number(f)
    if (!finite(na, nb, nc, nd, ne, nf)) return
    this.native.transform(na, nb, nc, nd, ne, nf)
  }

  translate(tx: number, ty: number): void {
    const ntx = Number(tx)
    const nty = Number(ty)
    if (!finite(ntx, nty)) return
    this.native.translate(ntx, nty)
  }

  rotate(angle: number): void {
    const n = Number(angle)
    if (!finite(n)) return
    this.native.rotate(n)
  }

  scale(sx: number, sy: number): void {
    const nsx = Number(sx)
    const nsy = Number(sy)
    if (!finite(nsx, nsy)) return
    this.native.scale(nsx, nsy)
  }

  resetTransform(): void {
    this.native.resetTransform()
  }

  /** DOM `reset()`: back to a freshly created context — default state, empty
   *  path, cleared bitmap — keeping the current size. */
  reset(): void {
    this.native.reset()
    this.state = defaultState()
    this.stack = []
    this.scheduleUpload()
  }

  // ── Path building (user space; the CTM is baked in per segment) ────────

  beginPath(): void {
    this.native.beginPath()
  }

  moveTo(x: number, y: number): void {
    // Convert first, validate after: the DOM converts every argument
    // (running valueOf) even when a sibling argument is non-finite.
    const nx = Number(x)
    const ny = Number(y)
    if (!finite(nx, ny)) return
    this.native.moveTo(nx, ny)
  }

  lineTo(x: number, y: number): void {
    const nx = Number(x)
    const ny = Number(y)
    if (!finite(nx, ny)) return
    this.native.lineTo(nx, ny)
  }

  closePath(): void {
    this.native.closePath()
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    const ncx = Number(cpx)
    const ncy = Number(cpy)
    const nx = Number(x)
    const ny = Number(y)
    if (!finite(ncx, ncy, nx, ny)) return
    this.native.quadraticCurveTo(ncx, ncy, nx, ny)
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    const n1x = Number(c1x)
    const n1y = Number(c1y)
    const n2x = Number(c2x)
    const n2y = Number(c2y)
    const nx = Number(x)
    const ny = Number(y)
    if (!finite(n1x, n1y, n2x, n2y, nx, ny)) return
    this.native.bezierCurveTo(n1x, n1y, n2x, n2y, nx, ny)
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    const nx1 = Number(x1)
    const ny1 = Number(y1)
    const nx2 = Number(x2)
    const ny2 = Number(y2)
    const nr = Number(radius)
    if (!finite(nx1, ny1, nx2, ny2, nr)) return
    if (nr < 0) {
      throw new DOMException("arcTo: radius must not be negative", "IndexSizeError")
    }
    this.native.arcTo(nx1, ny1, nx2, ny2, nr)
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, anticlockwise?: boolean): void {
    // Non-finite arguments are silently ignored; only a finite negative
    // radius throws (the ±Infinity/NaN forms expand out of @nonfinite tests).
    const nx = Number(x)
    const ny = Number(y)
    const nr = Number(radius)
    const ns = Number(startAngle)
    const ne = Number(endAngle)
    if (!finite(nx, ny, nr, ns, ne)) return
    if (nr < 0) {
      throw new DOMException("arc: radius must not be negative", "IndexSizeError")
    }
    this.native.arc(nx, ny, nr, ns, ne, anticlockwise ?? false)
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
    const nx = Number(x)
    const ny = Number(y)
    const nrx = Number(radiusX)
    const nry = Number(radiusY)
    const nrot = Number(rotation)
    const ns = Number(startAngle)
    const ne = Number(endAngle)
    if (!finite(nx, ny, nrx, nry, nrot, ns, ne)) return
    if (nrx < 0 || nry < 0) {
      throw new DOMException("ellipse: radii must not be negative", "IndexSizeError")
    }
    this.native.ellipse(nx, ny, nrx, nry, nrot, ns, ne, anticlockwise ?? false)
  }

  rect(x: number, y: number, w: number, h: number): void {
    const nx = Number(x)
    const ny = Number(y)
    const nw = Number(w)
    const nh = Number(h)
    if (!finite(nx, ny, nw, nh)) return
    this.native.rect(nx, ny, nw, nh)
  }

  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii?: number | Array<number | { x?: number; y?: number }>,
  ): void {
    // WebIDL converts every argument before validation, so valueOf side
    // effects happen even when a sibling argument is non-finite.
    const nx = Number(x)
    const ny = Number(y)
    const nw = Number(w)
    const nh = Number(h)
    if (!finite(nx, ny, nw, nh)) return
    const corners = normalizeRoundRectRadii(radii ?? 0, Math.abs(nw), Math.abs(nh))
    if (!corners) return // non-finite radii are silently ignored, like other arguments
    // The four corners travel flat; the native builder handles the
    // negative-extent mirroring and the corner arcs.
    const [tl, tr, br, bl] = corners
    this.native.roundRect(nx, ny, nw, nh, [
      tl.rx, tl.ry,
      tr.rx, tr.ry,
      br.rx, br.ry,
      bl.rx, bl.ry,
    ])
  }

  // ── Drawing ──────────────────────────────────────────────────────────

  fill(fillRule: GpuixFillRule = "nonzero"): void {
    // The path already carries its construction-time matrices; drawing does
    // not re-transform it.
    if (this.paintIsEmpty("fill")) return
    this.syncPaint("fill")
    if (this.native.fill(fillRule)) this.scheduleUpload()
  }

  stroke(): void {
    if (this.paintIsEmpty("stroke")) return
    this.syncPaint("stroke")
    if (this.native.stroke()) this.scheduleUpload()
  }

  clip(fillRule: GpuixFillRule = "nonzero"): void {
    this.native.clip(fillRule)
  }

  /** The point is in device space — the DOM hit-tests the bitmap, not the
   *  current user space. */
  isPointInPath(x: number, y: number, fillRule: GpuixFillRule = "nonzero"): boolean {
    if (!finite(x, y)) return false
    return this.native.isPointInPath(x, y, fillRule)
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const nx = Number(x)
    const ny = Number(y)
    const nw = Number(w)
    const nh = Number(h)
    if (!finite(nx, ny, nw, nh)) return
    if (this.paintIsEmpty("fill")) return
    this.syncPaint("fill")
    if (this.native.fillRect(nx, ny, nw, nh)) this.scheduleUpload()
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    // A zero extent strokes the degenerate line — its band is visible, like
    // the DOM. Only non-finite arguments make the call a no-op.
    const nx = Number(x)
    const ny = Number(y)
    const nw = Number(w)
    const nh = Number(h)
    if (!finite(nx, ny, nw, nh)) return
    if (this.paintIsEmpty("stroke")) return
    this.syncPaint("stroke")
    if (this.native.strokeRect(nx, ny, nw, nh)) this.scheduleUpload()
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    const nx = Number(x)
    const ny = Number(y)
    const nw = Number(w)
    const nh = Number(h)
    if (!finite(nx, ny, nw, nh) || nw === 0 || nh === 0) return
    if (this.native.clearRect(nx, ny, nw, nh)) this.scheduleUpload()
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
    // The native side snapshots the source region — required for
    // correctness when drawing a canvas onto itself.
    if (this.native.drawImage(srcCtx.native, srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH)) {
      this.scheduleUpload()
    }
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
    const buffer = this.native.getImageData(left, top, width, height)
    // A clamped view over the native buffer keeps `ImageData.data`
    // semantics (writes clamp) with no copy.
    const view = new Uint8ClampedArray(buffer.buffer, buffer.byteOffset, width * height * 4)
    return new GpuixImageData(view, width, height)
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
    // A Uint8Array view over the clamped buffer: zero copy, right typed-
    // array brand for the bridge.
    const bytes = new Uint8Array(imagedata.data.buffer, imagedata.data.byteOffset, imagedata.data.length)
    this.native.putImageData(bytes, imagedata.width, imagedata.height, destX, destY, x0, y0, x1, y1)
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

  /** @internal — how many mutating draws ran; lets tests tell "drew
   *  nothing" from "drew and matched". */
  get stats(): { drawCount: number } {
    return { drawCount: this.drawCount }
  }

  /** One upload per microtask, however many draws the task made. Pixels
   *  stay native: the renderer pulls them straight from the core. */
  private scheduleUpload(): void {
    this.drawCount++
    if (this.disposed || this.uploadScheduled) return
    this.uploadScheduled = true
    queueMicrotask(() => {
      this.uploadScheduled = false
      if (this.disposed) return
      const target = this.getUpload()
      const upload = target?.renderer.uploadCanvasFromContext
      if (!upload) return
      upload.call(target.renderer, target.id, this.native)
    })
  }
}

function defaultState(): ShadowState {
  return {
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

function copyState(state: ShadowState): ShadowState {
  return { ...state, lineDash: [...state.lineDash] }
}
