//! Path building and flattening for the 2D canvas.
//!
//! Verbatim port of `packages/vue/src/canvas/path.ts`; the canvas WPT suite
//! pins the semantics.
//!
//! A path is a list of subpaths of **user-space** segments (line, quadratic,
//! cubic, ellipse-arc). Each segment carries the CTM that was current when it
//! was appended: the DOM applies transformations while the path is built, not
//! when it is drawn, so a path can mix matrices segment by segment. Flattening
//! subdivides curves adaptively and emits device-space polylines; the
//! tolerance is applied to the transformed control points, so quality tracks
//! each segment's own matrix.

use std::f64::consts::PI;

use super::matrix::{apply_matrix, Matrix2D};

/// One path segment — the TS tagged union `{ k: "L" | "Q" | "C" | "A", … }`,
/// each variant carrying the CTM (`m`) captured when it was appended.
#[derive(Clone, Copy, Debug)]
pub enum PathSegment {
    L {
        x: f64,
        y: f64,
        m: Matrix2D,
    },
    Q {
        cx: f64,
        cy: f64,
        x: f64,
        y: f64,
        m: Matrix2D,
    },
    C {
        c1x: f64,
        c1y: f64,
        c2x: f64,
        c2y: f64,
        x: f64,
        y: f64,
        m: Matrix2D,
    },
    A {
        cx: f64,
        cy: f64,
        rx: f64,
        ry: f64,
        rot: f64,
        start: f64,
        end: f64,
        ccw: bool,
        m: Matrix2D,
    },
}

#[derive(Clone, Debug)]
pub struct PathSubpath {
    pub sx: f64,
    pub sy: f64,
    /// The CTM captured when the subpath was started — the DOM transforms path
    /// coordinates while the path is being built, not when it is drawn, so
    /// every segment carries the matrix that was current when it was appended.
    pub m: Matrix2D,
    pub segs: Vec<PathSegment>,
    pub closed: bool,
}

/// One flattened polyline in device space, x/y interleaved.
#[derive(Clone, Debug, PartialEq)]
pub struct Poly {
    pub pts: Vec<f64>,
    pub closed: bool,
}

const TAU: f64 = PI * 2.0;

/// The identity CTM the TS methods default their `m` argument to (Rust has
/// no default arguments; callers pass this — or `matrix::identity_matrix()`,
/// the same value — where the TS call omitted the matrix).
pub const IDENTITY: Matrix2D = Matrix2D {
    a: 1.0,
    b: 0.0,
    c: 0.0,
    d: 1.0,
    e: 0.0,
    f: 0.0,
};

/// The exceptions the TS builder throws, mapped to Rust: the DOM throws a
/// `DOMException` named `IndexSizeError` for negative radii and a `RangeError`
/// for malformed `roundRect` radii. The TS `radiusNumber` helper's BigInt
/// `TypeError` is unreachable with `f64` arguments and has no variant here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PathError {
    /// `DOMException("…", "IndexSizeError")` — negative radius/radii.
    IndexSize,
    /// `RangeError` — empty or >4 radii, or a finite negative radius.
    Range,
}

/// One `roundRect` radius entry: the TS `radii` union member — a scalar
/// number, or a `DOMPointInit`-style `{x, y}` pair. Absent members (`None`,
/// the TS `undefined`/`null`) default to 0.
#[derive(Clone, Copy, Debug)]
pub enum RoundRectRadius {
    Scalar(f64),
    Point { x: Option<f64>, y: Option<f64> },
}

// JS `Math.min`/`Math.max` propagate NaN; Rust's `f64::min`/`f64::max` ignore
// it. Keep the JS behaviour so NaN coordinates poison results exactly like
// the TS module.
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else {
        b
    }
}

fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else {
        b
    }
}

/// JS `|| 1` on a number: 0 and NaN are falsy.
fn or_one(v: f64) -> f64 {
    if v == 0.0 || v.is_nan() {
        1.0
    } else {
        v
    }
}

fn all_finite(values: &[f64]) -> bool {
    values.iter().all(|v| v.is_finite())
}

/// Distance from p to the segment p0–p1 (used for curve flatness).
fn point_line_dist(px: f64, py: f64, x0: f64, y0: f64, x1: f64, y1: f64) -> f64 {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let len2 = dx * dx + dy * dy;
    if len2 == 0.0 {
        return (px - x0).hypot(py - y0);
    }
    let mut t = ((px - x0) * dx + (py - y0) * dy) / len2;
    t = if t < 0.0 {
        0.0
    } else if t > 1.0 {
        1.0
    } else {
        t
    };
    (px - (x0 + t * dx)).hypot(py - (y0 + t * dy))
}

