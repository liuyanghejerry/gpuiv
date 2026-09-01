//! Stroke geometry for the 2D canvas.
//!
//! Verbatim port of `packages/vue/src/canvas/stroke.ts`; the canvas WPT suite
//! pins the semantics.
//!
//! A stroke is converted to fill polygons in **user space** (so the CTM —
//! including non-uniform scale — shapes it exactly like the DOM), then
//! rasterized with the nonzero rule. Every outline is orientation-normalized
//! so overlapping pieces union instead of cancelling: segment quads, round
//! join discs, bevel/miter wedges, and caps all add winding of one sign.

use std::f64::consts::PI;

use super::path::Poly;

/// End cap style — the TS string literals `"butt"` / `"round"` / `"square"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StrokeCap {
    Butt,
    Round,
    Square,
}

/// Join style — the TS string literals `"round"` / `"bevel"` / `"miter"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StrokeJoin {
    Round,
    Bevel,
    Miter,
}

#[derive(Clone, Debug)]
pub struct StrokeParams {
    pub line_width: f64,
    pub line_cap: StrokeCap,
    pub line_join: StrokeJoin,
    pub miter_limit: f64,
    /// Normalized dash pattern (even length, non-negative, total > 0) or [].
    pub line_dash: Vec<f64>,
    pub line_dash_offset: f64,
}

// JS `Math.min`/`Math.max` propagate NaN; Rust's `f64::min`/`f64::max` ignore
// it. Keep the JS behaviour so degenerate NaN geometry resolves exactly like
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

/// Signed area; > 0 is counter-clockwise in math convention.
fn signed_area(pts: &[f64]) -> f64 {
    let n = pts.len() / 2;
    let mut area = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
    }
    area / 2.0
}

/// Push a polygon normalized to negative orientation (clockwise in math
/// convention), the one sign every stroke outline shares.
fn push_oriented(out: &mut Vec<Poly>, pts: Vec<f64>, closed: bool) {
    if pts.len() < 6 {
        return;
    }
    if signed_area(&pts) > 0.0 {
        let mut reversed: Vec<f64> = Vec::with_capacity(pts.len());
        let mut i = pts.len() as i64 / 2 - 1;
        while i >= 0 {
            reversed.push(pts[(i * 2) as usize]);
            reversed.push(pts[(i * 2 + 1) as usize]);
            i -= 1;
        }
        out.push(Poly {
            pts: reversed,
            closed,
        });
    } else {
        out.push(Poly { pts, closed });
    }
}

/// A full disc as a polygon, for round joins and round caps.
fn push_circle(out: &mut Vec<Poly>, cx: f64, cy: f64, r: f64) {
    if r <= 0.0 {
        return;
    }
    // Segment count from a 0.1px chord tolerance, clamped to sane bounds.
    let ratio = js_min(1.0, js_max(-1.0, 1.0 - 0.1 / r));
    let step = 2.0 * ratio.acos();
    let n = js_min(
        128.0,
        js_max(
            8.0,
            (PI * 2.0 / (if step > 1e-6 { step } else { PI / 2.0 })).ceil(),
        ),
    );
    let mut pts: Vec<f64> = Vec::new();
    let mut i = 0.0;
    while i < n {
        let theta = (i / n) * PI * 2.0;
        pts.push(cx + r * theta.cos());
        pts.push(cy + r * theta.sin());
        i += 1.0;
    }
    push_oriented(out, pts, true);
}

/// Unit direction of the i→j vertex pair, or `None` when the points coincide.
fn unit_between(pts: &[f64], i: i64, j: i64) -> Option<(f64, f64)> {
    let dx = pts[(j * 2) as usize] - pts[(i * 2) as usize];
    let dy = pts[(j * 2 + 1) as usize] - pts[(i * 2 + 1) as usize];
    let len = dx.hypot(dy);
    if len < 1e-12 {
        return None;
    }
    Some((dx / len, dy / len))
}

