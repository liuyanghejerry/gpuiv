/**
 * Path building and flattening for the GPUIV 2D context.
 *
 * A path is a list of subpaths of **user-space** segments (line, quadratic,
 * cubic, ellipse-arc). Flattening subdivides curves adaptively and emits
 * device-space polylines; the tolerance is applied to the transformed
 * control points, so quality tracks the CTM, and callers that need
 * user-space geometry (stroking) pass an identity matrix with a tighter
 * tolerance derived from the transform's max scale.
 */

import type { GpuixMatrix2D } from "./matrix.js"
import { applyMatrix } from "./matrix.js"

export type PathSegment =
  | { k: "L"; x: number; y: number }
  | { k: "Q"; cx: number; cy: number; x: number; y: number }
  | {
      k: "C"
      c1x: number
      c1y: number
      c2x: number
      c2y: number
      x: number
      y: number
    }
  | {
      k: "A"
      cx: number
      cy: number
      rx: number
      ry: number
      rot: number
      start: number
      end: number
      ccw: boolean
    }

export interface PathSubpath {
  sx: number
  sy: number
  segs: PathSegment[]
  closed: boolean
}

/** One flattened polyline in device space, x/y interleaved. */
export interface Poly {
  pts: number[]
  closed: boolean
}

const TAU = Math.PI * 2

function allFinite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v))
}

/** Distance from p to the segment p0–p1 (used for curve flatness). */
function pointLineDist(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x0, py - y0)
  let t = ((px - x0) * dx + (py - y0) * dy) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
}

/** Builder for the context's current default path. */
export class GpuixPathBuilder {
  subpaths: PathSubpath[] = []
  /** The open subpath segments are appended to; null right after closePath. */
  private open: PathSubpath | null = null
  private cx = 0
  private cy = 0
  private hasCurrent = false

  get currentPoint(): { x: number; y: number } | null {
    return this.hasCurrent ? { x: this.cx, y: this.cy } : null
  }

  moveTo(x: number, y: number): void {
    if (!allFinite(x, y)) return
    this.open = { sx: x, sy: y, segs: [], closed: false }
    this.subpaths.push(this.open)
    this.cx = x
    this.cy = y
    this.hasCurrent = true
  }

  lineTo(x: number, y: number): void {
    if (!allFinite(x, y)) return
    if (!this.hasCurrent) {
      this.moveTo(x, y)
      return
    }
    this.ensureOpen()
    this.open!.segs.push({ k: "L", x, y })
    this.cx = x
    this.cy = y
  }

  closePath(): void {
    if (this.open) {
      this.open.closed = true
      this.cx = this.open.sx
      this.cy = this.open.sy
    }
    this.open = null
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    if (!allFinite(cpx, cpy, x, y)) return
    if (!this.hasCurrent) {
      this.moveTo(cpx, cpy)
    }
    this.ensureOpen()
    this.open!.segs.push({ k: "Q", cx: cpx, cy: cpy, x, y })
    this.cx = x
    this.cy = y
  }

  bezierCurveTo(
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number,
  ): void {
    if (!allFinite(c1x, c1y, c2x, c2y, x, y)) return
    if (!this.hasCurrent) {
      this.moveTo(c1x, c1y)
    }
    this.ensureOpen()
    this.open!.segs.push({ k: "C", c1x, c1y, c2x, c2y, x, y })
    this.cx = x
    this.cy = y
  }