/// Builder for the context's current default path.
///
/// The TS class holds `open` as a live reference into `subpaths`; here it is
/// the index of the open subpath, which reproduces the same aliasing.
#[derive(Clone, Debug, Default)]
pub struct PathBuilder {
    pub subpaths: Vec<PathSubpath>,
    /// Index of the open subpath segments are appended to; `None` right after
    /// `close_path`.
    open: Option<usize>,
    cx: f64,
    cy: f64,
    has_current: bool,
}

impl PathBuilder {
    pub fn current_point(&self) -> Option<(f64, f64)> {
        if self.has_current {
            Some((self.cx, self.cy))
        } else {
            None
        }
    }

    pub fn move_to(&mut self, x: f64, y: f64, m: Matrix2D) {
        // The TS converts through Number() first; with f64 arguments the
        // conversion is the identity, so only the finiteness check remains.
        if !all_finite(&[x, y]) {
            return;
        }
        self.subpaths.push(PathSubpath {
            sx: x,
            sy: y,
            m,
            segs: Vec::new(),
            closed: false,
        });
        self.open = Some(self.subpaths.len() - 1);
        self.cx = x;
        self.cy = y;
        self.has_current = true;
    }

    pub fn line_to(&mut self, x: f64, y: f64, m: Matrix2D) {
        // Validate without touching state, like the TS: the DOM converts
        // every argument (running valueOf) even when a sibling argument is
        // non-finite.
        if !all_finite(&[x, y]) {
            return;
        }
        if !self.has_current {
            self.move_to(x, y, m);
            return;
        }
        let open = self.ensure_open(m);
        self.subpaths[open].segs.push(PathSegment::L { x, y, m });
        self.cx = x;
        self.cy = y;
    }

    pub fn close_path(&mut self) {
        if let Some(open) = self.open {
            let sub = &mut self.subpaths[open];
            sub.closed = true;
            self.cx = sub.sx;
            self.cy = sub.sy;
        }
        self.open = None;
    }

    pub fn quadratic_curve_to(&mut self, cpx: f64, cpy: f64, x: f64, y: f64, m: Matrix2D) {
        if !all_finite(&[cpx, cpy, x, y]) {
            return;
        }
        if !self.has_current {
            self.move_to(cpx, cpy, m);
        }
        let open = self.ensure_open(m);
        self.subpaths[open].segs.push(PathSegment::Q {
            cx: cpx,
            cy: cpy,
            x,
            y,
            m,
        });
        self.cx = x;
        self.cy = y;
    }

    pub fn bezier_curve_to(
        &mut self,
        c1x: f64,
        c1y: f64,
        c2x: f64,
        c2y: f64,
        x: f64,
        y: f64,
        m: Matrix2D,
    ) {
        if !all_finite(&[c1x, c1y, c2x, c2y, x, y]) {
            return;
        }
        if !self.has_current {
            self.move_to(c1x, c1y, m);
        }
        let open = self.ensure_open(m);
        self.subpaths[open].segs.push(PathSegment::C {
            c1x,
            c1y,
            c2x,
            c2y,
            x,
            y,
            m,
        });
        self.cx = x;
        self.cy = y;
    }

