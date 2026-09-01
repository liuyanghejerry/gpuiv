/**
 * Scanline rasterization with anti-aliasing for the GPUIV 2D context.
 *
 * Coverage is accumulated per pixel over `SUBSCANLINES` evenly spaced
 * sub-scanlines per row; each sub-scanline computes exact horizontal spans
 * from the polygon edges, so horizontal coverage is exact and vertical
 * coverage converges like a browser's rasterizer. Winding is taken from
 * edge direction, which supports both the nonzero and even-odd fill rules
 * from one pass.
 */

import type { Poly } from "./path.js"

export type FillRule = "nonzero" | "evenodd"

/** Sub-scanlines per pixel row. 5 gives ~5% worst-case edge error, visually
 *  smooth at UI sizes, at 1/5 the row cost of a real 5x supersample. */
export const SUBSCANLINES = 5

export interface CoverageBuffer {
  width: number
  height: number
  /** Per-pixel coverage in [0, 1], row-major. */
  data: Float32Array
}

/** Bounding box (inclusive pixel bounds) of the covered region. */
export interface CoveredBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface Edge {
  x1: number
  y1: number
  x2: number
  y2: number
  /** +1 when the edge points down the canvas (y increasing), else −1. */
  dir: number
}

/** Collect the edges of closed polygons (fill semantics: every subpath is
 *  implicitly closed). Horizontal and zero-length edges carry no winding. */
function collectEdges(polys: Poly[], closeAll: boolean): Edge[] {
  const edges: Edge[] = []
  for (const poly of polys) {
    const pts = poly.pts
    const n = pts.length / 2
    if (n < 2) continue
    const limit = closeAll || poly.closed ? n : n - 1
    for (let i = 0; i < limit; i++) {
      const j = closeAll || poly.closed ? (i + 1) % n : i + 1
      const x1 = pts[i * 2]!
      const y1 = pts[i * 2 + 1]!
      const x2 = pts[j * 2]!
      const y2 = pts[j * 2 + 1]!
      if (y1 === y2) continue
      edges.push({ x1, y1, x2, y2, dir: y2 > y1 ? 1 : -1 })
    }
  }
  return edges
}

/**
 * Rasterize polygons into `out.data`, adding to whatever is already there
 * (the caller clears the dirty region first). Returns the covered bounding
 * box, or null when nothing landed inside the buffer.
 */
export function rasterizeCoverage(
  polys: Poly[],
  rule: FillRule,
  out: CoverageBuffer,
): CoveredBBox | null {
  const edges = collectEdges(polys, true)
  if (edges.length === 0) return null

  let minY = Infinity
  let maxY = -Infinity
  for (const edge of edges) {
    minY = Math.min(minY, edge.y1, edge.y2)
    maxY = Math.max(maxY, edge.y1, edge.y2)
  }
  const rowLo = Math.max(0, Math.floor(minY))
  const rowHi = Math.min(out.height - 1, Math.ceil(maxY))
  if (rowLo > rowHi) return null

  const crossings: Array<{ x: number; dir: number }> = []
  let minX = Infinity
  let maxX = -Infinity
  let covered = false

  for (let row = rowLo; row <= rowHi; row++) {
    for (let sub = 0; sub < SUBSCANLINES; sub++) {
      const ys = row + (sub + 0.5) / SUBSCANLINES
      crossings.length = 0
      for (const edge of edges) {
        // Half-open span [min(y1,y2), max(y1,y2)) so shared vertices count once.
        const top = edge.y1 < edge.y2 ? edge.y1 : edge.y2
        const bottom = edge.y1 < edge.y2 ? edge.y2 : edge.y1
        if (ys < top || ys >= bottom) continue
        const t = (ys - edge.y1) / (edge.y2 - edge.y1)
        crossings.push({ x: edge.x1 + t * (edge.x2 - edge.x1), dir: edge.dir })
      }
      if (crossings.length === 0) continue
      crossings.sort((a, b) => a.x - b.x)

      let winding = 0
      let parity = 0
      let spanStart = 0
      for (let i = 0; i < crossings.length; i++) {
        const insideBefore = rule === "nonzero" ? winding !== 0 : parity === 1
        winding += crossings[i]!.dir
        parity ^= 1
        const insideAfter = rule === "nonzero" ? winding !== 0 : parity === 1
        if (!insideBefore && insideAfter) {
          spanStart = crossings[i]!.x
        } else if (insideBefore && !insideAfter) {
          const spanEnd = crossings[i]!.x
          covered = true
          minX = Math.min(minX, spanStart)
          maxX = Math.max(maxX, spanEnd)
          accumulateSpan(out, row, spanStart, spanEnd)
        }
      }
    }
  }

  if (!covered) return null
  return {
    minX: Math.max(0, Math.floor(minX)),
    minY: rowLo,
    maxX: Math.min(out.width - 1, Math.ceil(maxX) - 1),
    maxY: rowHi,
  }
}

