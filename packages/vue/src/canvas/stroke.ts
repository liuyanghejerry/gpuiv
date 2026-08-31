/**
 * Stroke geometry for the GPUIV 2D context.
 *
 * A stroke is converted to fill polygons in **user space** (so the CTM —
 * including non-uniform scale — shapes it exactly like the DOM), then
 * rasterized with the nonzero rule. Every outline is orientation-normalized
 * so overlapping pieces union instead of cancelling: segment quads, round
 * join discs, bevel/miter wedges, and caps all add winding of one sign.
 */

import type { Poly } from "./path.js"

export type StrokeCap = "butt" | "round" | "square"
export type StrokeJoin = "round" | "bevel" | "miter"

export interface StrokeParams {
  lineWidth: number
  lineCap: StrokeCap
  lineJoin: StrokeJoin
  miterLimit: number
  /** Normalized dash pattern (even length, non-negative, total > 0) or []. */
  lineDash: number[]
  lineDashOffset: number
}

/** Signed area; > 0 is counter-clockwise in math convention. */
function signedArea(pts: number[]): number {
  const n = pts.length / 2
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += pts[i * 2]! * pts[j * 2 + 1]! - pts[j * 2]! * pts[i * 2 + 1]!
  }
  return area / 2
}

/** Push a polygon normalized to negative orientation (clockwise in math
 *  convention), the one sign every stroke outline shares. */
function pushOriented(out: Poly[], pts: number[], closed: boolean): void {
  if (pts.length < 6) return
  if (signedArea(pts) > 0) {
    const reversed: number[] = []
    for (let i = pts.length / 2 - 1; i >= 0; i--) {
      reversed.push(pts[i * 2]!, pts[i * 2 + 1]!)
    }
    out.push({ pts: reversed, closed })
  } else {
    out.push({ pts, closed })
  }
}

function pushCircle(out: Poly[], cx: number, cy: number, r: number): void {
  if (r <= 0) return
  // Segment count from a 0.1px chord tolerance, clamped to sane bounds.
  const ratio = Math.min(1, Math.max(-1, 1 - 0.1 / r))
  const step = 2 * Math.acos(ratio)
  const n = Math.min(128, Math.max(8, Math.ceil((Math.PI * 2) / (step > 1e-6 ? step : Math.PI / 2))))
  const pts: number[] = []
  for (let i = 0; i < n; i++) {
    const theta = (i / n) * Math.PI * 2
    pts.push(cx + r * Math.cos(theta), cy + r * Math.sin(theta))
  }
  pushOriented(out, pts, true)
}

/** Unit direction of the i→j vertex pair, or null when the points coincide. */
function unitBetween(pts: number[], i: number, j: number): [number, number] | null {
  const dx = pts[j * 2]! - pts[i * 2]!
  const dy = pts[j * 2 + 1]! - pts[i * 2 + 1]!
  const len = Math.hypot(dx, dy)
  if (len < 1e-12) return null
  return [dx / len, dy / len]
}

/** Build the stroke outline polygons for a flattened user-space path. */
export function buildStrokeGeometry(polys: Poly[], params: StrokeParams): Poly[] {
  const out: Poly[] = []
  const h = params.lineWidth / 2
  if (!(h > 0)) return out

  const dashed = params.lineDash.length > 0
  for (const poly of polys) {
    const pieces = dashed
      ? dashPolyline(poly, params.lineDash, params.lineDashOffset)
      : [poly]
    for (const piece of pieces) {
      strokePiece(piece.pts, piece.closed, params, h, out)
    }
  }
  return out
}

/** Stroke one polyline (open or cyclic) into orientation-normalized fills. */
function strokePiece(
  pts: number[],
  closed: boolean,
  params: StrokeParams,
  h: number,
  out: Poly[],
): void {
  const n = pts.length / 2
  if (n === 0) return
  if (n === 1 || allCoincident(pts)) {
    // A zero-length subpath draws a dot under round caps, nothing otherwise.
    if (params.lineCap === "round") {
      pushCircle(out, pts[0]!, pts[1]!, h)
    }
    return
  }

  const segCount = closed ? n : n - 1
  const at = (i: number): number => ((i % n) + n) % n

  for (let i = 0; i < segCount; i++) {
    const a = at(i)
    const b = at(i + 1)
    const u = unitBetween(pts, a, b)
    if (!u) continue
    const [ux, uy] = u
    const nx = -uy
    const ny = ux
    const ax = pts[a * 2]!
    const ay = pts[a * 2 + 1]!
    const bx = pts[b * 2]!
    const by = pts[b * 2 + 1]!
    pushOriented(
      out,
      [ax + nx * h, ay + ny * h, bx + nx * h, by + ny * h, bx - nx * h, by - ny * h, ax - nx * h, ay - ny * h],
      true,
    )
  }

  // Joints: every vertex of a closed loop, interior vertices of an open one.
  const jointFrom = closed ? 0 : 1
  const jointTo = closed ? n - 1 : n - 2
  for (let i = jointFrom; i <= jointTo; i++) {
    const prev = at(i - 1)
    const here = at(i)
    const next = at(i + 1)
    const u1 = unitBetween(pts, prev, here) ?? unitBetween(pts, here, next)
    const u2 = unitBetween(pts, here, next) ?? unitBetween(pts, prev, here)
    if (!u1 || !u2) continue
    strokeJoint(pts[here * 2]!, pts[here * 2 + 1]!, u1, u2, params, h, out)
  }

  if (!closed) {
    const first = unitBetween(pts, 0, 1)
    const last = unitBetween(pts, n - 2, n - 1)
    if (first) {
      strokeCap(pts[0]!, pts[1]!, first, params.lineCap, h, out, true)
    }
    if (last) {
      strokeCap(pts[(n - 1) * 2]!, pts[(n - 1) * 2 + 1]!, last, params.lineCap, h, out, false)
    }
  }
}