    /// DOM `arcTo`: line to the tangent point on the incoming edge, then an
    /// arc around the inscribed circle to the tangent point on the outgoing
    /// edge.
    pub fn arc_to(
        &mut self,
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        radius: f64,
        m: Matrix2D,
    ) -> Result<(), PathError> {
        if !all_finite(&[x1, y1, x2, y2, radius]) {
            return Ok(());
        }
        if radius < 0.0 {
            return Err(PathError::IndexSize);
        }
        if !self.has_current {
            // No current point: the arc starts a subpath at its first tangent
            // point. Compute it below by treating the current point as P1
            // (degenerate).
            self.move_to(x1, y1, m);
            return Ok(());
        }
        let x0 = self.cx;
        let y0 = self.cy;
        if (x0 == x1 && y0 == y1) || (x1 == x2 && y1 == y2) || radius == 0.0 {
            self.line_to(x1, y1, m);
            return Ok(());
        }
        let l0 = (x1 - x0).hypot(y1 - y0);
        let l2 = (x2 - x1).hypot(y2 - y1);
        let ux = (x1 - x0) / l0;
        let uy = (y1 - y0) / l0;
        let vx = (x2 - x1) / l2;
        let vy = (y2 - y1) / l2;
        let dot = ux * vx + uy * vy;
        let cross = ux * vy - uy * vx;
        if 1.0 + dot < 1e-12 {
            // 180° reversal: the tangent points run to infinity; keep the corner.
            self.line_to(x1, y1, m);
            return Ok(());
        }
        // Unsigned tangent length (r·tan(θ/2)); the circle center sits one
        // radius off both edges, on the side the corner turns toward.
        let t = ((radius * cross) / (1.0 + dot)).abs();
        let t1x = x1 - ux * t;
        let t1y = y1 - uy * t;
        let t2x = x1 + vx * t;
        let t2y = y1 + vy * t;
        let side = if cross > 0.0 { 1.0 } else { -1.0 };
        let ox = t1x + side * radius * -uy;
        let oy = t1y + side * radius * ux;
        self.line_to(t1x, t1y, m);
        let start = (t1y - oy).atan2(t1x - ox);
        let end = (t2y - oy).atan2(t2x - ox);
        let open = self.ensure_open(m);
        self.subpaths[open].segs.push(PathSegment::A {
            cx: ox,
            cy: oy,
            rx: radius,
            ry: radius,
            rot: 0.0,
            start,
            end,
            // cross > 0 turns through increasing canvas angles (y down).
            ccw: cross < 0.0,
            m,
        });
        self.cx = t2x;
        self.cy = t2y;
        Ok(())
    }

    pub fn ellipse(
        &mut self,
        x: f64,
        y: f64,
        radius_x: f64,
        radius_y: f64,
        rotation: f64,
        start_angle: f64,
        end_angle: f64,
        anticlockwise: bool,
        m: Matrix2D,
    ) -> Result<(), PathError> {
        if !all_finite(&[
            x,
            y,
            radius_x,
            radius_y,
            rotation,
            start_angle,
            end_angle,
        ]) {
            return Ok(());
        }
        if radius_x < 0.0 || radius_y < 0.0 {
            return Err(PathError::IndexSize);
        }
        let start_point = self.ellipse_point(x, y, radius_x, radius_y, rotation, start_angle);
        if self.has_current {
            self.line_to(start_point.0, start_point.1, m);
        } else {
            self.move_to(start_point.0, start_point.1, m);
        }
        let open = self.ensure_open(m);
        self.subpaths[open].segs.push(PathSegment::A {
            cx: x,
            cy: y,
            rx: radius_x,
            ry: radius_y,
            rot: rotation,
            start: start_angle,
            end: end_angle,
            ccw: anticlockwise,
            m,
        });
        let end_point = self.ellipse_point(x, y, radius_x, radius_y, rotation, end_angle);
        self.cx = end_point.0;
        self.cy = end_point.1;
        Ok(())
    }

    /// Non-finite arguments are silently ignored; only a finite negative
    /// radius throws.
    pub fn arc(
        &mut self,
        x: f64,
        y: f64,
        radius: f64,
        start_angle: f64,
        end_angle: f64,
        anticlockwise: bool,
        m: Matrix2D,
    ) -> Result<(), PathError> {
        if !all_finite(&[x, y, radius, start_angle, end_angle]) {
            return Ok(());
        }
        if radius < 0.0 {
            return Err(PathError::IndexSize);
        }
        self.ellipse(
            x,
            y,
            radius,
            radius,
            0.0,
            start_angle,
            end_angle,
            anticlockwise,
            m,
        )
    }

    pub fn rect(&mut self, x: f64, y: f64, w: f64, h: f64, m: Matrix2D) {
        if !all_finite(&[x, y, w, h]) {
            return;
        }
        self.move_to(x, y, m);
        self.line_to(x + w, y, m);
        self.line_to(x + w, y + h, m);
        self.line_to(x, y + h, m);
        self.close_path();
    }