/** Add 1/SUBSCANLINES coverage for the pixels a sub-scanline span touches. */
function accumulateSpan(
  out: CoverageBuffer,
  row: number,
  x0: number,
  x1: number,
): void {
  if (x1 <= 0 || x0 >= out.width) return
  const clampedX0 = Math.max(x0, 0)
  const p0 = Math.floor(clampedX0)
  const p1 = Math.min(out.width - 1, Math.ceil(x1) - 1)
  const base = row * out.width
  for (let p = p0; p <= p1; p++) {
    const left = Math.max(clampedX0, p)
    const right = Math.min(x1, p + 1)
    const overlap = right - left
    if (overlap > 0) {
      const idx = base + p
      out.data[idx] = Math.min(1, out.data[idx]! + overlap / SUBSCANLINES)
    }
  }
}

/** Winding test for isPointInPath / isPointInStroke-style hit tests.
 *  The point is in device space; the ray cast runs toward +x. Points exactly
 *  on the boundary count as inside, matching the DOM. */
export function pointInPolys(polys: Poly[], x: number, y: number, rule: FillRule): boolean {
  const EPS = 1e-7
  // Boundary first: distance to every segment, including horizontal ones
  // the winding cast below skips. Overflowed coordinates (a path scaled by
  // Number.MAX_VALUE) clamp to a huge-but-finite bound so the containment
  // math still works; NaN segments and collapsed points have no extent.
  const clean = (v: number): number => {
    if (Number.isNaN(v)) return NaN
    if (v === Infinity) return 1e60
    if (v === -Infinity) return -1e60
    return v
  }
  for (const poly of polys) {
    const pts = poly.pts
    const n = pts.length / 2
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const x1 = clean(pts[i * 2]!)
      const y1 = clean(pts[i * 2 + 1]!)
      const x2 = clean(pts[j * 2]!)
      const y2 = clean(pts[j * 2 + 1]!)
      if (Number.isNaN(x1) || Number.isNaN(y1) || Number.isNaN(x2) || Number.isNaN(y2)) continue
      const dx = x2 - x1
      const dy = y2 - y1
      const len2 = dx * dx + dy * dy
      if (len2 === 0) continue
      let t = ((x - x1) * dx + (y - y1) * dy) / len2
      t = t < 0 ? 0 : t > 1 ? 1 : t
      if (Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= EPS) return true
    }
  }
  const edges = collectEdges(polys, true)
  let winding = 0
  let parity = 0
  for (const edge of edges) {
    const x1 = clean(edge.x1)
    const y1 = clean(edge.y1)
    const x2 = clean(edge.x2)
    const y2 = clean(edge.y2)
    if (Number.isNaN(x1) || Number.isNaN(y1) || Number.isNaN(x2) || Number.isNaN(y2)) continue
    const top = y1 < y2 ? y1 : y2
    const bottom = y1 < y2 ? y2 : y1
    if (y < top || y >= bottom) continue
    if (y2 === y1) continue
    const t = (y - y1) / (y2 - y1)
    const cx = x1 + t * (x2 - x1)
    if (cx > x) {
      winding += edge.dir
      parity ^= 1
    }
  }
  return rule === "nonzero" ? winding !== 0 : parity === 1
}
