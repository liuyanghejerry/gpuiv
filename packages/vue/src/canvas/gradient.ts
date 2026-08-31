/**
 * `CanvasGradient` for the GPUIV 2D context: linear and radial gradients
 * with DOM-shaped `addColorStop` semantics (out-of-range or unparseable
 * stops throw; evaluation clamps outside 0–1 to the end colours).
 *
 * Gradient coordinates are in **user space** — the matrix that matters is
 * the one current at draw time, exactly like the DOM. The rasterizer maps
 * every device pixel back through the inverse CTM before evaluating.
 */

import { lerpColor, parseColor, type RgbaColor } from "./color.js"
import type { GpuixMatrix2D } from "./matrix.js"
import { applyMatrix, invertMatrix } from "./matrix.js"

export type GradientKind = "linear" | "radial"

interface GradientStop {
  offset: number
  color: RgbaColor
}

export class GpuixCanvasGradient {
  readonly kind: GradientKind
  // Linear axis; radial uses (x0, y0, r0) and (x1, y1, r1) as two circles.
  private readonly x0: number
  private readonly y0: number
  private readonly x1: number
  private readonly y1: number
  private readonly r0: number
  private readonly r1: number
  private stops: GradientStop[] = []

  constructor(
    kind: GradientKind,
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ) {
    this.kind = kind
    this.x0 = x0
    this.y0 = y0
    this.r0 = r0
    this.x1 = x1
    this.y1 = y1
    this.r1 = r1
  }

  addColorStop(offset: number, color: string): void {
    if (!Number.isFinite(offset)) {
      throw new Error("GpuixCanvasGradient.addColorStop: offset must be finite")
    }
    if (offset < 0 || offset > 1) {
      throw new Error("GpuixCanvasGradient.addColorStop: offset must be between 0 and 1")
    }
    const parsed = parseColor(color)
    if (!parsed) {
      throw new Error(`GpuixCanvasGradient.addColorStop: cannot parse color "${color}"`)
    }
    this.stops.push({ offset, color: parsed })
    this.stops.sort((a, b) => a.offset - b.offset)
  }

  /** Evaluate at a **device space** pixel centre, mapping back through the
   *  draw-time matrix first. */
  evaluateDevice(x: number, y: number, m: GpuixMatrix2D): RgbaColor {
    const inv = invertMatrix(m)
    if (!inv) {
      // Degenerate transform: nothing user-space survives; the first stop
      // colour is as good a fallback as any.
      return this.colorAt(0)
    }
    const [ux, uy] = applyMatrix(inv, x, y)
    return this.colorAt(this.parameterAt(ux, uy))
  }

  /** Piecewise colour lookup; before the first stop and after the last the
   *  end colours hold, which is how the DOM ramps a gradient. */
  private colorAt(t: number): RgbaColor {
    const stops = this.stops
    if (stops.length === 0) return { r: 0, g: 0, b: 0, a: 0 }
    if (t <= stops[0]!.offset) return stops[0]!.color
    const last = stops[stops.length - 1]!
    if (t >= last.offset) return last.color
    for (let i = 0; i < stops.length - 1; i++) {
      const from = stops[i]!
      const to = stops[i + 1]!
      if (t >= from.offset && t <= to.offset) {
        const span = to.offset - from.offset
        const local = span === 0 ? 0 : (t - from.offset) / span
        return lerpColor(from.color, to.color, local)
      }
    }
    return last.color
  }

  /**
   * The gradient parameter at a user-space point:
   * projection on the axis for linear, the circle interpolation for radial.
   */
  private parameterAt(x: number, y: number): number {
    if (this.kind === "linear") {
      const dx = this.x1 - this.x0
      const dy = this.y1 - this.y0
      const denom = dx * dx + dy * dy
      if (denom === 0) return 0
      return ((x - this.x0) * dx + (y - this.y0) * dy) / denom
    }
    return this.radialParameter(x, y)
  }

  /**
   * Radial: solve |p − (c0 + t·d)| = r0 + t·dr for t.
   *
   * For the common concentric case (c0 == c1, r0 < r1) the positive root is
   * exactly (|p − c0| − r0) / (r1 − r0). In general we take the real root
   * inside [0, 1] (preferring the smaller), and clamp when both roots fall
   * outside — matching what renderers do for points no circle reaches.
   */
  private radialParameter(x: number, y: number): number {
    const dx = this.x1 - this.x0
    const dy = this.y1 - this.y0
    const dr = this.r1 - this.r0
    const fx = x - this.x0
    const fy = y - this.y0

    const a = dx * dx + dy * dy - dr * dr
    const b = -(dx * fx + dy * fy + this.r0 * dr)
    const c = fx * fx + fy * fy - this.r0 * this.r0

    if (Math.abs(a) < 1e-12) {
      // Linear boundary case (cone apex at infinity, or equal circles).
      if (Math.abs(b) < 1e-12) return 0
      return -c / (2 * b)
    }

    const disc = b * b - a * c
    if (disc < 0) {
      // Outside every circle: report which side of the ramp we are on.
      return b > 0 ? 0 : 1
    }
    const root = Math.sqrt(disc)
    const t0 = (-b - root) / a
    const t1 = (-b + root) / a
    for (const t of t0 <= t1 ? [t0, t1] : [t1, t0]) {
      if (t >= 0 && t <= 1) return t
    }
    // Neither root is in range: clamp the one NEAREST the interval — for the
    // concentric case that is the outer circle boundary (black past r1),
    // not the mirrored negative root.
    const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
    const d0 = Math.abs(t0 - clamp01(t0))
    const d1 = Math.abs(t1 - clamp01(t1))
    return clamp01(d0 <= d1 ? t0 : t1)
  }
}