    pub fn round_rect(
        &mut self,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        radii: &[RoundRectRadius],
        m: Matrix2D,
    ) -> Result<(), PathError> {
        // WebIDL converts every argument before validation, so valueOf side
        // effects happen even when a sibling argument is non-finite; with f64
        // arguments only the finiteness check remains.
        if !all_finite(&[x, y, w, h]) {
            return Ok(());
        }
        let corners = match normalize_round_rect_radii(radii, w.abs(), h.abs()) {
            Err(e) => return Err(e),
            // Non-finite radii are silently ignored, like other arguments.
            Ok(None) => return Ok(()),
            Ok(Some(corners)) => corners,
        };
        let [tl, tr, br, bl] = corners;
        self.round_rect_corners(x, y, w, h, &[tl.rx, tl.ry, tr.rx, tr.ry, br.rx, br.ry, bl.rx, bl.ry], m);
        Ok(())
    }

    /// The `roundRect` geometry over **pre-normalized** corners — eight
    /// numbers, `[tl.rx, tl.ry, tr.rx, tr.ry, br.rx, br.ry, bl.rx, bl.ry]`,
    /// already spread to four corners and uniformly scaled. The JS facade
    /// performs that normalization (its exceptions and valueOf side effects
    /// are script-visible and must stay JS-side), so the napi context calls
    /// this entry directly; the validating `round_rect` above delegates here
    /// so both paths share one geometry core.
    pub fn round_rect_corners(&mut self, x: f64, y: f64, w: f64, h: f64, corners: &[f64], m: Matrix2D) {
        let mut tl = CornerRadii { rx: corners[0], ry: corners[1] };
        let mut tr = CornerRadii { rx: corners[2], ry: corners[3] };
        let mut br = CornerRadii { rx: corners[4], ry: corners[5] };
        let mut bl = CornerRadii { rx: corners[6], ry: corners[7] };
        // A negative extent mirrors the rectangle: normalize the box and flip
        // the corner list across the same axes ([tl,tr,br,bl] order). An odd
        // number of mirrors also reverses the traversal direction — the traced
        // orientation flips, which nonzero fills observe.
        let mut bx = x;
        let mut by = y;
        let mut bw = w;
        let mut bh = h;
        if bw < 0.0 {
            bx += bw;
            bw = -bw;
            std::mem::swap(&mut tl, &mut tr);
            std::mem::swap(&mut bl, &mut br);
        }
        if bh < 0.0 {
            by += bh;
            bh = -bh;
            std::mem::swap(&mut tl, &mut bl);
            std::mem::swap(&mut tr, &mut br);
        }
        let mirrored = (w < 0.0) != (h < 0.0);

        if mirrored {
            self.move_to(bx + tl.rx, by, m);
            self.corner_arc(bx + tl.rx, by + tl.ry, tl, PI * 1.5, PI, m, true);
            self.line_to(bx, by + bh - bl.ry, m);
            self.corner_arc(bx + bl.rx, by + bh - bl.ry, bl, PI, PI / 2.0, m, true);
            self.line_to(bx + bw - br.rx, by + bh, m);
            self.corner_arc(bx + bw - br.rx, by + bh - br.ry, br, PI / 2.0, 0.0, m, true);
            self.line_to(bx + bw, by + tr.ry, m);
            self.corner_arc(bx + bw - tr.rx, by + tr.ry, tr, 0.0, -PI / 2.0, m, true);
            self.line_to(bx + tl.rx, by, m);
            self.close_path();
            return;
        }

        self.move_to(bx + tl.rx, by, m);
        self.line_to(bx + bw - tr.rx, by, m);
        self.corner_arc(bx + bw - tr.rx, by + tr.ry, tr, -PI / 2.0, 0.0, m, false);
        self.line_to(bx + bw, by + bh - br.ry, m);
        self.corner_arc(bx + bw - br.rx, by + bh - br.ry, br, 0.0, PI / 2.0, m, false);
        self.line_to(bx + bl.rx, by + bh, m);
        self.corner_arc(bx + bl.rx, by + bh - bl.ry, bl, PI / 2.0, PI, m, false);
        self.line_to(bx, by + tl.ry, m);
        self.corner_arc(bx + tl.rx, by + tl.ry, tl, PI, PI * 1.5, m, false);
        self.close_path();
    }

    fn corner_arc(
        &mut self,
        cx: f64,
        cy: f64,
        corner: CornerRadii,
        start: f64,
        end: f64,
        m: Matrix2D,
        ccw: bool,
    ) {
        if corner.rx <= 0.0 || corner.ry <= 0.0 {
            return;
        }
        let open = self.ensure_open(m);
        self.subpaths[open].segs.push(PathSegment::A {
            cx,
            cy,
            rx: corner.rx,
            ry: corner.ry,
            rot: 0.0,
            start,
            end,
            ccw,
            m,
        });
        let p = self.ellipse_point(cx, cy, corner.rx, corner.ry, 0.0, end);
        self.cx = p.0;
        self.cy = p.1;
    }