function allCoincident(pts: number[]): boolean {
  for (let i = 2; i < pts.length; i += 2) {
    if (Math.hypot(pts[i]! - pts[0]!, pts[i + 1]! - pts[1]!) > 1e-9) return false
  }
  return true
}

/** Outer-side join geometry at vertex v between incoming u1 and outgoing u2. */
function strokeJoint(
  vx: number,
  vy: number,
  u1: [number, number],
  u2: [number, number],
  params: StrokeParams,
  h: number,
  out: Poly[],
): void {
  const cross = u1[0]! * u2[1]! - u1[1]! * u2[0]!
  const dot = u1[0]! * u2[0]! + u1[1]! * u2[1]!
  if (Math.abs(cross) < 1e-9) {
    if (dot < 0) pushCircle(out, vx, vy, h) // exact reversal: any side may be outer
    return
  }
  const side = cross > 0 ? -1 : 1
  const o1x = vx + side * -u1[1]! * h
  const o1y = vy + side * u1[0]! * h
  const o2x = vx + side * -u2[1]! * h
  const o2y = vy + side * u2[0]! * h

  if (params.lineJoin === "round") {
    pushCircle(out, vx, vy, h)
    return
  }
  // The bevel wedge between the two butt ends; the miter tip extends it.
  pushOriented(out, [o1x, o1y, o2x, o2y, vx, vy], true)
  if (params.lineJoin === "miter") {
    const sinHalf = Math.sqrt(Math.max(0, (1 + dot) / 2))
    if (1 / sinHalf <= params.miterLimit && sinHalf > 1e-9) {
      // Intersect the two outer offset lines: o1 + t·u1 = o2 + s·u2.
      const wx = o2x - o1x
      const wy = o2y - o1y
      const denom = u1[0]! * u2[1]! - u1[1]! * u2[0]!
      const t = (wx * u2[1]! - wy * u2[0]!) / denom
      const mx = o1x + t * u1[0]!
      const my = o1y + t * u1[1]!
      pushOriented(out, [o1x, o1y, mx, my, o2x, o2y], true)
    }
  }
}

/** End cap at v; u points away from the polyline's interior. */
function strokeCap(
  vx: number,
  vy: number,
  u: [number, number],
  cap: StrokeCap,
  h: number,
  out: Poly[],
  isStart: boolean,
): void {
  if (cap === "butt") return
  if (cap === "round") {
    pushCircle(out, vx, vy, h)
    return
  }
  // square: extend half a line width beyond the end point.
  const dir = isStart ? [-u[0]!, -u[1]!] : [u[0]!, u[1]!]
  const nx = -u[1]!
  const ny = u[0]!
  pushOriented(
    out,
    [
      vx + nx * h,
      vy + ny * h,
      vx + dir[0]! * h + nx * h,
      vy + dir[1]! * h + ny * h,
      vx + dir[0]! * h - nx * h,
      vy + dir[1]! * h - ny * h,
      vx - nx * h,
      vy - ny * h,
    ],
    true,
  )
}

/** Split a polyline into dash pieces. Closed loops dash the wrap segment too.
 *
 *  State is `{index, pos}` — how far into `pattern[index]` the walk is. A
 *  dash piece starts lazily at the current walk position on its first push,
 *  and closes whenever the pattern switches to a gap. Zero-length entries
 *  advance without stepping, so `[5, 0]` renders solid. */
function dashPolyline(poly: Poly, pattern: number[], offset: number): Poly[] {
  const total = pattern.reduce((sum, v) => sum + v, 0)
  if (!(total > 0)) return [poly]

  let phase = offset % total
  if (phase < 0) phase += total
  let index = 0
  let pos = phase
  while (pos >= pattern[index]! - 1e-9) {
    pos -= pattern[index]!
    index = (index + 1) % pattern.length
  }
  const isOn = () => index % 2 === 0

  const pts = poly.pts
  const n = pts.length / 2
  const pieces: Poly[] = []
  let current: number[] | null = null

  const segCount = poly.closed ? n : n - 1
  for (let i = 0; i < segCount; i++) {
    const j = poly.closed ? (i + 1) % n : i + 1
    const ax = pts[i * 2]!
    const ay = pts[i * 2 + 1]!
    const bx = pts[j * 2]!
    const by = pts[j * 2 + 1]!
    const len = Math.hypot(bx - ax, by - ay)
    if (len < 1e-12) continue
    const dx = (bx - ax) / len
    const dy = (by - ay) / len

    let walked = 0
    while (walked < len - 1e-9) {
      if (pattern[index]! - pos <= 1e-9) {
        // Zero-length entry: advance the pattern without moving.
        pos = 0
        index = (index + 1) % pattern.length
        if (!isOn() && current) {
          pieces.push({ pts: current, closed: false })
          current = null
        }
        continue
      }
      const step = Math.min(pattern[index]! - pos, len - walked)
      if (isOn()) {
        if (!current) {
          current = [ax + dx * walked, ay + dy * walked]
        }
        current.push(ax + dx * (walked + step), ay + dy * (walked + step))
      }
      walked += step
      pos += step
      if (pattern[index]! - pos <= 1e-9) {
        pos = 0
        index = (index + 1) % pattern.length
        if (!isOn() && current) {
          pieces.push({ pts: current, closed: false })
          current = null
        }
      }
    }
  }
  if (current && current.length >= 2) {
    pieces.push({ pts: current, closed: false })
  }
  return pieces
}
