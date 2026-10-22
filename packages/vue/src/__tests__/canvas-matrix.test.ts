/// Unit tests for the affine 2D matrix helpers backing canvas transforms:
/// the DOM `{a, b, c, d, e, f}` convention, the apply-first/apply-second
/// multiply order the context accumulates with, inversion of singular and
/// non-finite matrices, and the operator-norm scale stroke flattening uses.

import { describe, expect, it } from "vitest"
import {
  applyMatrix,
  identityMatrix,
  invertMatrix,
  maxScaleOf,
  multiplyMatrix,
  rotationMatrix,
  scalingMatrix,
  translationMatrix,
} from "../canvas/matrix.js"

const TAU = Math.PI * 2

describe("identityMatrix", () => {
  it("returns the identity and maps points unchanged", () => {
    const m = identityMatrix()
    expect(m).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    expect(applyMatrix(m, 3, -4)).toEqual([3, -4])
  })
})

describe("multiplyMatrix", () => {
  it("applies first, then second — translation then rotation", () => {
    // Rotate after translating: (0,0) → (10,0) → rotated 90° → (0,10).
    const m = multiplyMatrix(translationMatrix(10, 0), rotationMatrix(Math.PI / 2))
    expect(applyMatrix(m, 0, 0)[0]).toBeCloseTo(0)
    expect(applyMatrix(m, 0, 0)[1]).toBeCloseTo(10)
  })

  it("applies the scale before the translation when given as (scale, translate)", () => {
    // (2, 3) → ×2 → (4, 6) → translated → (14, 16).
    const m = multiplyMatrix(scalingMatrix(2, 2), translationMatrix(10, 10))
    expect(applyMatrix(m, 2, 3)).toEqual([14, 16])
  })

  it("treats identity as the neutral element on both sides", () => {
    const t = translationMatrix(3, 7)
    const id = identityMatrix()
    expect(multiplyMatrix(id, t)).toEqual(t)
    expect(multiplyMatrix(t, id)).toEqual(t)
  })

  it("is associative", () => {
    const a = translationMatrix(2, -3)
    const b = rotationMatrix(0.7)
    const c = scalingMatrix(1.5, 0.5)
    const left = multiplyMatrix(multiplyMatrix(a, b), c)
    const right = multiplyMatrix(a, multiplyMatrix(b, c))
    for (const key of ["a", "b", "c", "d", "e", "f"] as const) {
      expect(left[key]).toBeCloseTo(right[key])
    }
  })

  it("chains a fresh local transform ahead of the accumulated frame", () => {
    // The accumulation ctx.translate(20, 0); ctx.rotate(90°); ctx.scale(2, 2)
    // needs: scale maps the point first, then rotate, then the old frame —
    // (1, 1) → (2, 2) → (-2, 2) → (18, 2).
    const ctm = multiplyMatrix(
      scalingMatrix(2, 2),
      multiplyMatrix(rotationMatrix(Math.PI / 2), translationMatrix(20, 0)),
    )
    const [x, y] = applyMatrix(ctm, 1, 1)
    expect(x).toBeCloseTo(18)
    expect(y).toBeCloseTo(2)
  })
})

describe("applyMatrix", () => {
  it("maps a point through translation and rotation", () => {
    expect(applyMatrix(translationMatrix(5, -2), 0, 0)).toEqual([5, -2])
    // 90° rotation: (1, 0) → (0, 1).
    const [rx, ry] = applyMatrix(rotationMatrix(Math.PI / 2), 1, 0)
    expect(rx).toBeCloseTo(0)
    expect(ry).toBeCloseTo(1)
  })

  it("drops exact-zero coefficient terms instead of multiplying Infinity", () => {
    // A zero scale column would turn 0 · Infinity into NaN; the helper keeps
    // infinite user-space coordinates finite on the other axis.
    expect(applyMatrix(scalingMatrix(0, 1), Infinity, 5)).toEqual([0, 5])
    expect(applyMatrix(scalingMatrix(1, 0), 5, Infinity)).toEqual([5, 0])
    expect(applyMatrix(identityMatrix(), Infinity, 2)).toEqual([Infinity, 2])
  })
})

