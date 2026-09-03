//! Affine 2D matrices in the DOM canvas convention.
//!
//! Verbatim port of `packages/vue/src/canvas/matrix.ts`; the canvas WPT suite
//! pins the semantics.
//!
//! A matrix is `{a, b, c, d, e, f}` and maps a point as
//! `x' = a*x + c*y + e`, `y' = b*x + d*y + f` — the same fields
//! `CanvasRenderingContext2D.getTransform()` returns. (The TS interface also
//! carries an optional `isIdentity` convenience flag that `getTransform()`
//! fills in; it takes no part in the matrix algebra and stays on the JS side.)

/// JS `Math.max`: propagates NaN. Rust's `f64::max` ignores NaN instead, which
/// would turn a NaN matrix into `0` rather than NaN below.
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else {
        b
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Matrix2D {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

pub fn identity_matrix() -> Matrix2D {
    Matrix2D {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: 0.0,
        f: 0.0,
    }
}

/// Multiply two matrices: the result applies `first`, then `second` — the
/// accumulation `ctx.translate()` etc. needs (the fresh local transform maps
/// the point before the already-built frame does).
pub fn multiply_matrix(first: &Matrix2D, second: &Matrix2D) -> Matrix2D {
    let Matrix2D {
        a: a1,
        b: b1,
        c: c1,
        d: d1,
        e: e1,
        f: f1,
    } = *first;
    let Matrix2D {
        a: a2,
        b: b2,
        c: c2,
        d: d2,
        e: e2,
        f: f2,
    } = *second;
    Matrix2D {
        a: a2 * a1 + c2 * b1,
        b: b2 * a1 + d2 * b1,
        c: a2 * c1 + c2 * d1,
        d: b2 * c1 + d2 * d1,
        e: a2 * e1 + c2 * f1 + e2,
        f: b2 * e1 + d2 * f1 + f2,
    }
}

/// Map a point through a matrix. Exact-zero coefficients drop their term
/// instead of multiplying: `0 · ±Infinity` is NaN, and a scaled path can
/// legitimately produce infinite coordinates.
pub fn apply_matrix(m: &Matrix2D, x: f64, y: f64) -> (f64, f64) {
    let px = (if m.a == 0.0 { 0.0 } else { m.a * x })
        + (if m.c == 0.0 { 0.0 } else { m.c * y })
        + m.e;
    let py = (if m.b == 0.0 { 0.0 } else { m.b * x })
        + (if m.d == 0.0 { 0.0 } else { m.d * y })
        + m.f;
    (px, py)
}

/// The inverse, or `None` for a singular matrix (degenerate scale). DOM
/// semantics at that point are undefined-ish; callers fall back to skipping
/// the draw, which is what browsers do with a zero-area transform.
pub fn invert_matrix(m: &Matrix2D) -> Option<Matrix2D> {
    let det = m.a * m.d - m.b * m.c;
    if det == 0.0 || !det.is_finite() {
        return None;
    }
    Some(Matrix2D {
        a: m.d / det,
        b: -m.b / det,
        c: -m.c / det,
        d: m.a / det,
        e: (m.c * m.f - m.d * m.e) / det,
        f: (m.b * m.e - m.a * m.f) / det,
    })
}

pub fn translation_matrix(tx: f64, ty: f64) -> Matrix2D {
    Matrix2D {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: tx,
        f: ty,
    }
}

pub fn rotation_matrix(radians: f64) -> Matrix2D {
    let cos = radians.cos();
    let sin = radians.sin();
    Matrix2D {
        a: cos,
        b: sin,
        c: -sin,
        d: cos,
        e: 0.0,
        f: 0.0,
    }
}

pub fn scaling_matrix(sx: f64, sy: f64) -> Matrix2D {
    Matrix2D {
        a: sx,
        b: 0.0,
        c: 0.0,
        d: sy,
        e: 0.0,
        f: 0.0,
    }
}

/// The largest factor any direction is scaled by — the operator norm of the
/// linear part. Stroke flattening divides its tolerance by this so a path
/// drawn at 4x scale gets 4x the segment density in user space.
pub fn max_scale_of(m: &Matrix2D) -> f64 {
    // Singular values squared: (frobenius² ± spread) / 2.
    let fro = m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d;
    let spread =
        (m.a * m.a + m.b * m.b - m.c * m.c - m.d * m.d).hypot(2.0 * (m.a * m.c + m.b * m.d));
    let sigma2 = (fro + spread) / 2.0;
    js_max(sigma2, 0.0).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invert_round_trips_to_identity() {
        let m = multiply_matrix(
            &multiply_matrix(&translation_matrix(3.0, -4.0), &rotation_matrix(0.7)),
            &scaling_matrix(2.0, 5.0),
        );
        let inv = invert_matrix(&m).expect("non-singular");
        let identity = identity_matrix();
        for product in [multiply_matrix(&m, &inv), multiply_matrix(&inv, &m)] {
            assert!((product.a - identity.a).abs() < 1e-12);
            assert!((product.b - identity.b).abs() < 1e-12);
            assert!((product.c - identity.c).abs() < 1e-12);
            assert!((product.d - identity.d).abs() < 1e-12);
            assert!((product.e - identity.e).abs() < 1e-12);
            assert!((product.f - identity.f).abs() < 1e-12);
        }
    }

    #[test]
    fn invert_returns_none_for_singular_matrices() {
        assert!(invert_matrix(&scaling_matrix(0.0, 1.0)).is_none());
        assert!(invert_matrix(&Matrix2D {
            a: 1.0,
            b: 2.0,
            c: 2.0,
            d: 4.0,
            e: 0.0,
            f: 0.0
        })
        .is_none());
        // A determinant that overflows to infinity is not invertible either.
        assert!(invert_matrix(&Matrix2D {
            a: 1e308,
            b: 0.0,
            c: 0.0,
            d: 1e308,
            e: 0.0,
            f: 0.0
        })
        .is_none());
    }

    #[test]
    fn max_scale_of_matches_rotation_and_scale() {
        assert!((max_scale_of(&rotation_matrix(0.3)) - 1.0).abs() < 1e-12);
        assert!((max_scale_of(&scaling_matrix(3.0, 4.0)) - 4.0).abs() < 1e-12);
        // Rotation does not change the singular values.
        let m = multiply_matrix(&scaling_matrix(3.0, 4.0), &rotation_matrix(0.7));
        assert!((max_scale_of(&m) - 4.0).abs() < 1e-12);
    }

    #[test]
    fn apply_matrix_drops_exact_zero_terms() {
        // 0 · ±Infinity is NaN in the TS module too; an exact-zero coefficient
        // must drop its term so scaled paths can carry infinite coordinates.
        let (x, y) = apply_matrix(&scaling_matrix(0.0, 1.0), 5.0, f64::INFINITY);
        assert_eq!(x, 0.0);
        assert_eq!(y, f64::INFINITY);
    }
}