  /**
   * DOM `arcTo`: line to the tangent point on the incoming edge, then an arc
   * around the inscribed circle to the tangent point on the outgoing edge.
   */
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    if (!allFinite(x1, y1, x2, y2, radius)) return
    if (radius < 0) {
      throw new Error("arcTo: radius must not be negative")
    }
    if (!this.hasCurrent) {
      // No current point: the arc starts a subpath at its first tangent point.
      // Compute it below by treating the current point as P1 (degenerate).
      this.moveTo(x1, y1)
      return
    }
    const x0 = this.cx
    const y0 = this.cy
    if ((x0 === x1 && y0 === y1) || (x1 === x2 && y1 === y2) || radius === 0) {
      this.lineTo(x1, y1)
      return
    }
    const l0 = Math.hypot(x1 - x0, y1 - y0)
    const l2 = Math.hypot(x2 - x1, y2 - y1)
    const ux = (x1 - x0) / l0
    const uy = (y1 - y0) / l0
    const vx = (x2 - x1) / l2
    const vy = (y2 - y1) / l2
    const dot = ux * vx + uy * vy
    const cross = ux * vy - uy * vx
    if (1 + dot < 1e-12) {
      // 180° reversal: the tangent points run to infinity; keep the corner.
      this.lineTo(x1, y1)
      return
    }
    // Signed tangent length; the circle center sits one radius off both edges.
    const t = (radius * cross) / (1 + dot)
    const t1x = x1 - ux * t
    const t1y = y1 - uy * t
    const t2x = x1 + vx * t
    const t2y = y1 + vy * t
    const side = cross > 0 ? 1 : -1
    const ox = t1x + side * radius * -uy
    const oy = t1y + side * radius * ux
    this.lineTo(t1x, t1y)
    const start = Math.atan2(t1y - oy, t1x - ox)
    const end = Math.atan2(t2y - oy, t2x - ox)
    this.ensureOpen()
    this.open!.segs.push({
      k: "A",
      cx: ox,
      cy: oy,
      rx: radius,
      ry: radius,
      rot: 0,
      start,
      end,
      // cross > 0 turns through increasing canvas angles (y down).
      ccw: cross < 0,
    })
    this.cx = t2x
    this.cy = t2y
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    anticlockwise = false,
  ): void {
    if (!allFinite(x, y, radiusX, radiusY, rotation, startAngle, endAngle)) return
    if (radiusX < 0 || radiusY < 0) {
      throw new Error("ellipse: radii must not be negative")
    }
    const startPoint = this.ellipsePoint(x, y, radiusX, radiusY, rotation, startAngle)
    if (this.hasCurrent) {
      this.lineTo(startPoint[0], startPoint[1])
    } else {
      this.moveTo(startPoint[0], startPoint[1])
    }
    this.ensureOpen()
    this.open!.segs.push({
      k: "A",
      cx: x,
      cy: y,
      rx: radiusX,
      ry: radiusY,
      rot: rotation,
      start: startAngle,
      end: endAngle,
      ccw: anticlockwise,
    })
    const endPoint = this.ellipsePoint(x, y, radiusX, radiusY, rotation, endAngle)
    this.cx = endPoint[0]
    this.cy = endPoint[1]
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    anticlockwise = false,
  ): void {
    if (radius < 0) {
      throw new Error("arc: radius must not be negative")
    }
    this.ellipse(x, y, radius, radius, 0, startAngle, endAngle, anticlockwise)
  }

  rect(x: number, y: number, w: number, h: number): void {
    if (!allFinite(x, y, w, h)) return
    this.moveTo(x, y)
    this.lineTo(x + w, y)
    this.lineTo(x + w, y + h)
    this.lineTo(x, y + h)
    this.closePath()
  }

  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: number | Array<number | { x?: number; y?: number }> = 0,
  ): void {
    if (!allFinite(x, y, w, h)) return
    if (w < 0 || h < 0) {
      throw new Error("roundRect: width and height must not be negative")
    }
    const corners = normalizeRoundRectRadii(radii, w, h)
    const [tl, tr, br, bl] = corners

    this.moveTo(x + tl.rx, y)
    this.lineTo(x + w - tr.rx, y)
    this.cornerArc(x + w - tr.rx, y + tr.ry, tr, -Math.PI / 2, 0)
    this.lineTo(x + w, y + h - br.ry)
    this.cornerArc(x + w - br.rx, y + h - br.ry, br, 0, Math.PI / 2)
    this.lineTo(x + bl.rx, y + h)
    this.cornerArc(x + bl.rx, y + h - bl.ry, bl, Math.PI / 2, Math.PI)
    this.lineTo(x, y + tl.ry)
    this.cornerArc(x + tl.rx, y + tl.ry, tl, Math.PI, Math.PI * 1.5)
    this.closePath()
  }

  private cornerArc(
    cx: number,
    cy: number,
    corner: { rx: number; ry: number },
    start: number,
    end: number,
  ): void {
    if (corner.rx <= 0 || corner.ry <= 0) return
    this.ensureOpen()
    this.open!.segs.push({
      k: "A",
      cx,
      cy,
      rx: corner.rx,
      ry: corner.ry,
      rot: 0,
      start,
      end,
      ccw: false,
    })
    const p = this.ellipsePoint(cx, cy, corner.rx, corner.ry, 0, end)
    this.cx = p[0]
    this.cy = p[1]
  }

  /** Point on an ellipse at angle θ (canvas convention, y down). */
  private ellipsePoint(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rot: number,
    theta: number,
  ): [number, number] {
    const cosRot = Math.cos(rot)
    const sinRot = Math.sin(rot)
    const px = rx * Math.cos(theta)
    const py = ry * Math.sin(theta)
    return [cx + cosRot * px - sinRot * py, cy + sinRot * px + cosRot * py]
  }

  /** After closePath the next segment opens a fresh subpath from the close point. */
  private ensureOpen(): void {
    if (!this.open) {
      this.open = { sx: this.cx, sy: this.cy, segs: [], closed: false }
      this.subpaths.push(this.open)
    }
  }
}