    /// Point on an ellipse at angle θ (canvas convention, y down).
    fn ellipse_point(
        &self,
        cx: f64,
        cy: f64,
        rx: f64,
        ry: f64,
        rot: f64,
        theta: f64,
    ) -> (f64, f64) {
        let cos_rot = rot.cos();
        let sin_rot = rot.sin();
        let px = rx * theta.cos();
        let py = ry * theta.sin();
        (cx + cos_rot * px - sin_rot * py, cy + sin_rot * px + cos_rot * py)
    }

    /// After closePath the next segment opens a fresh subpath from the close
    /// point. Returns the open subpath's index (the TS class stores the live
    /// reference itself).
    fn ensure_open(&mut self, m: Matrix2D) -> usize {
        if let Some(i) = self.open {
            return i;
        }
        self.subpaths.push(PathSubpath {
            sx: self.cx,
            sy: self.cy,
            m,
            segs: Vec::new(),
            closed: false,
        });
        let i = self.subpaths.len() - 1;
        self.open = Some(i);
        i
    }
}

#[derive(Clone, Copy, Debug)]
struct CornerRadii {
    rx: f64,
    ry: f64,
}

/// WebIDL-ish double conversion for a radius member. The TS helper rejects
/// BigInt with a TypeError and coerces everything else through `Number`;
/// `f64` arguments make both branches unreachable — `None` (an absent
/// `undefined`/`null` member) maps to 0.
fn radius_number(value: Option<f64>) -> f64 {
    value.unwrap_or(0.0)
}

fn normalize_round_rect_radii(
    radii: &[RoundRectRadius],
    w: f64,
    h: f64,
) -> Result<Option<[CornerRadii; 4]>, PathError> {
    if radii.is_empty() {
        return Err(PathError::Range);
    }
    if radii.len() > 4 {
        return Err(PathError::Range);
    }
    let mut corners: Vec<CornerRadii> = radii
        .iter()
        .map(|entry| match *entry {
            RoundRectRadius::Scalar(v) => CornerRadii {
                rx: radius_number(Some(v)),
                ry: radius_number(Some(v)),
            },
            // DOMPointInit: members are independent and default to 0 when
            // absent, which is why `{}`, `[]` and `[undefined]` all mean
            // "square corner".
            RoundRectRadius::Point { x, y } => CornerRadii {
                rx: radius_number(x),
                ry: radius_number(y),
            },
        })
        .collect();
    // Non-finite radii make the whole call a silent no-op; a finite negative
    // radius is the RangeError case.
    if corners
        .iter()
        .any(|c| !c.rx.is_finite() || !c.ry.is_finite())
    {
        return Ok(None);
    }
    if corners.iter().any(|c| c.rx < 0.0 || c.ry < 0.0) {
        return Err(PathError::Range);
    }
    // CSS border-radius spreading: 1 → all, 2 → [a, b, a, b], 3 → [a, b, c, b].
    if corners.len() == 1 {
        let c = corners[0];
        corners.push(c);
        corners.push(c);
        corners.push(c);
    } else if corners.len() == 2 {
        corners.push(corners[0]);
        corners.push(corners[1]);
    } else if corners.len() == 3 {
        corners.push(corners[1]);
    }
    let [tl, tr, br, bl] = [corners[0], corners[1], corners[2], corners[3]];
    // Scale oversized corners down uniformly, like the spec's border-radius.
    let k = js_min(
        js_min(
            js_min(1.0, w / or_one(tl.rx + tr.rx)),
            js_min(w / or_one(bl.rx + br.rx), h / or_one(tl.ry + bl.ry)),
        ),
        h / or_one(tr.ry + br.ry),
    );
    if k < 1.0 {
        for corner in &mut corners {
            corner.rx *= k;
            corner.ry *= k;
        }
    }
    Ok(Some([corners[0], corners[1], corners[2], corners[3]]))
}

/// Normalize an arc sweep to the signed interval [-2π, 2π] the sampler wants.
fn normalized_sweep(start: f64, end: f64, ccw: bool) -> f64 {
    let mut sweep = end - start;
    if !ccw {
        if sweep >= TAU {
            sweep = TAU;
        } else if sweep < 0.0 {
            sweep = (sweep % TAU) + TAU;
        }
    } else if sweep <= -TAU {
        sweep = -TAU;
    } else if sweep > 0.0 {
        sweep = (sweep % TAU) - TAU;
    }
    sweep
}

