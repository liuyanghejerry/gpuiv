//! Scanline rasterization with anti-aliasing for the 2D canvas.
//!
//! Verbatim port of `packages/vue/src/canvas/raster.ts`; the canvas WPT suite
//! pins the semantics.
//!
//! Coverage is accumulated per pixel over `SUBSCANLINES` evenly spaced
//! sub-scanlines per row; each sub-scanline computes exact horizontal spans
//! from the polygon edges, so horizontal coverage is exact and vertical
//! coverage converges like a browser's rasterizer. Winding is taken from
//! edge direction, which supports both the nonzero and even-odd fill rules
//! from one pass.
//!
//! The TS coverage buffer is a `Float32Array`; this port keeps full `f64`
//! precision in `data`, so accumulation differs from the TS by at most a
//! rounding step (~1e-7 per pixel) and never flips a boundary pixel.

use std::cmp::Ordering;

use super::path::Poly;

/// The two DOM fill rules — the TS string literals `"nonzero"` / `"evenodd"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FillRule {
    NonZero,
    EvenOdd,
}

/// Sub-scanlines per pixel row. 5 gives ~5% worst-case edge error, visually
/// smooth at UI sizes, at 1/5 the row cost of a real 5x supersample.
pub const SUBSCANLINES: usize = 5;

#[derive(Clone, Debug)]
pub struct CoverageBuffer {
    pub width: usize,
    pub height: usize,
    /// Per-pixel coverage in [0, 1], row-major.
    pub data: Vec<f64>,
}

/// Bounding box (inclusive pixel bounds) of the covered region. The values
/// are integer-valued but stay `f64` like the TS numbers, which can exceed
/// any integer range for far-off-bitmap geometry.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CoveredBBox {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

// JS `Math.min`/`Math.max` propagate NaN; Rust's `f64::min`/`f64::max` ignore
// it. Keep the JS behaviour so NaN coordinates poison the row/span bounds
// exactly like the TS module (a NaN bound makes the loops skip, never clamp).
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

struct Edge {
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    /// +1 when the edge points down the canvas (y increasing), else −1.
    dir: i32,
}

/// Collect the edges of closed polygons (fill semantics: every subpath is
/// implicitly closed). Horizontal and zero-length edges carry no winding.
fn collect_edges(polys: &[Poly], close_all: bool) -> Vec<Edge> {
    let mut edges: Vec<Edge> = Vec::new();
    for poly in polys {
        let pts = &poly.pts;
        let n = pts.len() / 2;
        if n < 2 {
            continue;
        }
        let limit = if close_all || poly.closed { n } else { n - 1 };
        for i in 0..limit {
            let j = if close_all || poly.closed {
                (i + 1) % n
            } else {
                i + 1
            };
            let x1 = pts[i * 2];
            let y1 = pts[i * 2 + 1];
            let x2 = pts[j * 2];
            let y2 = pts[j * 2 + 1];
            if y1 == y2 {
                continue;
            }
            edges.push(Edge {
                x1,
                y1,
                x2,
                y2,
                dir: if y2 > y1 { 1 } else { -1 },
            });
        }
    }
    edges
}

/// Rasterize polygons into `out.data`, adding to whatever is already there
/// (the caller clears the dirty region first). Returns the covered bounding
/// box, or `None` when nothing landed inside the buffer.
pub fn rasterize_coverage(
    polys: &[Poly],
    rule: FillRule,
    out: &mut CoverageBuffer,
) -> Option<CoveredBBox> {
    scan_coverage(polys, rule, out.width, out.height, Some(out))
}

/// Where `rasterize_coverage` would paint, **without touching a coverage
/// buffer**: same scanline walk and winding rules, no accumulation, no
/// zeroing. This is the record-time emptiness check for the display list —
/// an op that covers nothing records nothing, and asking that question must
/// not cost a full-buffer clear per recorded op.
pub fn coverage_bbox(
    polys: &[Poly],
    rule: FillRule,
    width: usize,
    height: usize,
) -> Option<CoveredBBox> {
    scan_coverage(polys, rule, width, height, None)
}