interface CornerRadii {
  rx: number
  ry: number
}

function normalizeRoundRectRadii(
  radii: number | Array<number | { x?: number; y?: number }>,
  w: number,
  h: number,
): [CornerRadii, CornerRadii, CornerRadii, CornerRadii] {
  const seq: Array<number | { x?: number; y?: number }> = Array.isArray(radii) ? radii : [radii]
  if (seq.length > 4) {
    throw new Error("roundRect: at most four radii")
  }
  const corners: CornerRadii[] = seq.map((entry) => {
    if (typeof entry === "number") {
      if (!Number.isFinite(entry) || entry < 0) {
        throw new Error("roundRect: radii must be finite and non-negative")
      }
      return { rx: entry, ry: entry }
    }
    const rx = entry.x ?? entry.y ?? 0
    const ry = entry.y ?? entry.x ?? 0
    if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx < 0 || ry < 0) {
      throw new Error("roundRect: radii must be finite and non-negative")
    }
    return { rx, ry }
  })
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

/** Normalize an arc sweep to the signed interval [-2π, 2π] the sampler wants. */
function normalizedSweep(start: number, end: number, ccw: boolean): number {
  let sweep = end - start
  if (!ccw) {
    if (sweep >= TAU) sweep = TAU
    else if (sweep < 0) sweep = (sweep % TAU) + TAU
  } else {
    if (sweep <= -TAU) sweep = -TAU
    else if (sweep > 0) sweep = (sweep % TAU) - TAU
  }
  return sweep
}

/**
 * Flatten every subpath into device-space polylines with a chord tolerance
 * of `tol` pixels. Curves are transformed first and subdivided against the
 * transformed control polygon; arcs pick their sample count from the
 * device-space radius.
 */
export function flattenPath(subpaths: PathSubpath[], m: GpuixMatrix2D, tol: number): Poly[] {
  const polys: Poly[] = []
  for (const sub of subpaths) {
    const pts: number[] = []
    const [sx, sy] = applyMatrix(m, sub.sx, sub.sy)
    pts.push(sx, sy)
    for (const seg of sub.segs) {
      switch (seg.k) {
        case "L": {
          const [x, y] = applyMatrix(m, seg.x, seg.y)
          pts.push(x, y)
          break
        }
        case "Q": {
          const [cx, cy] = applyMatrix(m, seg.cx, seg.cy)
          const [x, y] = applyMatrix(m, seg.x, seg.y)
          flattenQuad(
            pts[pts.length - 2]!,
            pts[pts.length - 1]!,
            cx,
            cy,
            x,
            y,
            pts,
            tol,
            0,
          )
          break
        }
        case "C": {
          const [c1x, c1y] = applyMatrix(m, seg.c1x, seg.c1y)
          const [c2x, c2y] = applyMatrix(m, seg.c2x, seg.c2y)
          const [x, y] = applyMatrix(m, seg.x, seg.y)
          flattenCubic(
            pts[pts.length - 2]!,
            pts[pts.length - 1]!,
            c1x,
            c1y,
            c2x,
            c2y,
            x,
            y,
            pts,
            tol,
            0,
          )
          break
        }
        case "A": {
          flattenArc(seg, m, tol, pts)
          break
        }
      }
    }
    polys.push({ pts, closed: sub.closed })
  }
  return polys
}