/// Flatten every subpath into device-space polylines with a chord tolerance
/// of `tol` pixels. Every segment carries the CTM captured when it was
/// appended — the DOM applies transformations while the path is built — so
/// flattening transforms each piece with its own matrix. Curves are
/// transformed first and subdivided against the transformed control polygon;
/// arcs pick their sample count from the device-space radius.
pub fn flatten_path(subpaths: &[PathSubpath], tol: f64) -> Vec<Poly> {
    let mut polys: Vec<Poly> = Vec::new();
    for sub in subpaths {
        let mut pts: Vec<f64> = Vec::new();
        let (sx, sy) = apply_matrix(&sub.m, sub.sx, sub.sy);
        pts.push(sx);
        pts.push(sy);
        for seg in &sub.segs {
            match *seg {
                PathSegment::L { x, y, m } => {
                    let (x, y) = apply_matrix(&m, x, y);
                    pts.push(x);
                    pts.push(y);
                }
                PathSegment::Q {
                    cx,
                    cy,
                    x,
                    y,
                    m,
                } => {
                    let (cx, cy) = apply_matrix(&m, cx, cy);
                    let (x, y) = apply_matrix(&m, x, y);
                    let n = pts.len();
                    flatten_quad(pts[n - 2], pts[n - 1], cx, cy, x, y, &mut pts, tol, 0);
                }
                PathSegment::C {
                    c1x,
                    c1y,
                    c2x,
                    c2y,
                    x,
                    y,
                    m,
                } => {
                    let (c1x, c1y) = apply_matrix(&m, c1x, c1y);
                    let (c2x, c2y) = apply_matrix(&m, c2x, c2y);
                    let (x, y) = apply_matrix(&m, x, y);
                    let n = pts.len();
                    flatten_cubic(
                        pts[n - 2],
                        pts[n - 1],
                        c1x,
                        c1y,
                        c2x,
                        c2y,
                        x,
                        y,
                        &mut pts,
                        tol,
                        0,
                    );
                }
                PathSegment::A { .. } => {
                    flatten_arc(seg, tol, &mut pts);
                }
            }
        }
        polys.push(Poly {
            pts,
            closed: sub.closed,
        });
    }
    polys
}

fn flatten_quad(
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    out: &mut Vec<f64>,
    tol: f64,
    depth: i32,
) {
    if depth > 18 || point_line_dist(x1, y1, x0, y0, x2, y2) <= tol {
        out.push(x2);
        out.push(y2);
        return;
    }
    let ax = (x0 + x1) / 2.0;
    let ay = (y0 + y1) / 2.0;
    let bx = (x1 + x2) / 2.0;
    let by = (y1 + y2) / 2.0;
    let mx = (ax + bx) / 2.0;
    let my = (ay + by) / 2.0;
    flatten_quad(x0, y0, ax, ay, mx, my, out, tol, depth + 1);
    flatten_quad(mx, my, bx, by, x2, y2, out, tol, depth + 1);
}

fn flatten_cubic(
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    x3: f64,
    y3: f64,
    out: &mut Vec<f64>,
    tol: f64,
    depth: i32,
) {
    let flat = depth > 18
        || js_max(
            point_line_dist(x1, y1, x0, y0, x3, y3),
            point_line_dist(x2, y2, x0, y0, x3, y3),
        ) <= tol;
    if flat {
        out.push(x3);
        out.push(y3);
        return;
    }
    let ax = (x0 + x1) / 2.0;
    let ay = (y0 + y1) / 2.0;
    let bx = (x1 + x2) / 2.0;
    let by = (y1 + y2) / 2.0;
    let cx = (x2 + x3) / 2.0;
    let cy = (y2 + y3) / 2.0;
    let dx = (ax + bx) / 2.0;
    let dy = (ay + by) / 2.0;
    let ex = (bx + cx) / 2.0;
    let ey = (by + cy) / 2.0;
    let mx = (dx + ex) / 2.0;
    let my = (dy + ey) / 2.0;
    flatten_cubic(x0, y0, ax, ay, dx, dy, mx, my, out, tol, depth + 1);
    flatten_cubic(mx, my, ex, ey, cx, cy, x3, y3, out, tol, depth + 1);
}

