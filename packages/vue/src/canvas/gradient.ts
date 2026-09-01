/**
 * `CanvasGradient` for the GPUIV 2D context: linear and radial gradients
 * with DOM-shaped `addColorStop` semantics (out-of-range or unparseable
 * stops throw; evaluation clamps outside 0–1 to the end colours).
 *
 * Gradient coordinates are in **user space** — the matrix that matters is
 * the one current at draw time, exactly like the DOM; the native core maps
 * device pixels back through the draw-time CTM while evaluating. This class
 * is the script-visible object only; `toDescriptor()` hands the parsed,
 * sorted stops to the rasterizer when a paint is recorded.
 */

import { parseColor, type RgbaColor } from "./color.js"

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
   * axis, or a radial gradient whose two circles are identical. */
  get empty(): boolean {
    if (this.kind === "linear") return this.x0 === this.x1 && this.y0 === this.y1
    return this.x0 === this.x1 && this.y0 === this.y1 && this.r0 === this.r1
  }

  /** @internal — the wire form for the native paint recorder: parsed stops
   *  (channels 0–255, alpha 0–1) in sorted offset order. Evaluation lives in
   *  the Rust core (`GradientDesc`), which ported the piecewise ramp and the
   *  radial circle-family roots verbatim. */
  toDescriptor(): {
    radial: boolean
    x0: number
    y0: number
    r0: number
    x1: number
    y1: number
    r1: number
    stops: Array<{ offset: number; r: number; g: number; b: number; a: number }>
  } {
    return {
      radial: this.kind === "radial",
      x0: this.x0,
      y0: this.y0,
      r0: this.r0,
      x1: this.x1,
      y1: this.y1,
      r1: this.r1,
      stops: this.stops.map((stop) => ({
        offset: stop.offset,
        r: stop.color.r,
        g: stop.color.g,
        b: stop.color.b,
        a: stop.color.a,
      })),
    }
  }
}
