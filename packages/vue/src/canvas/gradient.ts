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
      throw new TypeError("GpuixCanvasGradient.addColorStop: offset must be finite")
    }
    if (offset < 0 || offset > 1) {
      throw new DOMException(
        "GpuixCanvasGradient.addColorStop: offset must be between 0 and 1",
        "IndexSizeError",
      )
    }
    const parsed = parseColor(color)
    if (!parsed) {
      throw new DOMException(
        `GpuixCanvasGradient.addColorStop: cannot parse color "${color}"`,
        "SyntaxError",
      )
    }
    this.stops.push({ offset, color: parsed })
    this.stops.sort((a, b) => a.offset - b.offset)
  }

  /** Degenerate gradients paint nothing at all (spec): a zero-length linear
   *  axis, or a radial gradient whose two circles are identical. */
  get empty(): boolean {
    if (this.kind === "linear") return this.x0 === this.x1 && this.y0 === this.y1
    return this.x0 === this.x1 && this.y0 === this.y1 && this.r0 === this.r1
  }

  /** Evaluate at a **device space** pixel centre, mapping back through the
   *  draw-time matrix first. Null means "outside the gradient's reach" — the
   *  radial family never paints this point, so the destination is left alone. */
  evaluateDevice(x: number, y: number, m: GpuixMatrix2D): RgbaColor | null {
    const inv = invertMatrix(m)
    if (!inv) {
      // Degenerate transform: nothing user-space survives; the first stop
      // colour is as good a fallback as any.
      return this.colorAt(0)
    }
    const [ux, uy] = applyMatrix(inv, x, y)
    const t = this.parameterAt(ux, uy)
    return t === null ? null : this.colorAt(t)
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
   * The gradient parameter at a user-space point: projection on the axis for
   * linear, the circle-family root for radial. Null means the point is never
   * painted by this gradient.
   */
  private parameterAt(x: number, y: number): number | null {
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
   * Radial: the spec's circle family c(ω) = (c0 + ω·d, r0 + ω·dr) is painted
   * from ω nearest +∞ downward and earlier circles win, so a point takes the
   * colour at the LARGEST root of |p − c(ω)| = r(ω) — provided that circle
   * has a positive radius; circles with r(ω) ≤ 0 are never painted, and a
   * point with no valid root is left untouched.
   */
  private radialParameter(x: number, y: number): number | null {
    const dx = this.x1 - this.x0
    const dy = this.y1 - this.y0
    const dr = this.r1 - this.r0
    const fx = x - this.x0
    const fy = y - this.y0

    const radiusAt = (t: number) => this.r0 + t * dr
    const valid = (t: number) => radiusAt(t) > 1e-9

    const a = dx * dx + dy * dy - dr * dr
    const b = -(dx * fx + dy * fy + this.r0 * dr)
    const c = fx * fx + fy * fy - this.r0 * this.r0

    if (Math.abs(a) < 1e-12) {
      // Linear boundary: the family is a set of concentric circles (|d| = |dr|).
      if (Math.abs(b) < 1e-12) return c < 0 ? 0 : null
      const t = -c / (2 * b)
      return valid(t) ? t : null
    }

    const disc = b * b - a * c
    if (disc < 0) return null
    const root = Math.sqrt(disc)
    const t0 = (-b - root) / a
    const t1 = (-b + root) / a
    const hi = Math.max(t0, t1)
    if (valid(hi)) return hi
    const lo = Math.min(t0, t1)
    if (valid(lo)) return lo
    return null
  }
}