fn flatten_arc(seg: &PathSegment, tol: f64, out: &mut Vec<f64>) {
    let PathSegment::A {
        cx,
        cy,
        rx,
        ry,
        rot,
        start,
        end,
        ccw,
        m,
    } = *seg
    else {
        return;
    };
    let sweep = normalized_sweep(start, end, ccw);
    let cos_rot = rot.cos();
    let sin_rot = rot.sin();
    // Device-space half-axes: the linear part of the matrix applied to the
    // user-space axis vectors.
    let uxv = [cos_rot * rx, sin_rot * rx];
    let vyv = [-sin_rot * ry, cos_rot * ry];
    let axis_len =
        |v: [f64; 2]| (m.a * v[0] + m.c * v[1]).hypot(m.b * v[0] + m.d * v[1]);
    let rdev = js_max(axis_len(uxv), axis_len(vyv));
    if rdev == 0.0 {
        let (x, y) = apply_matrix(&m, cx, cy);
        out.push(x);
        out.push(y);
        return;
    }
    let ratio = js_min(1.0, js_max(-1.0, 1.0 - tol / rdev));
    let max_step = 2.0 * ratio.acos();
    let count = js_min(
        2048.0,
        js_max(
            4.0,
            (sweep.abs() / (if max_step > 1e-6 {
                max_step
            } else {
                PI / 2.0
            }))
            .ceil(),
        ),
    );
    let mut i = 1.0;
    while i <= count {
        let theta = start + (sweep * i) / count;
        let px = rx * theta.cos();
        let py = ry * theta.sin();
        let (x, y) = apply_matrix(
            &m,
            cx + cos_rot * px - sin_rot * py,
            cy + sin_rot * px + cos_rot * py,
        );
        out.push(x);
        out.push(y);
        i += 1.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canvas2d::geom::matrix::{identity_matrix, translation_matrix};

    fn signed_area(pts: &[f64]) -> f64 {
        let n = pts.len() / 2;
        let mut area = 0.0;
        for i in 0..n {
            let j = (i + 1) % n;
            area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
        }
        area / 2.0
    }

    #[test]
    fn line_to_before_move_to_starts_a_subpath() {
        let mut b = PathBuilder::default();
        b.line_to(5.0, 6.0, IDENTITY);
        assert_eq!(b.subpaths.len(), 1);
        assert!(b.subpaths[0].segs.is_empty());
        assert_eq!(b.current_point(), Some((5.0, 6.0)));
    }

    #[test]
    fn segments_flatten_under_their_own_matrix() {
        // The per-segment CTM: the second line keeps the matrix it was
        // appended under, not the subpath's start matrix.
        let mut b = PathBuilder::default();
        b.move_to(0.0, 0.0, identity_matrix());
        b.line_to(10.0, 0.0, identity_matrix());
        b.line_to(10.0, 10.0, translation_matrix(5.0, 5.0));
        let pts = &flatten_path(&b.subpaths, 0.1)[0].pts;
        assert_eq!(pts[0], 0.0);
        assert_eq!(pts[1], 0.0);
        assert_eq!(pts[2], 10.0);
        assert_eq!(pts[3], 0.0);
        assert_eq!(pts[4], 15.0);
        assert_eq!(pts[5], 15.0);
    }

    #[test]
    fn round_rect_radii_validation() {
        let mut b = PathBuilder::default();
        let id = identity_matrix();
        // A finite negative radius is the RangeError case.
        assert_eq!(
            b.round_rect(0.0, 0.0, 10.0, 10.0, &[RoundRectRadius::Scalar(-1.0)], id),
            Err(PathError::Range)
        );
        assert_eq!(b.round_rect(0.0, 0.0, 10.0, 10.0, &[], id), Err(PathError::Range));
        let five = [RoundRectRadius::Scalar(1.0); 5];
        assert_eq!(b.round_rect(0.0, 0.0, 10.0, 10.0, &five, id), Err(PathError::Range));
        // Non-finite radii are a silent no-op, like other arguments.
        b.round_rect(
            0.0,
            0.0,
            10.0,
            10.0,
            &[RoundRectRadius::Scalar(f64::NAN)],
            id,
        )
        .unwrap();
        assert!(b.subpaths.is_empty());
    }

    #[test]
    fn round_rect_mirrored_extent_flips_orientation() {
        let mut normal = PathBuilder::default();
        normal
            .round_rect(0.0, 0.0, 20.0, 10.0, &[RoundRectRadius::Scalar(5.0)], IDENTITY)
            .unwrap();
        let mut mirrored = PathBuilder::default();
        mirrored
            .round_rect(0.0, 0.0, 20.0, -10.0, &[RoundRectRadius::Scalar(5.0)], IDENTITY)
            .unwrap();
        let a = signed_area(&flatten_path(&normal.subpaths, 0.1)[0].pts);
        let b = signed_area(&flatten_path(&mirrored.subpaths, 0.1)[0].pts);
        // True area w·h − r²(4 − π) = 200 − 21.46; the flattened chords sit
        // inside each arc, cutting ≈ (2/3)·sag·chord per chord — about 2.0
        // across the 4 corners at tol 0.1, r 5.
        assert!((a - (200.0 - 25.0 * (4.0 - PI))).abs() < 2.5, "area {a}");
        assert!(a > 0.0);
        assert!(b < 0.0, "mirrored traversal must reverse orientation");
        assert!((a + b).abs() < 1e-6, "same box, opposite signs: {a} vs {b}");
    }

    #[test]
    fn ellipse_and_arc_reject_negative_radii() {
        let mut b = PathBuilder::default();
        assert_eq!(
            b.ellipse(0.0, 0.0, -1.0, 1.0, 0.0, 0.0, 1.0, false, IDENTITY),
            Err(PathError::IndexSize)
        );
        assert_eq!(
            b.arc(0.0, 0.0, -2.0, 0.0, 1.0, false, IDENTITY),
            Err(PathError::IndexSize)
        );
        assert!(b.subpaths.is_empty());
        // Non-finite arguments are silently ignored instead.
        b.arc(0.0, 0.0, f64::NAN, 0.0, 1.0, false, IDENTITY)
            .unwrap();
        assert!(b.subpaths.is_empty());
    }

    #[test]
    fn arc_sweep_past_two_pi_clamps_to_a_full_circle() {
        // end − start = 3π ≥ 2π: the sweep clamps to TAU, so the polyline
        // closes back onto the start point instead of ending at angle 3π
        // (which would put the last point near (−10, 0)).
        let mut b = PathBuilder::default();
        b.arc(0.0, 0.0, 10.0, 0.0, TAU + PI, false, IDENTITY)
            .unwrap();
        let pts = &flatten_path(&b.subpaths, 0.25)[0].pts;
        // Start point, the degenerate lineTo onto it, then `count` arc
        // samples. The exact count sits on a knife edge at this tolerance
        // (|sweep|/maxStep ≈ 14.000), so only bound it from below.
        assert!(pts.len() >= 2 * (2 + 4));
        assert_eq!(pts.len() % 2, 0);
        assert!((pts[0] - 10.0).abs() < 1e-9);
        assert_eq!(pts[1], 0.0);
        let n = pts.len();
        assert!((pts[n - 2] - 10.0).abs() < 1e-9, "last x {}", pts[n - 2]);
        assert!(pts[n - 1].abs() < 1e-9, "last y {}", pts[n - 1]);
    }

    #[test]
    fn arc_sample_count_clamps_to_its_bounds() {
        // Tiny sweep on a huge radius: ceil() < 4, so the count floors at 4.
        // On a fresh builder the arc starts its own subpath (moveTo only, no
        // lineTo), so the polyline is start point + count samples.
        let mut b = PathBuilder::default();
        b.arc(0.0, 0.0, 1000.0, 0.0, 0.001, false, IDENTITY)
            .unwrap();
        let pts = &flatten_path(&b.subpaths, 0.25)[0].pts;
        assert_eq!(pts.len(), 2 * (1 + 4));
        // Half turn on a 1e7 radius: the count caps at 2048.
        let mut b = PathBuilder::default();
        b.arc(0.0, 0.0, 1e7, 0.0, PI, false, IDENTITY)
            .unwrap();
        let pts = &flatten_path(&b.subpaths, 0.25)[0].pts;
        assert_eq!(pts.len(), 2 * (1 + 2048));
    }

    #[test]
    fn flatten_point_count_grows_as_tolerance_shrinks() {
        let point_count = |tol| {
            let mut b = PathBuilder::default();
            b.move_to(0.0, 0.0, IDENTITY);
            b.quadratic_curve_to(50.0, 100.0, 100.0, 0.0, IDENTITY);
            flatten_path(&b.subpaths, tol)[0].pts.len()
        };
        assert!(point_count(4.0) < point_count(0.5));
        assert!(point_count(0.5) < point_count(0.05));
    }
}