/// Build the stroke outline polygons for a flattened user-space path.
pub fn build_stroke_geometry(polys: &[Poly], params: &StrokeParams) -> Vec<Poly> {
    let mut out: Vec<Poly> = Vec::new();
    let h = params.line_width / 2.0;
    if !(h > 0.0) {
        return out;
    }

    let dashed = !params.line_dash.is_empty();
    for poly in polys {
        let pieces = if dashed {
            dash_polyline(poly, &params.line_dash, params.line_dash_offset)
        } else {
            vec![poly.clone()]
        };
        for piece in &pieces {
            stroke_piece(&piece.pts, piece.closed, params, h, &mut out);
        }
    }
    out
}

/// Stroke one polyline (open or cyclic) into orientation-normalized fills.
fn stroke_piece(
    pts: &[f64],
    closed: bool,
    params: &StrokeParams,
    h: f64,
    out: &mut Vec<Poly>,
) {
    let n = pts.len() / 2;
    if n == 0 {
        return;
    }
    if n == 1 || all_coincident(pts) {
        // Zero-length subpaths are pruned before stroking — the DOM draws
        // nothing at all, not even a round-cap dot.
        return;
    }

    let n_i = n as i64;
    let seg_count = if closed { n_i } else { n_i - 1 };
    let at = |i: i64| ((i % n_i) + n_i) % n_i;

    for i in 0..seg_count {
        let a = at(i);
        let b = at(i + 1);
        let Some((ux, uy)) = unit_between(pts, a, b) else {
            continue;
        };
        let nx = -uy;
        let ny = ux;
        let ax = pts[(a * 2) as usize];
        let ay = pts[(a * 2 + 1) as usize];
        let bx = pts[(b * 2) as usize];
        let by = pts[(b * 2 + 1) as usize];
        // The quad is emitted as two same-orientation triangles: when the
        // stroke is wider than twice the local curvature radius the inner
        // offsets cross and the quad twists, and a self-intersecting quad
        // cancels its own winding under nonzero fill. Triangles never
        // self-intersect, and overlapping positive pieces add coverage
        // without seams.
        let a1x = ax + nx * h;
        let a1y = ay + ny * h;
        let b1x = bx + nx * h;
        let b1y = by + ny * h;
        let a2x = ax - nx * h;
        let a2y = ay - ny * h;
        let b2x = bx - nx * h;
        let b2y = by - ny * h;
        push_oriented(out, vec![a1x, a1y, b1x, b1y, b2x, b2y], true);
        push_oriented(out, vec![a1x, a1y, b2x, b2y, a2x, a2y], true);
    }

    // Joints: every vertex of a closed loop, interior vertices of an open one.
    // Duplicate vertices (roundRect ends with an explicit closing lineTo) must
    // not swallow the join, so edge directions skip coincident neighbours.
    let direction_through = |i: i64, forward: bool| -> Option<(f64, f64)> {
        let px = pts[(i * 2) as usize];
        let py = pts[(i * 2 + 1) as usize];
        for step in 1..=n_i {
            let j = at(if forward { i + step } else { i - step });
            let dx = pts[(j * 2) as usize] - px;
            let dy = pts[(j * 2 + 1) as usize] - py;
            let len = dx.hypot(dy);
            if len > 1e-12 {
                let ux = dx / len;
                let uy = dy / len;
                return Some(if forward { (ux, uy) } else { (-ux, -uy) });
            }
        }
        None
    };
    let joint_from = if closed { 0 } else { 1 };
    let joint_to = if closed { n_i - 1 } else { n_i - 2 };
    let mut i = joint_from;
    while i <= joint_to {
        let here = at(i);
        let u1 = direction_through(here, false);
        let u2 = direction_through(here, true);
        if let (Some(u1), Some(u2)) = (u1, u2) {
            stroke_joint(
                pts[(here * 2) as usize],
                pts[(here * 2 + 1) as usize],
                u1,
                u2,
                params,
                h,
                out,
            );
        }
        i += 1;
    }

    if !closed {
        let first = direction_through(0, true);
        let last = direction_through(n_i - 1, false);
        if let Some((ux, uy)) = first {
            stroke_cap(pts[0], pts[1], (ux, uy), params.line_cap, h, out, true);
        }
        if let Some((ux, uy)) = last {
            stroke_cap(
                pts[((n_i - 1) * 2) as usize],
                pts[((n_i - 1) * 2 + 1) as usize],
                (ux, uy),
                params.line_cap,
                h,
                out,
                false,
            );
        }
    }
}