fn scan_coverage(
    polys: &[Poly],
    rule: FillRule,
    width: usize,
    height: usize,
    mut out: Option<&mut CoverageBuffer>,
) -> Option<CoveredBBox> {
    let edges = collect_edges(polys, true);
    if edges.is_empty() {
        return None;
    }

    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for edge in &edges {
        min_y = js_min(min_y, js_min(edge.y1, edge.y2));
        max_y = js_max(max_y, js_max(edge.y1, edge.y2));
    }
    let row_lo = js_max(0.0, min_y.floor());
    let row_hi = js_min(height as f64 - 1.0, max_y.ceil());
    if row_lo > row_hi {
        return None;
    }

    let mut crossings: Vec<(f64, i32)> = Vec::new();
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut covered = false;

    let mut row = row_lo;
    while row <= row_hi {
        for sub in 0..SUBSCANLINES {
            let ys = row + (sub as f64 + 0.5) / SUBSCANLINES as f64;
            crossings.clear();
            for edge in &edges {
                // Half-open span [min(y1,y2), max(y1,y2)) so shared vertices
                // count once.
                let top = if edge.y1 < edge.y2 {
                    edge.y1
                } else {
                    edge.y2
                };
                let bottom = if edge.y1 < edge.y2 {
                    edge.y2
                } else {
                    edge.y1
                };
                if ys < top || ys >= bottom {
                    continue;
                }
                let t = (ys - edge.y1) / (edge.y2 - edge.y1);
                crossings.push((edge.x1 + t * (edge.x2 - edge.x1), edge.dir));
            }
            if crossings.is_empty() {
                continue;
            }
            // JS `.sort((a, b) => a.x - b.x)`: a NaN difference compares as 0
            // and the sort is stable — `partial_cmp(..).unwrap_or(Equal)`
            // under stable `sort_by` reproduces both.
            crossings.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal));

            let mut winding = 0;
            let mut parity = 0;
            let mut span_start = 0.0;
            for i in 0..crossings.len() {
                let inside_before = if rule == FillRule::NonZero {
                    winding != 0
                } else {
                    parity == 1
                };
                winding += crossings[i].1;
                parity ^= 1;
                let inside_after = if rule == FillRule::NonZero {
                    winding != 0
                } else {
                    parity == 1
                };
                if !inside_before && inside_after {
                    span_start = crossings[i].0;
                } else if inside_before && !inside_after {
                    let span_end = crossings[i].0;
                    covered = true;
                    min_x = js_min(min_x, span_start);
                    max_x = js_max(max_x, span_end);
                    if let Some(out) = out.as_deref_mut() {
                        accumulate_span(out, row, span_start, span_end);
                    }
                }
            }
        }
        row += 1.0;
    }

    if !covered {
        return None;
    }
    Some(CoveredBBox {
        min_x: js_max(0.0, min_x.floor()),
        min_y: row_lo,
        max_x: js_min(width as f64 - 1.0, max_x.ceil() - 1.0),
        max_y: row_hi,
    })
}

/// Add 1/SUBSCANLINES coverage for the pixels a sub-scanline span touches.
fn accumulate_span(out: &mut CoverageBuffer, row: f64, x0: f64, x1: f64) {
    if x1 <= 0.0 || x0 >= out.width as f64 {
        return;
    }
    let clamped_x0 = js_max(x0, 0.0);
    let p0 = clamped_x0.floor();
    let p1 = js_min(out.width as f64 - 1.0, x1.ceil() - 1.0);
    // `row` comes from the caller's loop range, so it is an integer in
    // [0, height-1]; a NaN row can never reach this call.
    let base = row as usize * out.width;
    let mut p = p0;
    while p <= p1 {
        let left = js_max(clamped_x0, p);
        let right = js_min(x1, p + 1.0);
        let overlap = right - left;
        if overlap > 0.0 {
            let idx = base + p as usize;
            // A Float32Array out-of-bounds store is a silent no-op in TS;
            // bounds-check the same way instead of panicking on a buffer
            // whose `data` length disagrees with its dimensions.
            if idx < out.data.len() {
                out.data[idx] = js_min(1.0, out.data[idx] + overlap / SUBSCANLINES as f64);
            }
        }
        p += 1.0;
    }
}

