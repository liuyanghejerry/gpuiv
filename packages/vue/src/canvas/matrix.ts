/**
 * Affine 2D matrices in the DOM canvas convention.
 *
 * A matrix is `{a, b, c, d, e, f}` and maps a point as
 * `x' = a*x + c*y + e`, `y' = b*x + d*y + f` — the same fields
 * `CanvasRenderingContext2D.getTransform()` returns. There is no DOM type
 * here: `@gpuiv/vue` compiles without the DOM lib, so every canvas type is
 * defined locally and named `Gpuix*`.
 */

export interface GpuixMatrix2D {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
  /** Convenience flag `getTransform()` fills in (DOMMatrix-flavoured);
   *  not part of the matrix algebra. */
  isIdentity?: boolean
}

export function identityMatrix(): GpuixMatrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
}

/**
 * Multiply two matrices: the result applies `first`, then `second` — the
 * accumulation `ctx.translate()` etc. needs (the fresh local transform maps
 * the point before the already-built frame does).
 */
export function multiplyMatrix(first: GpuixMatrix2D, second: GpuixMatrix2D): GpuixMatrix2D {
  const { a: a1, b: b1, c: c1, d: d1, e: e1, f: f1 } = first
  const { a: a2, b: b2, c: c2, d: d2, e: e2, f: f2 } = second
  return {
    a: a2 * a1 + c2 * b1,
    b: b2 * a1 + d2 * b1,
    c: a2 * c1 + c2 * d1,
    d: b2 * c1 + d2 * d1,
    e: a2 * e1 + c2 * f1 + e2,
    f: b2 * e1 + d2 * f1 + f2,
  }
}

/** Map a point through a matrix. Exact-zero coefficients drop their term
 *  instead of multiplying: `0 · ±Infinity` is NaN, and a scaled path can
 *  legitimately produce infinite coordinates. */
export function applyMatrix(m: GpuixMatrix2D, x: number, y: number): [number, number] {
  const px = (m.a === 0 ? 0 : m.a * x) + (m.c === 0 ? 0 : m.c * y) + m.e
  const py = (m.b === 0 ? 0 : m.b * x) + (m.d === 0 ? 0 : m.d * y) + m.f
  return [px, py]
}

/**
 * The inverse, or `null` for a singular matrix (degenerate scale). DOM
 * semantics at that point are undefined-ish; callers fall back to skipping
 * the draw, which is what browsers do with a zero-area transform.
 */
export function invertMatrix(m: GpuixMatrix2D): GpuixMatrix2D | null {
  const det = m.a * m.d - m.b * m.c
  if (det === 0 || !Number.isFinite(det)) return null
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  }
}

export function translationMatrix(tx: number, ty: number): GpuixMatrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }
}

export function rotationMatrix(radians: number): GpuixMatrix2D {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
}

export function scalingMatrix(sx: number, sy: number): GpuixMatrix2D {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }
}

/**
 * The largest factor any direction is scaled by — the operator norm of the
 * linear part. Stroke flattening divides its tolerance by this so a path
 * drawn at 4x scale gets 4x the segment density in user space.
 */
export function maxScaleOf(m: GpuixMatrix2D): number {
  // Singular values squared: (frobenius² ± spread) / 2.
  const fro = m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d
  const spread = Math.hypot(m.a * m.a + m.b * m.b - m.c * m.c - m.d * m.d, 2 * (m.a * m.c + m.b * m.d))
  const sigma2 = (fro + spread) / 2
  return Math.sqrt(Math.max(sigma2, 0))
}