fn all_coincident(pts: &[f64]) -> bool {
    let mut i = 2;
    while i < pts.len() {
        if (pts[i] - pts[0]).hypot(pts[i + 1] - pts[1]) > 1e-9 {
            return false;
        }
        i += 2;
    }
    true
}

/// Outer-side join geometry at vertex v between incoming u1 and outgoing u2.
fn stroke_joint(
    vx: f64,
    vy: f64,
    u1: (f64, f64),
    u2: (f64, f64),
    params: &StrokeParams,
    h: f64,
    out: &mut Vec<Poly>,
) {
    let cross = u1.0 * u2.1 - u1.1 * u2.0;
    let dot = u1.0 * u2.0 + u1.1 * u2.1;
    if cross.abs() < 1e-9 {
        // Exact reversal: only a round join leaves anything (a disk); miter
        // and bevel degenerate to nothing at the coincident butt ends.
        if dot < 0.0 && params.line_join == StrokeJoin::Round {
            push_circle(out, vx, vy, h);
        }
        return;
    }
    let side = if cross > 0.0 { -1.0 } else { 1.0 };
    let o1x = vx + side * -u1.1 * h;
    let o1y = vy + side * u1.0 * h;
    let o2x = vx + side * -u2.1 * h;
    let o2y = vy + side * u2.0 * h;

    if params.line_join == StrokeJoin::Round {
        push_circle(out, vx, vy, h);
        return;
    }
    // The bevel wedge between the two butt ends; the miter tip extends it.
    push_oriented(out, vec![o1x, o1y, o2x, o2y, vx, vy], true);
    if params.line_join == StrokeJoin::Miter {
        let sin_half = js_max(0.0, (1.0 + dot) / 2.0).sqrt();
        if 1.0 / sin_half <= params.miter_limit && sin_half > 1e-9 {
            // Intersect the two outer offset lines: o1 + t·u1 = o2 + s·u2.
            let wx = o2x - o1x;
            let wy = o2y - o1y;
            let denom = u1.0 * u2.1 - u1.1 * u2.0;
            let t = (wx * u2.1 - wy * u2.0) / denom;
            let mx = o1x + t * u1.0;
            let my = o1y + t * u1.1;
            push_oriented(out, vec![o1x, o1y, mx, my, o2x, o2y], true);
        }
    }
}

/// End cap at v; u points away from the polyline's interior.
fn stroke_cap(
    vx: f64,
    vy: f64,
    u: (f64, f64),
    cap: StrokeCap,
    h: f64,
    out: &mut Vec<Poly>,
    is_start: bool,
) {
    if cap == StrokeCap::Butt {
        return;
    }
    if cap == StrokeCap::Round {
        push_circle(out, vx, vy, h);
        return;
    }
    // square: extend half a line width beyond the end point.
    let dir = if is_start {
        (-u.0, -u.1)
    } else {
        (u.0, u.1)
    };
    let nx = -u.1;
    let ny = u.0;
    push_oriented(
        out,
        vec![
            vx + nx * h,
            vy + ny * h,
            vx + dir.0 * h + nx * h,
            vy + dir.1 * h + ny * h,
            vx + dir.0 * h - nx * h,
            vy + dir.1 * h - ny * h,
            vx - nx * h,
            vy - ny * h,
        ],
        true,
    );
}