describe("invertMatrix", () => {
  it("inverts the identity to itself", () => {
    const inv = invertMatrix(identityMatrix())!
    for (const key of ["a", "b", "c", "d", "e", "f"] as const) {
      expect(inv[key]).toBeCloseTo(identityMatrix()[key])
    }
  })

  it("inverts a translation by negating the offset", () => {
    const inv = invertMatrix(translationMatrix(10, 20))!
    expect(inv.e).toBeCloseTo(-10)
    expect(inv.f).toBeCloseTo(-20)
    expect(inv.a).toBeCloseTo(1)
    expect(inv.d).toBeCloseTo(1)
  })

  it("inverts a rotation as the opposite rotation", () => {
    const inv = invertMatrix(rotationMatrix(0.9))!
    const opposite = rotationMatrix(-0.9)
    for (const key of ["a", "b", "c", "d", "e", "f"] as const) {
      expect(inv[key]).toBeCloseTo(opposite[key])
    }
  })

  it("undoes a composed frame when applied after it", () => {
    const m = multiplyMatrix(multiplyMatrix(translationMatrix(3, 4), rotationMatrix(0.6)), scalingMatrix(2, 5))
    const roundTrip = multiplyMatrix(m, invertMatrix(m)!)
    const [x, y] = applyMatrix(roundTrip, 7, -9)
    expect(x).toBeCloseTo(7)
    expect(y).toBeCloseTo(-9)
  })

  it("returns null for singular matrices", () => {
    expect(invertMatrix(scalingMatrix(0, 1))).toBeNull()
    expect(invertMatrix(scalingMatrix(2, 0))).toBeNull()
    expect(invertMatrix({ a: 0, b: 0, c: 0, d: 0, e: 1, f: 1 })).toBeNull()
  })

  it("returns null when the determinant is not finite", () => {
    expect(invertMatrix({ a: Infinity, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBeNull()
    expect(invertMatrix({ a: NaN, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBeNull()
  })

  it("inverts a near-singular but finite matrix", () => {
    const inv = invertMatrix(scalingMatrix(1e-150, 1))!
    expect(inv.a).toBeCloseTo(1e150)
  })
})

describe("constructor helpers", () => {
  it("builds a rotation matrix with cos/sin in canvas field positions", () => {
    const m = rotationMatrix(Math.PI / 6)
    expect(m.a).toBeCloseTo(Math.cos(Math.PI / 6))
    expect(m.b).toBeCloseTo(Math.sin(Math.PI / 6))
    expect(m.c).toBeCloseTo(-Math.sin(Math.PI / 6))
    expect(m.d).toBeCloseTo(Math.cos(Math.PI / 6))
    expect(m.e).toBe(0)
    expect(m.f).toBe(0)
    // A full turn is the identity.
    const full = rotationMatrix(TAU)
    expect(full.a).toBeCloseTo(1)
    expect(full.b).toBeCloseTo(0)
  })

  it("builds independent x/y scales", () => {
    expect(scalingMatrix(3, -2)).toEqual({ a: 3, b: 0, c: 0, d: -2, e: 0, f: 0 })
  })
})

describe("maxScaleOf", () => {
  it("reports 1 for the identity and pure translations", () => {
    expect(maxScaleOf(identityMatrix())).toBeCloseTo(1)
    expect(maxScaleOf(translationMatrix(-9, 42))).toBeCloseTo(1)
  })

  it("reports the larger axis of an axis-aligned scale", () => {
    expect(maxScaleOf(scalingMatrix(3, 4))).toBeCloseTo(4)
    expect(maxScaleOf(scalingMatrix(0.5, 2))).toBeCloseTo(2)
  })

  it("preserves scale across a rotation", () => {
    const m = multiplyMatrix(rotationMatrix(1.1), scalingMatrix(2, 2))
    expect(maxScaleOf(m)).toBeCloseTo(2)
  })

  it("reports the golden ratio for a unit shear", () => {
    // Singular values of [[1, 1], [0, 1]] are φ and 1/φ.
    expect(maxScaleOf({ a: 1, b: 0, c: 1, d: 1, e: 0, f: 0 })).toBeCloseTo((1 + Math.sqrt(5)) / 2)
  })

  it("reports the surviving axis of a degenerate scale", () => {
    expect(maxScaleOf(scalingMatrix(5, 0))).toBeCloseTo(5)
  })
})
