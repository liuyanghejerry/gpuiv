/**
 * Path building and flattening for the GPUIV 2D context.
 *
 * A path is a list of subpaths of **user-space** segments (line, quadratic,
 * cubic, ellipse-arc). Each segment carries the CTM that was current when it
 * was appended: the DOM applies transformations while the path is built, not
 * when it is drawn, so a path can mix matrices segment by segment. Flattening
 * subdivides curves adaptively and emits device-space polylines; the
 * tolerance is applied to the transformed control points, so quality tracks
 * each segment's own matrix.
 */

import type { GpuixMatrix2D } from "./matrix.js"
import { applyMatrix } from "./matrix.js"

export type PathSegment =
  | { k: "L"; x: number; y: number; m: GpuixMatrix2D }
  | { k: "Q"; cx: number; cy: number; x: number; y: number; m: GpuixMatrix2D }
  | {
      k: "C"
      c1x: number
      c1y: number
      c2x: number
      c2y: number
      x: number
      y: number
      m: GpuixMatrix2D
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
      m: GpuixMatrix2D
    }

export interface PathSubpath {
  sx: number
  sy: number
  /** The CTM captured when the subpath was started — the DOM transforms path
   *  coordinates while the path is being built, not when it is drawn, so every
   *  segment carries the matrix that was current when it was appended. */
  m: GpuixMatrix2D
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

  moveTo(x: number, y: number, m: GpuixMatrix2D = IDENTITY): void {
    const nx = Number(x)
    const ny = Number(y)
    if (!allFinite(nx, ny)) return
    this.open = { sx: nx, sy: ny, m, segs: [], closed: false }
    this.subpaths.push(this.open)
    this.cx = nx
    this.cy = ny
    this.hasCurrent = true
  }

  lineTo(x: number, y: number, m: GpuixMatrix2D = IDENTITY): void {
    // Convert first, validate after: the DOM converts every argument
    // (running valueOf) even when a sibling argument is non-finite.
    const nx = Number(x)
    const ny = Number(y)
    if (!allFinite(nx, ny)) return
    if (!this.hasCurrent) {
      this.moveTo(nx, ny, m)
      return
    }
    this.ensureOpen(m)
    this.open!.segs.push({ k: "L", x: nx, y: ny, m })
    this.cx = nx
    this.cy = ny
  }

  closePath(): void {
    if (this.open) {
      this.open.closed = true
      this.cx = this.open.sx
      this.cy = this.open.sy
    }
    this.open = null
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number, m: GpuixMatrix2D = IDENTITY): void {
    if (!allFinite(cpx, cpy, x, y)) return
    if (!this.hasCurrent) {
      this.moveTo(cpx, cpy, m)
    }
    this.ensureOpen(m)
    this.open!.segs.push({ k: "Q", cx: cpx, cy: cpy, x, y, m })
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
    m: GpuixMatrix2D = IDENTITY,
  ): void {
    if (!allFinite(c1x, c1y, c2x, c2y, x, y)) return
    if (!this.hasCurrent) {
      this.moveTo(c1x, c1y, m)
    }
    this.ensureOpen(m)
    this.open!.segs.push({ k: "C", c1x, c1y, c2x, c2y, x, y, m })
    this.cx = x
    this.cy = y
  }