/// Winding test for isPointInPath / isPointInStroke-style hit tests. The
/// point is in device space; the ray cast runs toward +x. Points exactly on
/// the boundary count as inside, matching the DOM.
pub fn point_in_polys(polys: &[Poly], x: f64, y: f64, rule: FillRule) -> bool {
    const EPS: f64 = 1e-7;
    // Boundary first: distance to every segment, including horizontal ones
    // the winding cast below skips. Overflowed coordinates (a path scaled by
    // Number.MAX_VALUE) clamp to a huge-but-finite bound so the containment
    // math still works; NaN segments and collapsed points have no extent.
    fn clean(v: f64) -> f64 {
        if v.is_nan() {
            f64::NAN
        } else if v == f64::INFINITY {
            1e60
        } else if v == f64::NEG_INFINITY {
            -1e60
        } else {
            v
        }
    }
    for poly in polys {
        let pts = &poly.pts;
        let n = pts.len() / 2;
        for i in 0..n {
            let j = (i + 1) % n;
            let x1 = clean(pts[i * 2]);
            let y1 = clean(pts[i * 2 + 1]);
            let x2 = clean(pts[j * 2]);
            let y2 = clean(pts[j * 2 + 1]);
            if x1.is_nan() || y1.is_nan() || x2.is_nan() || y2.is_nan() {
                continue;
            }
            let dx = x2 - x1;
            let dy = y2 - y1;
            let len2 = dx * dx + dy * dy;
            if len2 == 0.0 {
                continue;
            }
            let mut t = ((x - x1) * dx + (y - y1) * dy) / len2;
            t = if t < 0.0 {
                0.0
            } else if t > 1.0 {
                1.0
            } else {
                t
            };
            if (x - (x1 + t * dx)).hypot(y - (y1 + t * dy)) <= EPS {
                return true;
            }
        }
    }
    let edges = collect_edges(polys, true);
    let mut winding = 0;
    let mut parity = 0;
    for edge in &edges {
        let x1 = clean(edge.x1);
        let y1 = clean(edge.y1);
        let x2 = clean(edge.x2);
        let y2 = clean(edge.y2);
        if x1.is_nan() || y1.is_nan() || x2.is_nan() || y2.is_nan() {
            continue;
        }
        let top = if y1 < y2 { y1 } else { y2 };
        let bottom = if y1 < y2 { y2 } else { y1 };
        if y < top || y >= bottom {
            continue;
        }
        if y2 == y1 {
            continue;
        }
        let t = (y - y1) / (y2 - y1);
        let cx = x1 + t * (x2 - x1);
        if cx > x {
            winding += edge.dir;
            parity ^= 1;
        }
    }
    if rule == FillRule::NonZero {
        winding != 0
    } else {
        parity == 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn buffer(w: usize, h: usize) -> CoverageBuffer {
        CoverageBuffer {
            width: w,
            height: h,
            data: vec![0.0; w * h],
        }
    }

    fn rect_poly(x: f64, y: f64, w: f64, h: f64) -> Poly {
        Poly {
            pts: vec![x, y, x + w, y, x + w, y + h, x, y + h],
            closed: true,
        }
    }

    #[test]
    fn triangle_coverage_sums_to_its_area() {
        let polys = [Poly {
            pts: vec![0.0, 0.0, 10.0, 0.0, 0.0, 10.0],
            closed: true,
        }];
        let mut buf = buffer(12, 12);
        let bbox = rasterize_coverage(&polys, FillRule::NonZero, &mut buf).expect("covered");
        let sum: f64 = buf.data.iter().sum();
        assert!((sum - 50.0).abs() < 0.5, "coverage sum {sum}");
        // Spans reach x = 10 − ys, so the last covered pixel column is 9 and
        // the row range is clamped to ceil(10).
        assert_eq!(
            bbox,
            CoveredBBox {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 9.0,
                max_y: 10.0
            }
        );
    }

    #[test]
    fn nested_boxes_nonzero_vs_evenodd() {
        let polys = [rect_poly(0.0, 0.0, 10.0, 10.0), rect_poly(2.0, 2.0, 8.0, 8.0)];
        let mut buf = buffer(12, 12);
        rasterize_coverage(&polys, FillRule::NonZero, &mut buf).unwrap();
        // Doubly-wound centre stays covered; the ring is covered once. The
        // per-subscanline clamp to 1 makes the value exactly 1.0.
        assert_eq!(buf.data[5 * 12 + 5], 1.0);
        assert_eq!(buf.data[1 * 12 + 1], 1.0);
        let mut buf = buffer(12, 12);
        rasterize_coverage(&polys, FillRule::EvenOdd, &mut buf).unwrap();
        // Even-odd drops the doubly-wound centre: a hole.
        assert_eq!(buf.data[5 * 12 + 5], 0.0);
        assert_eq!(buf.data[1 * 12 + 1], 1.0);
    }

    #[test]
    fn empty_or_off_bitmap_geometry_covers_nothing() {
        let mut buf = buffer(4, 4);
        assert!(rasterize_coverage(&[], FillRule::NonZero, &mut buf).is_none());
        let far = [Poly {
            pts: vec![100.0, 100.0, 110.0, 100.0, 110.0, 110.0],
            closed: true,
        }];
        assert!(rasterize_coverage(&far, FillRule::NonZero, &mut buf).is_none());
    }

    #[test]
    fn point_in_polys_boundary_and_winding() {
        let polys = [rect_poly(0.0, 0.0, 10.0, 10.0), rect_poly(2.0, 2.0, 8.0, 8.0)];
        // Exactly on the boundary counts as inside, matching the DOM.
        assert!(point_in_polys(&polys, 5.0, 0.0, FillRule::NonZero));
        assert!(point_in_polys(&polys, 0.0, 5.0, FillRule::NonZero));
        assert!(point_in_polys(&polys, 5.0, 5.0, FillRule::NonZero));
        assert!(!point_in_polys(&polys, 15.0, 5.0, FillRule::NonZero));
        assert!(!point_in_polys(&polys, -1.0, 5.0, FillRule::NonZero));
        // Nested same-winding boxes: even-odd drops the doubly-wound centre.
        assert!(!point_in_polys(&polys, 5.0, 5.0, FillRule::EvenOdd));
        assert!(point_in_polys(&polys, 1.0, 5.0, FillRule::EvenOdd));
    }
}