function flattenQuad(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  out: number[],
  tol: number,
  depth: number,
): void {
  if (depth > 18 || pointLineDist(x1, y1, x0, y0, x2, y2) <= tol) {
    out.push(x2, y2)
    return
  }
  const ax = (x0 + x1) / 2
  const ay = (y0 + y1) / 2
  const bx = (x1 + x2) / 2
  const by = (y1 + y2) / 2
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  flattenQuad(x0, y0, ax, ay, mx, my, out, tol, depth + 1)
  flattenQuad(mx, my, bx, by, x2, y2, out, tol, depth + 1)
}

function flattenCubic(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  out: number[],
  tol: number,
  depth: number,
): void {
  const flat =
    depth > 18 ||
    Math.max(
      pointLineDist(x1, y1, x0, y0, x3, y3),
      pointLineDist(x2, y2, x0, y0, x3, y3),
    ) <= tol
  if (flat) {
    out.push(x3, y3)
    return
  }
  const ax = (x0 + x1) / 2
  const ay = (y0 + y1) / 2
  const bx = (x1 + x2) / 2
  const by = (y1 + y2) / 2
  const cx = (x2 + x3) / 2
  const cy = (y2 + y3) / 2
  const dx = (ax + bx) / 2
  const dy = (ay + by) / 2
  const ex = (bx + cx) / 2
  const ey = (by + cy) / 2
  const mx = (dx + ex) / 2
  const my = (dy + ey) / 2
  flattenCubic(x0, y0, ax, ay, dx, dy, mx, my, out, tol, depth + 1)
  flattenCubic(mx, my, ex, ey, cx, cy, x3, y3, out, tol, depth + 1)
}

function flattenArc(
  seg: Extract<PathSegment, { k: "A" }>,
  m: GpuixMatrix2D,
  tol: number,
  out: number[],
): void {
  const sweep = normalizedSweep(seg.start, seg.end, seg.ccw)
  const cosRot = Math.cos(seg.rot)
  const sinRot = Math.sin(seg.rot)
  // Device-space half-axes: the linear part of the matrix applied to the
  // user-space axis vectors.
  const uxv = [cosRot * seg.rx, sinRot * seg.rx]
  const vyv = [-sinRot * seg.ry, cosRot * seg.ry]
  const axisLen = (v: number[]): number =>
    Math.hypot(m.a * v[0]! + m.c * v[1]!, m.b * v[0]! + m.d * v[1]!)
  const rdev = Math.max(axisLen(uxv), axisLen(vyv))
  if (rdev === 0) {
    const [x, y] = applyMatrix(m, seg.cx, seg.cy)
    out.push(x, y)
    return
  }
  const ratio = Math.min(1, Math.max(-1, 1 - tol / rdev))
  const maxStep = 2 * Math.acos(ratio)
  const count = Math.min(
    2048,
    Math.max(4, Math.ceil(Math.abs(sweep) / (maxStep > 1e-6 ? maxStep : Math.PI / 2))),
  )
  for (let i = 1; i <= count; i++) {
    const theta = seg.start + (sweep * i) / count
    const px = seg.rx * Math.cos(theta)
    const py = seg.ry * Math.sin(theta)
    const [x, y] = applyMatrix(
      m,
      seg.cx + cosRot * px - sinRot * py,
      seg.cy + sinRot * px + cosRot * py,
    )
    out.push(x, y)
  }
}