  /**
   * DOM `arcTo`: line to the tangent point on the incoming edge, then an arc
   * around the inscribed circle to the tangent point on the outgoing edge.
   */
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number, m: GpuixMatrix2D = IDENTITY): void {
    if (!allFinite(x1, y1, x2, y2, radius)) return
    if (radius < 0) {
      throw new DOMException("arcTo: radius must not be negative", "IndexSizeError")
    }
    if (!this.hasCurrent) {
      // No current point: the arc starts a subpath at its first tangent point.
      // Compute it below by treating the current point as P1 (degenerate).
      this.moveTo(x1, y1, m)
      return
    }
    const x0 = this.cx
    const y0 = this.cy
    if ((x0 === x1 && y0 === y1) || (x1 === x2 && y1 === y2) || radius === 0) {
      this.lineTo(x1, y1, m)
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
      this.lineTo(x1, y1, m)
      return
    }
    // Unsigned tangent length (r·tan(θ/2)); the circle center sits one
    // radius off both edges, on the side the corner turns toward.
    const t = Math.abs((radius * cross) / (1 + dot))
    const t1x = x1 - ux * t
    const t1y = y1 - uy * t
    const t2x = x1 + vx * t
    const t2y = y1 + vy * t
    const side = cross > 0 ? 1 : -1
    const ox = t1x + side * radius * -uy
    const oy = t1y + side * radius * ux
    this.lineTo(t1x, t1y, m)
    const start = Math.atan2(t1y - oy, t1x - ox)
    const end = Math.atan2(t2y - oy, t2x - ox)
    this.ensureOpen(m)
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
      m,
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
    m: GpuixMatrix2D = IDENTITY,
  ): void {
    if (!allFinite(x, y, radiusX, radiusY, rotation, startAngle, endAngle)) return
    if (radiusX < 0 || radiusY < 0) {
      throw new DOMException("ellipse: radii must not be negative", "IndexSizeError")
    }
    const startPoint = this.ellipsePoint(x, y, radiusX, radiusY, rotation, startAngle)
    if (this.hasCurrent) {
      this.lineTo(startPoint[0], startPoint[1], m)
    } else {
      this.moveTo(startPoint[0], startPoint[1], m)
    }
    this.ensureOpen(m)
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
      m,
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
    m: GpuixMatrix2D = IDENTITY,
  ): void {
    // Non-finite arguments are silently ignored; only a finite negative
    // radius throws (the ±Infinity/NaN forms expand out of @nonfinite tests).
    if (!allFinite(x, y, radius, startAngle, endAngle)) return
    if (radius < 0) {
      throw new DOMException("arc: radius must not be negative", "IndexSizeError")
    }
    this.ellipse(x, y, radius, radius, 0, startAngle, endAngle, anticlockwise, m)
  }

  rect(x: number, y: number, w: number, h: number, m: GpuixMatrix2D = IDENTITY): void {
    if (!allFinite(x, y, w, h)) return
    this.moveTo(x, y, m)
    this.lineTo(x + w, y, m)
    this.lineTo(x + w, y + h, m)
    this.lineTo(x, y + h, m)
    this.closePath()
  }

  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: number | Array<number | { x?: number; y?: number }> = 0,
    m: GpuixMatrix2D = IDENTITY,
  ): void {
    // WebIDL converts every argument before validation, so valueOf side
    // effects happen even when a sibling argument is non-finite.
    const nx = Number(x)
    const ny = Number(y)
    const nw = Number(w)
    const nh = Number(h)
    if (!allFinite(nx, ny, nw, nh)) return
    const corners = normalizeRoundRectRadii(radii, Math.abs(nw), Math.abs(nh))
    if (!corners) return // non-finite radii are silently ignored, like other arguments

    // A negative extent mirrors the rectangle: normalize the box and flip
    // the corner list across the same axes ([tl,tr,br,bl] order). An odd
    // number of mirrors also reverses the traversal direction — the traced
    // orientation flips, which nonzero fills observe.
    let [tl, tr, br, bl] = corners
    let bx = nx
    let by = ny
    let bw = nw
    let bh = nh
    if (bw < 0) {
      bx += bw
      bw = -bw
      ;[tl, tr] = [tr, tl]
      ;[bl, br] = [br, bl]
    }
    if (bh < 0) {
      by += bh
      bh = -bh
      ;[tl, bl] = [bl, tl]
      ;[tr, br] = [br, tr]
    }
    const mirrored = (nw < 0) !== (nh < 0)

    if (mirrored) {
      this.moveTo(bx + tl.rx, by, m)
      this.cornerArc(bx + tl.rx, by + tl.ry, tl, Math.PI * 1.5, Math.PI, m, true)
      this.lineTo(bx, by + bh - bl.ry, m)
      this.cornerArc(bx + bl.rx, by + bh - bl.ry, bl, Math.PI, Math.PI / 2, m, true)
      this.lineTo(bx + bw - br.rx, by + bh, m)
      this.cornerArc(bx + bw - br.rx, by + bh - br.ry, br, Math.PI / 2, 0, m, true)
      this.lineTo(bx + bw, by + tr.ry, m)
      this.cornerArc(bx + bw - tr.rx, by + tr.ry, tr, 0, -Math.PI / 2, m, true)
      this.lineTo(bx + tl.rx, by, m)
      this.closePath()
      return
    }

    this.moveTo(bx + tl.rx, by, m)
    this.lineTo(bx + bw - tr.rx, by, m)
    this.cornerArc(bx + bw - tr.rx, by + tr.ry, tr, -Math.PI / 2, 0, m)
    this.lineTo(bx + bw, by + bh - br.ry, m)
    this.cornerArc(bx + bw - br.rx, by + bh - br.ry, br, 0, Math.PI / 2, m)
    this.lineTo(bx + bl.rx, by + bh, m)
    this.cornerArc(bx + bl.rx, by + bh - bl.ry, bl, Math.PI / 2, Math.PI, m)
    this.lineTo(bx, by + tl.ry, m)
    this.cornerArc(bx + tl.rx, by + tl.ry, tl, Math.PI, Math.PI * 1.5, m)
    this.closePath()
  }

  private cornerArc(
    cx: number,
    cy: number,
    corner: { rx: number; ry: number },
    start: number,
    end: number,
    m: GpuixMatrix2D,
    ccw = false,
  ): void {
    if (corner.rx <= 0 || corner.ry <= 0) return
    this.ensureOpen(m)
    this.open!.segs.push({
      k: "A",
      cx,
      cy,
      rx: corner.rx,
      ry: corner.ry,
      rot: 0,
      start,
      end,
      ccw,
      m,
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
  private ensureOpen(m: GpuixMatrix2D = IDENTITY): void {
    if (!this.open) {
      this.open = { sx: this.cx, sy: this.cy, m, segs: [], closed: false }
      this.subpaths.push(this.open)
    }
  }
}

const IDENTITY: GpuixMatrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

interface CornerRadii {
  rx: number
  ry: number
}

/** WebIDL-ish double conversion for a radius member; BigInt is the one
 *  input the DOM rejects with a TypeError instead of coercing. */
function radiusNumber(value: unknown): number {
  if (typeof value === "bigint") {
    throw new TypeError("roundRect: radii cannot be BigInt")
  }
  if (typeof value === "number") return value
  if (value === undefined || value === null) return 0
  return Number(value)
}

function normalizeRoundRectRadii(
  radii: number | Array<number | { x?: number; y?: number }>,
  w: number,
  h: number,
): [CornerRadii, CornerRadii, CornerRadii, CornerRadii] | null {
  const seq: Array<number | { x?: number | unknown; y?: number | unknown }> = Array.isArray(radii)
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
 * of `tol` pixels. Every segment carries the CTM captured when it was
 * appended — the DOM applies transformations while the path is built — so
 * flattening transforms each piece with its own matrix. Curves are
 * transformed first and subdivided against the transformed control polygon;
 * arcs pick their sample count from the device-space radius.
 */
export function flattenPath(subpaths: PathSubpath[], tol: number): Poly[] {
  const polys: Poly[] = []
  for (const sub of subpaths) {
    const pts: number[] = []
    const [sx, sy] = applyMatrix(sub.m, sub.sx, sub.sy)
    pts.push(sx, sy)
    for (const seg of sub.segs) {
      switch (seg.k) {
        case "L": {
          const [x, y] = applyMatrix(seg.m, seg.x, seg.y)
          pts.push(x, y)
          break
        }
        case "Q": {
          const [cx, cy] = applyMatrix(seg.m, seg.cx, seg.cy)
          const [x, y] = applyMatrix(seg.m, seg.x, seg.y)
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
          const [c1x, c1y] = applyMatrix(seg.m, seg.c1x, seg.c1y)
          const [c2x, c2y] = applyMatrix(seg.m, seg.c2x, seg.c2y)
          const [x, y] = applyMatrix(seg.m, seg.x, seg.y)
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
          flattenArc(seg, tol, pts)
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
  tol: number,
  out: number[],
): void {
  const sweep = normalizedSweep(seg.start, seg.end, seg.ccw)
  const cosRot = Math.cos(seg.rot)
  const sinRot = Math.sin(seg.rot)
  const m = seg.m
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