/// Split a polyline into dash pieces. Closed loops dash the wrap segment too.
///
/// State is `{index, pos}` — how far into `pattern[index]` the walk is. A
/// dash piece starts lazily at the current walk position on its first push,
/// and closes whenever the pattern switches to a gap. Zero-length entries
/// advance without stepping, so `[5, 0]` renders solid.
fn dash_polyline(poly: &Poly, pattern: &[f64], offset: f64) -> Vec<Poly> {
    let total = pattern.iter().fold(0.0, |sum, v| sum + v);
    if !(total > 0.0) {
        return vec![poly.clone()];
    }

    let mut phase = offset % total;
    if phase < 0.0 {
        phase += total;
    }
    let mut index = 0usize;
    let mut pos = phase;
    while pos >= pattern[index] - 1e-9 {
        pos -= pattern[index];
        index = (index + 1) % pattern.len();
    }
    // TS keeps `isOn = () => index % 2 === 0` as a closure over the mutable
    // `index`; Rust cannot borrow it that way, so the check is inlined at
    // each call site below.
    fn is_on(index: usize) -> bool {
        index % 2 == 0
    }

    let pts = &poly.pts;
    let n = pts.len() as i64 / 2;
    let mut pieces: Vec<Poly> = Vec::new();
    let mut current: Option<Vec<f64>> = None;

    let seg_count = if poly.closed { n } else { n - 1 };
    for i in 0..seg_count {
        let j = if poly.closed {
            (i + 1) % n
        } else {
            i + 1
        };
        let ax = pts[(i * 2) as usize];
        let ay = pts[(i * 2 + 1) as usize];
        let bx = pts[(j * 2) as usize];
        let by = pts[(j * 2 + 1) as usize];
        let len = (bx - ax).hypot(by - ay);
        if len < 1e-12 {
            continue;
        }
        let dx = (bx - ax) / len;
        let dy = (by - ay) / len;

        let mut walked = 0.0;
        while walked < len - 1e-9 {
            if pattern[index] - pos <= 1e-9 {
                // Zero-length entry: advance the pattern without moving.
                pos = 0.0;
                index = (index + 1) % pattern.len();
                if !is_on(index) {
                    if let Some(cur) = current.take() {
                        pieces.push(Poly {
                            pts: cur,
                            closed: false,
                        });
                    }
                }
                continue;
            }
            let step = js_min(pattern[index] - pos, len - walked);
            if is_on(index) {
                if current.is_none() {
                    current = Some(vec![ax + dx * walked, ay + dy * walked]);
                }
                if let Some(cur) = current.as_mut() {
                    cur.push(ax + dx * (walked + step));
                    cur.push(ay + dy * (walked + step));
                }
            }
            walked += step;
            pos += step;
            if pattern[index] - pos <= 1e-9 {
                pos = 0.0;
                index = (index + 1) % pattern.len();
                if !is_on(index) {
                    if let Some(cur) = current.take() {
                        pieces.push(Poly {
                            pts: cur,
                            closed: false,
                        });
                    }
                }
            }
        }
    }
    if let Some(cur) = current {
        if cur.len() >= 2 {
            pieces.push(Poly {
                pts: cur,
                closed: false,
            });
        }
    }
    pieces
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canvas2d::geom::raster::{point_in_polys, FillRule};

    fn params(cap: StrokeCap, join: StrokeJoin, miter_limit: f64) -> StrokeParams {
        StrokeParams {
            line_width: 2.0,
            line_cap: cap,
            line_join: join,
            miter_limit,
            line_dash: Vec::new(),
            line_dash_offset: 0.0,
        }
    }

    fn line(x0: f64, y0: f64, x1: f64, y1: f64) -> Poly {
        Poly {
            pts: vec![x0, y0, x1, y1],
            closed: false,
        }
    }

    fn covered(polys: &[Poly], x: f64, y: f64) -> bool {
        point_in_polys(polys, x, y, FillRule::NonZero)
    }

    #[test]
    fn butt_round_square_caps_differ_at_the_endpoints() {
        // A 10-long horizontal line with half-width 1: butt stops at x=10,
        // square extends to x=11 across the full band, round adds the disc.
        let butt = build_stroke_geometry(
            &[line(0.0, 0.0, 10.0, 0.0)],
            &params(StrokeCap::Butt, StrokeJoin::Miter, 10.0),
        );
        let round = build_stroke_geometry(
            &[line(0.0, 0.0, 10.0, 0.0)],
            &params(StrokeCap::Round, StrokeJoin::Miter, 10.0),
        );
        let square = build_stroke_geometry(
            &[line(0.0, 0.0, 10.0, 0.0)],
            &params(StrokeCap::Square, StrokeJoin::Miter, 10.0),
        );

        // On the axis past the endpoint.
        assert!(!covered(&butt, 10.5, 0.0));
        assert!(covered(&round, 10.5, 0.0));
        assert!(covered(&square, 10.5, 0.0));
        // Square fills the whole half-width band; round clips to the disc
        // (distance √(0.8² + 0.8²) > 1).
        assert!(covered(&square, 10.8, 0.8));
        assert!(!covered(&round, 10.8, 0.8));
        assert!(!covered(&butt, 10.8, 0.8));
        // Mid-stroke is covered by the segment quad for every cap.
        assert!(covered(&butt, 9.5, 0.0));
    }

    #[test]
    fn miter_over_the_limit_falls_back_to_the_bevel_wedge() {
        // 90° turn, half-width 1: 1/sin(45°) ≈ 1.414, so a limit of 1.4
        // bevels and 2.0 keeps the miter tip. The corner region below the
        // bevel diagonal ([10,11]×[-1,0] under y = x − 11) is miter-only.
        let corner = [Poly {
            pts: vec![0.0, 0.0, 10.0, 0.0, 10.0, 10.0],
            closed: false,
        }];
        let bevel = build_stroke_geometry(
            &corner,
            &params(StrokeCap::Butt, StrokeJoin::Bevel, 10.0),
        );
        let low = build_stroke_geometry(
            &corner,
            &params(StrokeCap::Butt, StrokeJoin::Miter, 1.4),
        );
        let high = build_stroke_geometry(
            &corner,
            &params(StrokeCap::Butt, StrokeJoin::Miter, 2.0),
        );

        assert!(!covered(&bevel, 10.9, -0.9));
        assert!(!covered(&low, 10.9, -0.9));
        assert!(covered(&high, 10.9, -0.9));
        // The bevel wedge itself still covers the corner above the diagonal.
        assert!(covered(&bevel, 10.4, -0.4));
    }

    #[test]
    fn exact_reversal_keeps_only_a_round_join() {
        // A vertex where the path doubles back: bevel/miter degenerate to
        // nothing, round leaves the disc at the reversal point.
        let reversal = [Poly {
            pts: vec![0.0, 0.0, 10.0, 0.0, 0.0, 0.0],
            closed: false,
        }];
        let round = build_stroke_geometry(
            &reversal,
            &params(StrokeCap::Butt, StrokeJoin::Round, 10.0),
        );
        let miter = build_stroke_geometry(
            &reversal,
            &params(StrokeCap::Butt, StrokeJoin::Miter, 100.0),
        );
        assert!(covered(&round, 10.9, 0.0));
        assert!(!covered(&miter, 10.9, 0.0));
    }

    #[test]
    fn dash_pattern_splits_the_outline_into_pieces() {
        let poly = line(0.0, 0.0, 10.0, 0.0);
        // No dash: one segment quad = two same-orientation triangles.
        let solid = build_stroke_geometry(
            &[poly.clone()],
            &params(StrokeCap::Butt, StrokeJoin::Miter, 10.0),
        );
        assert_eq!(solid.len(), 2);

        let mut p = params(StrokeCap::Butt, StrokeJoin::Miter, 10.0);
        // [2,2] over length 10 → dashes [0,2], [4,6], [8,10] → 3 pieces.
        p.line_dash = vec![2.0, 2.0];
        let dashed = build_stroke_geometry(&[poly.clone()], &p);
        assert_eq!(dashed.len(), 6);
        // Offset 1 starts 1 unit into the first dash: pattern space runs
        // dash 1→2, gap 2→4, dash 4→6, gap 6→8, dash 8→10 — pieces [0,1],
        // [3,5], [7,9] → 3 pieces.
        p.line_dash_offset = 1.0;
        let shifted = build_stroke_geometry(&[poly.clone()], &p);
        assert_eq!(shifted.len(), 6);
        // A zero-length gap advances the pattern without stepping, so [2,0]
        // renders solid: 5 touching pieces over length 10.
        p.line_dash = vec![2.0, 0.0];
        p.line_dash_offset = 0.0;
        let gapless = build_stroke_geometry(&[poly], &p);
        assert_eq!(gapless.len(), 10);
    }
}
