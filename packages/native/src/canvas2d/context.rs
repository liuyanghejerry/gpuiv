//! Canvas 2D context core: the drawing state machine, a recorded display
//! list, and lazy rasterization into a premultiplied RGBA buffer.
//!
//! Ported 1:1 from `packages/vue/src/canvas/context2d.ts` (plus the
//! evaluation half of `gradient.ts`); the WPT suite in
//! `packages/vue/src/__tests__/canvas-wpt.test.ts` pins the semantics, so
//! every threshold, early return, and store-rounding rule here mirrors the
//! TypeScript exactly. The TS layer keeps the WebIDL surface — argument
//! conversion, style parsing, getter serialization, exception mapping — and
//! forwards normalized values to this class.
//!
//! Drawing is recorded, not rasterized: each mutating call appends one op
//! (with a snapshot of the state it must draw under) and marks the context
//! dirty. `materialize` replays the list once — on upload or on a pixel
//! read — which is strictly the same per-op composite work the eager TS
//! rasterizer did, minus the repeated intermediate passes.
//!
//! Store semantics matter: the TS buffer is a `Uint8ClampedArray`, whose
//! writes clamp to 0–255 and round **half to even** (`ToUint8Clamp`). Every
//! premul write goes through [`to_u8_clamp`] to reproduce that exactly;
//! `Math.round` in `unpremultiply` is round-half-away-from-zero for the
//! non-negative values it sees, which `f64::round` matches.

use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::*;
use napi_derive::napi;

use super::geom::matrix::{
    apply_matrix, identity_matrix, invert_matrix, max_scale_of, multiply_matrix, rotation_matrix,
    scaling_matrix, translation_matrix, Matrix2D,
};
use super::geom::path::{flatten_path, PathBuilder, Poly};
use super::geom::raster::{coverage_bbox, point_in_polys, rasterize_coverage, CoverageBuffer, FillRule};
use super::geom::stroke::{build_stroke_geometry, StrokeCap, StrokeJoin, StrokeParams};

/// Every composite mode the DOM accepts; the separable/non-separable blend
/// names are accepted by the TS facade but rasterize as `source-over`, so
/// they collapse here. Parsed from the validated JS string.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Composite {
    SourceOver,
    SourceIn,
    SourceOut,
    SourceAtop,
    DestinationOver,
    DestinationIn,
    DestinationOut,
    DestinationAtop,
    Lighter,
    Copy,
    Xor,
    Clear,
}

impl Composite {
    fn parse(value: &str) -> Composite {
        match value {
            "source-in" => Composite::SourceIn,
            "source-out" => Composite::SourceOut,
            "source-atop" => Composite::SourceAtop,
            "destination-over" => Composite::DestinationOver,
            "destination-in" => Composite::DestinationIn,
            "destination-out" => Composite::DestinationOut,
            "destination-atop" => Composite::DestinationAtop,
            "lighter" => Composite::Lighter,
            "copy" => Composite::Copy,
            "xor" => Composite::Xor,
            "clear" => Composite::Clear,
            // "source-over" and every blend-mode name — the TS facade only
            // forwards validated DOM names; anything else degrades to the
            // default composite instead of failing the draw.
            _ => Composite::SourceOver,
        }
    }
}

/// One gradient color stop, straight RGBA — `r`/`g`/`b` in 0–255, `a` in
/// 0–1, matching the parsed `RgbaColor` the TS color module produces.
#[derive(Clone, Copy, Debug)]
struct GradStop {
    offset: f64,
    r: f64,
    g: f64,
    b: f64,
    a: f64,
}

/// A linear or radial gradient, the wire form of `GpuixCanvasGradient`.
/// Coordinates are user-space; evaluation maps device pixels back through
/// the draw-time CTM (see `evaluate_device`).
#[derive(Clone, Debug)]
struct GradientDesc {
    /// `true` = radial (two circles), `false` = linear (axis).
    radial: bool,
    x0: f64,
    y0: f64,
    r0: f64,
    x1: f64,
    y1: f64,
    r1: f64,
    stops: Vec<GradStop>,
}

impl GradientDesc {
    /// Degenerate gradients paint nothing at all (spec): a zero-length
    /// linear axis, or a radial gradient whose two circles are identical.
    fn empty(&self) -> bool {
        if self.radial {
            self.x0 == self.x1 && self.y0 == self.y1 && self.r0 == self.r1
        } else {
            self.x0 == self.x1 && self.y0 == self.y1
        }
    }

    /// Evaluate at a **device space** pixel centre, mapping back through the
    /// draw-time matrix first. `None` means "outside the gradient's reach" —
    /// the radial family never paints this point, so the destination is left
    /// alone. Ported verbatim from `gradient.ts`.
    fn evaluate_device(&self, x: f64, y: f64, m: &Matrix2D) -> Option<(f64, f64, f64, f64)> {
        let inv = match invert_matrix(m) {
            Some(inv) => inv,
            // Degenerate transform: nothing user-space survives; the first
            // stop colour is as good a fallback as any.
            None => return Some(self.color_at(0.0)),
        };
        let (ux, uy) = apply_matrix(&inv, x, y);
        match self.parameter_at(ux, uy) {
            Some(t) => Some(self.color_at(t)),
            None => None,
        }
    }

    /// Piecewise colour lookup; before the first stop and after the last the
    /// end colours hold, which is how the DOM ramps a gradient.
    fn color_at(&self, t: f64) -> (f64, f64, f64, f64) {
        let stops = &self.stops;
        if stops.is_empty() {
            return (0.0, 0.0, 0.0, 0.0);
        }
        if t <= stops[0].offset {
            return (stops[0].r, stops[0].g, stops[0].b, stops[0].a);
        }
        let last = stops[stops.len() - 1];
        if t >= last.offset {
            return (last.r, last.g, last.b, last.a);
        }
        for i in 0..stops.len() - 1 {
            let from = stops[i];
            let to = stops[i + 1];
            if t >= from.offset && t <= to.offset {
                let span = to.offset - from.offset;
                let local = if span == 0.0 { 0.0 } else { (t - from.offset) / span };
                return (
                    from.r + (to.r - from.r) * local,
                    from.g + (to.g - from.g) * local,
                    from.b + (to.b - from.b) * local,
                    from.a + (to.a - from.a) * local,
                );
            }
        }
        (last.r, last.g, last.b, last.a)
    }

    /// The gradient parameter at a user-space point: projection on the axis
    /// for linear, the circle-family root for radial. `None` means the point
    /// is never painted by this gradient.
    fn parameter_at(&self, x: f64, y: f64) -> Option<f64> {
        if !self.radial {
            let dx = self.x1 - self.x0;
            let dy = self.y1 - self.y0;
            let denom = dx * dx + dy * dy;
            if denom == 0.0 {
                return Some(0.0);
            }
            return Some(((x - self.x0) * dx + (y - self.y0) * dy) / denom);
        }
        self.radial_parameter(x, y)
    }

    /// Radial: the spec's circle family c(ω) = (c0 + ω·d, r0 + ω·dr) is
    /// painted from ω nearest +∞ downward and earlier circles win, so a
    /// point takes the colour at the LARGEST root of |p − c(ω)| = r(ω) —
    /// provided that circle has a positive radius; circles with r(ω) ≤ 0 are
    /// never painted, and a point with no valid root is left untouched.
    fn radial_parameter(&self, x: f64, y: f64) -> Option<f64> {
        let dx = self.x1 - self.x0;
        let dy = self.y1 - self.y0;
        let dr = self.r1 - self.r0;
        let fx = x - self.x0;
        let fy = y - self.y0;

        let valid = |t: f64| (self.r0 + t * dr) > 1e-9;

        let a = dx * dx + dy * dy - dr * dr;
        let b = -(dx * fx + dy * fy + self.r0 * dr);
        let c = fx * fx + fy * fy - self.r0 * self.r0;

        if a.abs() < 1e-12 {
            // Linear boundary: the family is a set of concentric circles
            // (|d| = |dr|).
            if b.abs() < 1e-12 {
                return if c < 0.0 { Some(0.0) } else { None };
            }
            let t = -c / (2.0 * b);
            return if valid(t) { Some(t) } else { None };
        }

        let disc = b * b - a * c;
        if disc < 0.0 {
            return None;
        }
        let root = disc.sqrt();
        let t0 = (-b - root) / a;
        let t1 = (-b + root) / a;
        let hi = t0.max(t1);
        if valid(hi) {
            return Some(hi);
        }
        let lo = t0.min(t1);
        if valid(lo) {
            return Some(lo);
        }
        None
    }
}

/// What a recorded draw paints with: a parsed solid colour, or a gradient.
/// The string form of `fillStyle`/`strokeStyle` never crosses the bridge —
/// the TS facade owns parsing and getter serialization.
#[derive(Clone, Debug)]
enum Paint {
    Solid { r: f64, g: f64, b: f64, a: f64 },
    Gradient(GradientDesc),
}

/// JS `Uint8ClampedArray` store semantics (`ToUint8Clamp`): NaN → 0, clamp
/// to 0–255, then round — with exact halves going to the **even** neighbour,
/// which is *not* what `f64::round` does.
fn to_u8_clamp(v: f64) -> u8 {
    if v.is_nan() {
        return 0;
    }
    let c = v.clamp(0.0, 255.0);
    let f = c.floor();
    if c - f == 0.5 {
        let fi = f as i64;
        if fi % 2 == 0 {
            fi as u8
        } else {
            (fi + 1) as u8
        }
    } else {
        c.round() as u8
    }
}

/// Un-premultiply one channel: `min(255, round(p * 255 / a))`. All inputs
/// are non-negative, so `f64::round` matches JS `Math.round`.
fn unpremultiply(p: f64, a: f64) -> u8 {
    ((p * 255.0 / a).round()).min(255.0) as u8
}

/// The per-op drawing state the TS `DrawingState` keeps, minus the string
/// styles (those live in the facade). `clip` is an immutable snapshot —
/// `clip()` always builds a fresh mask, so ops and the save/restore stack
/// can share one `Arc` exactly like the TS shares the array reference.
#[derive(Clone, Debug)]
struct DrawingState {
    m: Matrix2D,
    clip: Option<Arc<Vec<f64>>>,
    fill: Paint,
    stroke: Paint,
    global_alpha: f64,
    line_width: f64,
    line_cap: StrokeCap,
    line_join: StrokeJoin,
    miter_limit: f64,
    line_dash: Vec<f64>,
    line_dash_offset: f64,
    composite: Composite,
    image_smoothing_enabled: bool,
}

impl Default for DrawingState {
    fn default() -> Self {
        DrawingState {
            m: identity_matrix(),
            clip: None,
            fill: Paint::Solid { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            stroke: Paint::Solid { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            global_alpha: 1.0,
            line_width: 1.0,
            line_cap: StrokeCap::Butt,
            line_join: StrokeJoin::Miter,
            miter_limit: 10.0,
            line_dash: Vec::new(),
            line_dash_offset: 0.0,
            composite: Composite::SourceOver,
            image_smoothing_enabled: true,
        }
    }
}

/// A copied source-rect region of another context's premultiplied buffer,
/// clipped to its bounds. Sampling works in rect-local coordinates with the
/// `ox`/`oy` offset the clipping produced.
#[derive(Debug)]
struct SourceSnapshot {
    data: Vec<u8>,
    width: i64,
    height: i64,
    ox: f64,
    oy: f64,
}

impl SourceSnapshot {
    fn unpremul_pixel(&self, i: usize) -> (f64, f64, f64, f64) {
        let a = self.data[i + 3];
        if a == 0 {
            return (0.0, 0.0, 0.0, 0.0);
        }
        let af = a as f64;
        (
            unpremultiply(self.data[i] as f64, af) as f64,
            unpremultiply(self.data[i + 1] as f64, af) as f64,
            unpremultiply(self.data[i + 2] as f64, af) as f64,
            af,
        )
    }

    fn nearest(&self, u: f64, v: f64) -> (f64, f64, f64, f64) {
        let px = (u + self.ox).floor() as i64;
        let py = (v + self.oy).floor() as i64;
        if px < 0 || py < 0 || px >= self.width || py >= self.height {
            return (0.0, 0.0, 0.0, 0.0);
        }
        self.unpremul_pixel(((py * self.width + px) * 4) as usize)
    }

    fn bilinear(&self, u: f64, v: f64) -> (f64, f64, f64, f64) {
        let fx = u + self.ox - 0.5;
        let fy = v + self.oy - 0.5;
        let x0 = fx.floor() as i64;
        let y0 = fy.floor() as i64;
        let tx = fx - x0 as f64;
        let ty = fy - y0 as f64;
        // Blend in premultiplied space (translucent edges stay symmetric),
        // then un-premultiply once at the end.
        let corner = |px: i64, py: i64| -> (f64, f64, f64, f64) {
            if px < 0 || py < 0 || px >= self.width || py >= self.height {
                (0.0, 0.0, 0.0, 0.0)
            } else {
                let i = ((py * self.width + px) * 4) as usize;
                (
                    self.data[i] as f64,
                    self.data[i + 1] as f64,
                    self.data[i + 2] as f64,
                    self.data[i + 3] as f64,
                )
            }
        };
        let blend = |a: (f64, f64, f64, f64), b: (f64, f64, f64, f64), t: f64| -> (f64, f64, f64, f64) {
            (
                a.0 + (b.0 - a.0) * t,
                a.1 + (b.1 - a.1) * t,
                a.2 + (b.2 - a.2) * t,
                a.3 + (b.3 - a.3) * t,
            )
        };
        let top = blend(corner(x0, y0), corner(x0 + 1, y0), tx);
        let bottom = blend(corner(x0, y0 + 1), corner(x0 + 1, y0 + 1), tx);
        let blended = blend(top, bottom, ty);
        if blended.3 <= 0.0 {
            return (0.0, 0.0, 0.0, 0.0);
        }
        (
            unpremultiply(blended.0, blended.3) as f64,
            unpremultiply(blended.1, blended.3) as f64,
            unpremultiply(blended.2, blended.3) as f64,
            blended.3,
        )
    }
}

/// One recorded drawing command, carrying everything it must draw under.
/// `Paint`/`ClearRect`/`DrawImage` snapshot the clip so a later `clip()` or
/// `restore()` cannot rewrite history.
enum Op {
    Paint {
        polys: Vec<Poly>,
        rule: FillRule,
        paint: Paint,
        alpha: f64,
        composite: Composite,
        clip: Option<Arc<Vec<f64>>>,
        /// Draw-time CTM — gradients evaluate in user space through it.
        m: Matrix2D,
    },
    ClearRect {
        polys: Vec<Poly>,
        clip: Option<Arc<Vec<f64>>>,
    },
    DrawImage {
        snap: SourceSnapshot,
        quad: Vec<Poly>,
        inv: Matrix2D,
        src_x: f64,
        src_y: f64,
        src_w: f64,
        src_h: f64,
        dst_x: f64,
        dst_y: f64,
        dst_w: f64,
        dst_h: f64,
        smoothing: bool,
        alpha: f64,
        composite: Composite,
        clip: Option<Arc<Vec<f64>>>,
    },
    PutImage {
        /// Straight RGBA of the full source `ImageData`, row-major.
        data: Vec<u8>,
        img_w: i64,
        img_h: i64,
        dx: i64,
        dy: i64,
        x0: i64,
        y0: i64,
        x1: i64,
        y1: i64,
    },
}

fn parse_fill_rule(rule: &str) -> FillRule {
    if rule == "evenodd" {
        FillRule::EvenOdd
    } else {
        FillRule::NonZero
    }
}

fn transform_poly(poly: &Poly, m: &Matrix2D) -> Poly {
    let mut pts = vec![0.0; poly.pts.len()];
    let mut i = 0;
    while i < poly.pts.len() {
        let (x, y) = apply_matrix(m, poly.pts[i], poly.pts[i + 1]);
        pts[i] = x;
        pts[i + 1] = y;
        i += 2;
    }
    Poly { pts, closed: poly.closed }
}

/// The non-napi core: everything the drawing state and display list need.
struct ContextCore {
    width: usize,
    height: usize,
    premul: Vec<u8>,
    cover: CoverageBuffer,
    state: DrawingState,
    stack: Vec<DrawingState>,
    path: PathBuilder,
    ops: Vec<Op>,
    dirty: bool,
}

impl ContextCore {
    fn new(width: f64, height: f64) -> Self {
        let (w, h) = buffer_dimensions(width, height);
        ContextCore {
            width: w,
            height: h,
            premul: vec![0; w * h * 4],
            cover: CoverageBuffer { width: w, height: h, data: vec![0.0; w * h] },
            state: DrawingState::default(),
            stack: Vec::new(),
            path: PathBuilder::default(),
            ops: Vec::new(),
            dirty: false,
        }
    }

    /// A new buffer size clears the bitmap and resets the state, like
    /// setting `width`/`height` on a DOM canvas. Pending ops are dropped —
    /// their pixels died with the old buffer.
    fn resize(&mut self, width: f64, height: f64) {
        let (w, h) = buffer_dimensions(width, height);
        self.width = w;
        self.height = h;
        self.premul = vec![0; w * h * 4];
        self.cover = CoverageBuffer { width: w, height: h, data: vec![0.0; w * h] };
        self.state = DrawingState::default();
        self.stack.clear();
        self.path = PathBuilder::default();
        self.ops.clear();
        self.dirty = false;
    }

    /// DOM `reset()`: cleared bitmap, default state, empty path — keeping
    /// the current size. Recorded history collapses to one cleared buffer.
    fn reset(&mut self) {
        self.ops.clear();
        self.premul.fill(0);
        self.cover.data.fill(0.0);
        self.state = DrawingState::default();
        self.stack.clear();
        self.path = PathBuilder::default();
        self.dirty = false;
    }

    /// Replay pending ops into the buffer. Idempotent between mutations.
    fn materialize(&mut self) {
        if !self.dirty {
            return;
        }
        self.dirty = false;
        for op in std::mem::take(&mut self.ops) {
            self.apply(op);
        }
    }

    fn apply(&mut self, op: Op) {
        match op {
            Op::Paint { polys, rule, paint, alpha, composite, clip, m } => {
                self.apply_paint(polys, rule, &paint, alpha, composite, clip, &m)
            }
            Op::ClearRect { polys, clip } => self.apply_clear_rect(polys, clip),
            Op::DrawImage { snap, quad, inv, src_x, src_y, src_w, src_h, dst_x, dst_y, dst_w, dst_h, smoothing, alpha, composite, clip } => {
                self.apply_draw_image(snap, quad, &inv, src_x, src_y, src_w, src_h, dst_x, dst_y, dst_w, dst_h, smoothing, alpha, composite, clip)
            }
            Op::PutImage { data, img_w, img_h, dx, dy, x0, y0, x1, y1 } => {
                self.apply_put_image(&data, img_w, img_h, dx, dy, x0, y0, x1, y1)
            }
        }
    }

    /// Shared paint path for fills and strokes, ported from `paintPolys`.
    /// Strokes arrive as unions of same-orientation pieces, which additive
    /// nonzero spans resolve exactly — including the AA across piece seams.
    #[allow(clippy::too_many_arguments)]
    fn apply_paint(
        &mut self,
        polys: Vec<Poly>,
        rule: FillRule,
        paint: &Paint,
        alpha: f64,
        composite: Composite,
        clip: Option<Arc<Vec<f64>>>,
        m: &Matrix2D,
    ) {
        if polys.is_empty() {
            return;
        }
        self.cover.data.fill(0.0);
        let bbox = match rasterize_coverage(&polys, rule, &mut self.cover) {
            Some(bbox) => bbox,
            None => return,
        };
        if composite == Composite::Copy {
            self.premul.fill(0);
        }

        let width = self.cover.width;
        let data = &self.cover.data;
        // `CoveredBBox` keeps f64 fields (TS numbers); when Some they are
        // clamped to the buffer, so the integer casts are exact.
        for row in bbox.min_y as i64..=bbox.max_y as i64 {
            let base = row as usize * width;
            for col in bbox.min_x as i64..=bbox.max_x as i64 {
                let idx = base + col as usize;
                let cov = data[idx];
                if cov <= 0.0 {
                    continue;
                }
                let mut e = cov * alpha;
                if let Some(clip) = &clip {
                    e *= clip[idx];
                }
                if e <= 1.0 / 510.0 {
                    continue;
                }
                let rgb: [f64; 3];
                match paint {
                    Paint::Gradient(gradient) => {
                        let sampled = gradient.evaluate_device(col as f64 + 0.5, row as f64 + 0.5, m);
                        let sampled = match sampled {
                            // Outside the gradient's reach: untouched.
                            Some(s) => s,
                            None => continue,
                        };
                        e *= sampled.3;
                        if e <= 1.0 / 510.0 {
                            continue;
                        }
                        rgb = [sampled.0, sampled.1, sampled.2];
                    }
                    Paint::Solid { r, g, b, a } => {
                        e *= *a;
                        if e <= 1.0 / 510.0 {
                            continue;
                        }
                        rgb = [*r, *g, *b];
                    }
                }
                composite_pixel(&mut self.premul, idx * 4, rgb, e, composite);
            }
        }
    }

    /// `clearRect`: scale the destination toward zero through the coverage,
    /// honoring the clip. A `copy`-mode fill already handled its own clear.
    fn apply_clear_rect(&mut self, polys: Vec<Poly>, clip: Option<Arc<Vec<f64>>>) {
        self.cover.data.fill(0.0);
        let bbox = match rasterize_coverage(&polys, FillRule::NonZero, &mut self.cover) {
            Some(bbox) => bbox,
            None => return,
        };
        let width = self.cover.width;
        let data = &self.cover.data;
        for row in bbox.min_y as i64..=bbox.max_y as i64 {
            let base = row as usize * width;
            for col in bbox.min_x as i64..=bbox.max_x as i64 {
                let idx = base + col as usize;
                let mut e = data[idx];
                if e <= 0.0 {
                    continue;
                }
                if let Some(clip) = &clip {
                    e *= clip[idx];
                }
                if e <= 0.0 {
                    continue;
                }
                let p = idx * 4;
                let keep = 1.0 - e;
                for ch in 0..4 {
                    let v = self.premul[p + ch] as f64 * keep;
                    self.premul[p + ch] = to_u8_clamp(v);
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_draw_image(
        &mut self,
        snap: SourceSnapshot,
        quad: Vec<Poly>,
        inv: &Matrix2D,
        src_x: f64,
        src_y: f64,
        src_w: f64,
        src_h: f64,
        dst_x: f64,
        dst_y: f64,
        dst_w: f64,
        dst_h: f64,
        smoothing: bool,
        alpha: f64,
        composite: Composite,
        clip: Option<Arc<Vec<f64>>>,
    ) {
        self.cover.data.fill(0.0);
        let bbox = match rasterize_coverage(&quad, FillRule::NonZero, &mut self.cover) {
            Some(bbox) => bbox,
            None => return,
        };
        if composite == Composite::Copy {
            self.premul.fill(0);
        }

        let width = self.cover.width;
        let data = &self.cover.data;
        for row in bbox.min_y as i64..=bbox.max_y as i64 {
            let base = row as usize * width;
            for col in bbox.min_x as i64..=bbox.max_x as i64 {
                let idx = base + col as usize;
                let cov = data[idx];
                if cov <= 0.0 {
                    continue;
                }
                let mut e = cov * alpha;
                if let Some(clip) = &clip {
                    e *= clip[idx];
                }
                if e <= 1.0 / 510.0 {
                    continue;
                }
                let (ux, uy) = apply_matrix(inv, col as f64 + 0.5, row as f64 + 0.5);
                let su = src_x + ((ux - dst_x) / dst_w) * src_w;
                let sv = src_y + ((uy - dst_y) / dst_h) * src_h;
                let rgba = if smoothing {
                    snap.bilinear(su - src_x, sv - src_y)
                } else {
                    snap.nearest(su - src_x, sv - src_y)
                };
                let src_alpha = rgba.3 / 255.0;
                if src_alpha <= 0.0 {
                    continue;
                }
                let e = e * src_alpha;
                composite_pixel(&mut self.premul, idx * 4, [rgba.0, rgba.1, rgba.2], e, composite);
            }
        }
    }

    /// `putImageData` writes straight RGBA into the premultiplied buffer
    /// with no alpha blending, honoring the normalized dirty rectangle.
    #[allow(clippy::too_many_arguments)]
    fn apply_put_image(
        &mut self,
        data: &[u8],
        img_w: i64,
        img_h: i64,
        dx: i64,
        dy: i64,
        x0: i64,
        y0: i64,
        x1: i64,
        y1: i64,
    ) {
        for row in y0..y1 {
            let dst_y = dy + row;
            if dst_y < 0 || dst_y >= self.height as i64 {
                continue;
            }
            for col in x0..x1 {
                let dst_x = dx + col;
                if dst_x < 0 || dst_x >= self.width as i64 {
                    continue;
                }
                if row < 0 || col < 0 || row >= img_h || col >= img_w {
                    continue;
                }
                let src = ((row * img_w + col) * 4) as usize;
                let dst = ((dst_y as usize * self.width) + dst_x as usize) * 4;
                let a = data[src + 3] as f64;
                self.premul[dst] = to_u8_clamp(data[src] as f64 * a / 255.0);
                self.premul[dst + 1] = to_u8_clamp(data[src + 1] as f64 * a / 255.0);
                self.premul[dst + 2] = to_u8_clamp(data[src + 2] as f64 * a / 255.0);
                self.premul[dst + 3] = to_u8_clamp(a);
            }
        }
    }

    /// Record a fill/stroke of the current (or a rectangle) path. Mirrors
    /// `paintPolys`' early returns: an empty flattened path, an empty
    /// coverage box, or a degenerate gradient record nothing — and the TS
    /// layer reacts to `false` by not scheduling an upload.
    fn record_paint(&mut self, polys: Vec<Poly>, rule: FillRule, paint: &Paint) -> bool {
        if polys.is_empty() {
            return false;
        }
        if let Paint::Gradient(gradient) = paint {
            // Degenerate gradients paint nothing at all — the whole fill is
            // a no-op.
            if gradient.empty() {
                return false;
            }
        }
        // An empty coverage box (off-bitmap geometry) records nothing, but
        // only rasterization can tell — ask the bbox-only scan, which costs
        // no buffer writes. The op replays the full rasterization at
        // materialize time.
        if coverage_bbox(&polys, rule, self.width, self.height).is_none() {
            return false;
        }
        let op = Op::Paint {
            polys,
            rule,
            paint: paint.clone(),
            alpha: self.state.global_alpha,
            composite: self.state.composite,
            clip: self.state.clip.clone(),
            m: self.state.m,
        };
        self.ops.push(op);
        self.dirty = true;
        true
    }

    /// The stroke pipeline from `strokeBuilderPath`: flatten in device
    /// space (segments carry their construction-time CTM), map back through
    /// the CURRENT matrix so the outline — and the line width — live in
    /// user space, build the outline, and map forward again. This is what
    /// makes a scaled transform widen strokes without re-transforming the
    /// baked-in path.
    fn record_stroke(&mut self, builder_subpaths: &[super::geom::path::PathSubpath]) -> bool {
        let m = self.state.m;
        let inv = match invert_matrix(&m) {
            Some(inv) => inv,
            // A non-invertible CTM strokes nothing.
            None => return false,
        };
        // Flatten tighter for wide strokes: a centerline chord error of ε
        // shows up on the offset outline amplified by roughly (1 + h/r) at
        // the local curvature radius, so wide curves need a much finer
        // polyline.
        let half_width_device = (self.state.line_width / 2.0) * max_scale_of(&m);
        let tol = (0.15 / (1.0 + half_width_device)).max(1e-4);
        let device_polys = flatten_path(builder_subpaths, tol);
        if device_polys.is_empty() {
            return false;
        }
        let user_polys: Vec<Poly> = device_polys.iter().map(|p| transform_poly(p, &inv)).collect();
        let params = StrokeParams {
            line_width: self.state.line_width,
            line_cap: self.state.line_cap.clone(),
            line_join: self.state.line_join.clone(),
            miter_limit: self.state.miter_limit,
            line_dash: self.state.line_dash.clone(),
            line_dash_offset: self.state.line_dash_offset,
        };
        let outlines = build_stroke_geometry(&user_polys, &params);
        let polys: Vec<Poly> = outlines.iter().map(|p| transform_poly(p, &m)).collect();
        let paint = self.state.stroke.clone();
        self.record_paint(polys, FillRule::NonZero, &paint)
    }

    /// `clip()`: intersect the current path's coverage with the existing
    /// mask into a fresh snapshot. Without a bbox the clip path was empty
    /// and the region becomes empty too (all-zero mask).
    fn apply_clip(&mut self, rule: FillRule) {
        let polys = flatten_path(&self.path.subpaths, 0.15);
        self.cover.data.fill(0.0);
        let bbox = rasterize_coverage(&polys, rule, &mut self.cover);
        let mut next = vec![0.0f64; self.width * self.height];
        if let Some(_bbox) = bbox {
            if let Some(current) = &self.state.clip {
                for i in 0..next.len() {
                    next[i] = current[i] * self.cover.data[i];
                }
            } else {
                next.copy_from_slice(&self.cover.data);
            }
        }
        self.state.clip = Some(Arc::new(next));
    }

    /// Record a `drawImage`. The source must already be materialized — the
    /// TS rasterizer snapshots the source region at call time (required for
    /// correctness when drawing a canvas onto itself).
    #[allow(clippy::too_many_arguments)]
    fn record_draw_image(
        &mut self,
        source: &ContextCore,
        src_x: f64,
        src_y: f64,
        src_w: f64,
        src_h: f64,
        dst_x: f64,
        dst_y: f64,
        dst_w: f64,
        dst_h: f64,
    ) -> bool {
        let snap = match snapshot_region(source, src_x, src_y, src_w, src_h) {
            Some(snap) => snap,
            None => return false,
        };
        let m = self.state.m;
        let inv = match invert_matrix(&m) {
            Some(inv) => inv,
            None => return false,
        };
        let mut pts = Vec::with_capacity(8);
        for (x, y) in [
            (dst_x, dst_y),
            (dst_x + dst_w, dst_y),
            (dst_x + dst_w, dst_y + dst_h),
            (dst_x, dst_y + dst_h),
        ] {
            let (px, py) = apply_matrix(&m, x, y);
            pts.push(px);
            pts.push(py);
        }
        let quad = vec![Poly { pts, closed: true }];
        // An empty destination quad (fully off-bitmap or degenerate) records
        // nothing, same as an empty fill — asked of the bbox-only scan so
        // the check costs no buffer writes.
        if coverage_bbox(&quad, FillRule::NonZero, self.width, self.height).is_none() {
            return false;
        }
        self.ops.push(Op::DrawImage {
            snap,
            quad,
            inv,
            src_x,
            src_y,
            src_w,
            src_h,
            dst_x,
            dst_y,
            dst_w,
            dst_h,
            smoothing: self.state.image_smoothing_enabled,
            alpha: self.state.global_alpha,
            composite: self.state.composite,
            clip: self.state.clip.clone(),
        });
        self.dirty = true;
        true
    }

    /// The whole buffer as straight-alpha RGBA, materializing first. This
    /// is the upload path — pixels never round-trip through JS.
    fn straight_rgba(&mut self) -> Vec<u8> {
        self.materialize();
        let mut straight = vec![0u8; self.premul.len()];
        let mut i = 0;
        while i < straight.len() {
            let a = self.premul[i + 3];
            if a == 0 {
                // straight[i..i+4] already zero
            } else {
                let af = a as f64;
                straight[i] = unpremultiply(self.premul[i] as f64, af);
                straight[i + 1] = unpremultiply(self.premul[i + 1] as f64, af);
                straight[i + 2] = unpremultiply(self.premul[i + 2] as f64, af);
                straight[i + 3] = a;
            }
            i += 4;
        }
        straight
    }

    /// `getImageData` over a normalized positive rect, materializing first.
    fn read_image_data(&mut self, left: i64, top: i64, width: i64, height: i64) -> Vec<u8> {
        self.materialize();
        let mut data = vec![0u8; (width * height * 4) as usize];
        for row in 0..height {
            for col in 0..width {
                let px = left + col;
                let py = top + row;
                if px < 0 || py < 0 || px >= self.width as i64 || py >= self.height as i64 {
                    continue;
                }
                let src = ((py as usize * self.width) + px as usize) * 4;
                let dst = ((row * width + col) * 4) as usize;
                let a = self.premul[src + 3];
                if a == 0 {
                    continue;
                }
                let af = a as f64;
                data[dst] = unpremultiply(self.premul[src] as f64, af);
                data[dst + 1] = unpremultiply(self.premul[src + 1] as f64, af);
                data[dst + 2] = unpremultiply(self.premul[src + 2] as f64, af);
                data[dst + 3] = a;
            }
        }
        data
    }
}

/// Blend a straight-RGBA source into the premultiplied buffer at `p`, with
/// `e` the effective source alpha (coverage × style × global). Ported from
/// `compositePixel`; every store goes through the clamped rounding of a
/// `Uint8ClampedArray` write.
fn composite_pixel(premul: &mut [u8], p: usize, rgb: [f64; 3], e: f64, composite: Composite) {
    let dst_a = premul[p + 3] as f64 / 255.0;

    match composite {
        Composite::Clear | Composite::DestinationOut => {
            let keep = 1.0 - e;
            for ch in 0..4 {
                premul[p + ch] = to_u8_clamp(premul[p + ch] as f64 * keep);
            }
        }
        Composite::Copy => {
            premul[p] = to_u8_clamp(rgb[0] * e);
            premul[p + 1] = to_u8_clamp(rgb[1] * e);
            premul[p + 2] = to_u8_clamp(rgb[2] * e);
            premul[p + 3] = to_u8_clamp(255.0 * e);
        }
        Composite::Xor => {
            // Porter-Duff Xor: source shows only where the destination is
            // empty, and vice versa.
            let keep_dst = 1.0 - e;
            let src_r = rgb[0] * e * (1.0 - dst_a);
            let src_g = rgb[1] * e * (1.0 - dst_a);
            let src_b = rgb[2] * e * (1.0 - dst_a);
            let src_a = e * (1.0 - dst_a);
            premul[p] = to_u8_clamp(src_r + premul[p] as f64 * keep_dst);
            premul[p + 1] = to_u8_clamp(src_g + premul[p + 1] as f64 * keep_dst);
            premul[p + 2] = to_u8_clamp(src_b + premul[p + 2] as f64 * keep_dst);
            premul[p + 3] = to_u8_clamp(255.0 * (src_a + dst_a * keep_dst));
        }
        Composite::Lighter => {
            premul[p] = to_u8_clamp((premul[p] as f64 + rgb[0] * e).min(255.0));
            premul[p + 1] = to_u8_clamp((premul[p + 1] as f64 + rgb[1] * e).min(255.0));
            premul[p + 2] = to_u8_clamp((premul[p + 2] as f64 + rgb[2] * e).min(255.0));
            premul[p + 3] = to_u8_clamp((premul[p + 3] as f64 + 255.0 * e).min(255.0));
        }
        Composite::DestinationOver => {
            let back = 1.0 - dst_a;
            premul[p] = to_u8_clamp(rgb[0] * e * back + premul[p] as f64);
            premul[p + 1] = to_u8_clamp(rgb[1] * e * back + premul[p + 1] as f64);
            premul[p + 2] = to_u8_clamp(rgb[2] * e * back + premul[p + 2] as f64);
            premul[p + 3] = to_u8_clamp(255.0 * (e + dst_a * back));
        }
        Composite::SourceIn
        | Composite::SourceOut
        | Composite::SourceAtop
        | Composite::DestinationIn
        | Composite::DestinationAtop => {
            let (out_r, out_g, out_b, out_a);
            let src_r = rgb[0] * e;
            let src_g = rgb[1] * e;
            let src_b = rgb[2] * e;
            match composite {
                Composite::SourceIn => {
                    out_a = e * dst_a;
                    out_r = src_r * dst_a;
                    out_g = src_g * dst_a;
                    out_b = src_b * dst_a;
                }
                Composite::SourceOut => {
                    out_a = e * (1.0 - dst_a);
                    out_r = src_r * (1.0 - dst_a);
                    out_g = src_g * (1.0 - dst_a);
                    out_b = src_b * (1.0 - dst_a);
                }
                Composite::SourceAtop => {
                    out_a = dst_a;
                    out_r = src_r * dst_a + premul[p] as f64 * (1.0 - e);
                    out_g = src_g * dst_a + premul[p + 1] as f64 * (1.0 - e);
                    out_b = src_b * dst_a + premul[p + 2] as f64 * (1.0 - e);
                }
                Composite::DestinationIn => {
                    out_a = dst_a * e;
                    out_r = premul[p] as f64 * e;
                    out_g = premul[p + 1] as f64 * e;
                    out_b = premul[p + 2] as f64 * e;
                }
                // DestinationAtop (the only remaining variant).
                _ => {
                    out_a = e + dst_a * (1.0 - e);
                    out_r = src_r + premul[p] as f64 * (1.0 - e);
                    out_g = src_g + premul[p + 1] as f64 * (1.0 - e);
                    out_b = src_b + premul[p + 2] as f64 * (1.0 - e);
                }
            }
            premul[p] = to_u8_clamp(out_r);
            premul[p + 1] = to_u8_clamp(out_g);
            premul[p + 2] = to_u8_clamp(out_b);
            premul[p + 3] = to_u8_clamp(255.0 * out_a);
        }
        // source-over (and every blend name the facade folded into it).
        Composite::SourceOver => {
            let ia = 1.0 - e;
            premul[p] = to_u8_clamp(rgb[0] * e + premul[p] as f64 * ia);
            premul[p + 1] = to_u8_clamp(rgb[1] * e + premul[p + 1] as f64 * ia);
            premul[p + 2] = to_u8_clamp(rgb[2] * e + premul[p + 2] as f64 * ia);
            premul[p + 3] = to_u8_clamp(255.0 * e + premul[p + 3] as f64 * ia);
        }
    }
}

/// Buffer dimension: an integer magnitude, zero allowed (a DOM canvas can
/// be sized 0×n; every paint loop is simply empty).
fn buffer_dimensions(value: f64, other: f64) -> (usize, usize) {
    let w = value.floor();
    let h = other.floor();
    let w = if w.is_finite() && w > 0.0 { w as usize } else { 0 };
    let h = if h.is_finite() && h > 0.0 { h as usize } else { 0 };
    (w, h)
}

/// Copy a source-rect region of another core's premultiplied buffer,
/// clipped to its bounds; `None` when the intersection is empty.
fn snapshot_region(source: &ContextCore, sx: f64, sy: f64, sw: f64, sh: f64) -> Option<SourceSnapshot> {
    let x0 = 0f64.max(sx.floor()) as i64;
    let y0 = 0f64.max(sy.floor()) as i64;
    let x1 = (source.width as f64).min((sx + sw).ceil()) as i64;
    let y1 = (source.height as f64).min((sy + sh).ceil()) as i64;
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    let w = (x1 - x0) as usize;
    let h = (y1 - y0) as usize;
    let mut data = vec![0u8; w * h * 4];
    for row in 0..h {
        let src_base = (((y0 as usize + row) * source.width) + x0 as usize) * 4;
        let span = w * 4;
        let dst_base = row * w * 4;
        data[dst_base..dst_base + span].copy_from_slice(&source.premul[src_base..src_base + span]);
    }
    Some(SourceSnapshot { data, width: w as i64, height: h as i64, ox: x0 as f64 - sx, oy: y0 as f64 - sy })
}

// ── napi surface ───────────────────────────────────────────────────────
//
// The TS facade (`packages/vue/src/canvas/context2d.ts`) keeps every WebIDL
// concern — conversion, validation, exceptions, getter serialization — and
// forwards normalized values here. Mutating draw methods return `true` when
// they actually recorded something, which is the facade's signal to count
// the draw and schedule an upload (mirroring the TS early returns).

/// One gradient color stop on the wire: straight channels 0–255, alpha 0–1,
/// already parsed and sorted by the TS gradient object.
#[napi(object)]
pub struct GpuixGradientStop {
    pub offset: f64,
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

/// The transform read back by `getTransform()`.
#[napi(object)]
pub struct GpuixTransformComponents {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

#[napi]
pub struct GpuixCanvas2DCore {
    /// Interior mutability: napi hands out shared references to class
    /// instances (drawImage receives another context as an argument), and
    /// every caller lives on the JS thread, so an uncontended mutex is the
    /// whole story.
    core: Mutex<ContextCore>,
}

#[napi]
impl GpuixCanvas2DCore {
    #[napi(constructor)]
    pub fn new(width: f64, height: f64) -> Self {
        GpuixCanvas2DCore { core: Mutex::new(ContextCore::new(width, height)) }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ContextCore> {
        match self.core.lock() {
            Ok(guard) => guard,
            // Poisoning only happens after a panic mid-mutation; the core is
            // memory-safe either way, so keep going.
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    /// Dimension read for the facade's `canvas.width`/`height`.
    #[napi]
    pub fn get_width(&self) -> u32 {
        self.lock().width as u32
    }

    #[napi]
    pub fn get_height(&self) -> u32 {
        self.lock().height as u32
    }

    #[napi]
    pub fn resize(&self, width: f64, height: f64) {
        self.lock().resize(width, height);
    }

    // ── Styles (already parsed/validated by the facade) ─────────────────

    #[napi]
    pub fn set_fill_rgba(&self, r: f64, g: f64, b: f64, a: f64) {
        let mut core = self.lock();
        core.state.fill = Paint::Solid { r, g, b, a };
    }

    #[napi]
    pub fn set_fill_gradient(
        &self,
        radial: bool,
        x0: f64,
        y0: f64,
        r0: f64,
        x1: f64,
        y1: f64,
        r1: f64,
        stops: Vec<GpuixGradientStop>,
    ) {
        let mut core = self.lock();
        core.state.fill = Paint::Gradient(GradientDesc {
            radial,
            x0,
            y0,
            r0,
            x1,
            y1,
            r1,
            stops: stops.iter().map(|s| GradStop { offset: s.offset, r: s.r, g: s.g, b: s.b, a: s.a }).collect(),
        });
    }

    #[napi]
    pub fn set_stroke_rgba(&self, r: f64, g: f64, b: f64, a: f64) {
        let mut core = self.lock();
        core.state.stroke = Paint::Solid { r, g, b, a };
    }

    #[napi]
    pub fn set_stroke_gradient(
        &self,
        radial: bool,
        x0: f64,
        y0: f64,
        r0: f64,
        x1: f64,
        y1: f64,
        r1: f64,
        stops: Vec<GpuixGradientStop>,
    ) {
        let mut core = self.lock();
        core.state.stroke = Paint::Gradient(GradientDesc {
            radial,
            x0,
            y0,
            r0,
            x1,
            y1,
            r1,
            stops: stops.iter().map(|s| GradStop { offset: s.offset, r: s.r, g: s.g, b: s.b, a: s.a }).collect(),
        });
    }

    #[napi]
    pub fn set_global_alpha(&self, value: f64) {
        self.lock().state.global_alpha = value;
    }

    #[napi]
    pub fn set_line_width(&self, value: f64) {
        self.lock().state.line_width = value;
    }

    #[napi]
    pub fn set_line_cap(&self, value: String) {
        // The facade only forwards validated DOM names; anything else keeps
        // the current cap rather than failing the draw.
        let cap = match value.as_str() {
            "round" => Some(StrokeCap::Round),
            "square" => Some(StrokeCap::Square),
            "butt" => Some(StrokeCap::Butt),
            _ => None,
        };
        if let Some(cap) = cap {
            self.lock().state.line_cap = cap;
        }
    }

    #[napi]
    pub fn set_line_join(&self, value: String) {
        let join = match value.as_str() {
            "round" => Some(StrokeJoin::Round),
            "bevel" => Some(StrokeJoin::Bevel),
            "miter" => Some(StrokeJoin::Miter),
            _ => None,
        };
        if let Some(join) = join {
            self.lock().state.line_join = join;
        }
    }

    #[napi]
    pub fn set_miter_limit(&self, value: f64) {
        self.lock().state.miter_limit = value;
    }

    #[napi]
    pub fn set_line_dash(&self, segments: Vec<f64>) {
        let mut core = self.lock();
        let mut dash = segments;
        if dash.len() % 2 == 1 {
            dash.extend_from_slice(&dash.clone());
        }
        core.state.line_dash = dash;
    }

    #[napi]
    pub fn set_line_dash_offset(&self, value: f64) {
        self.lock().state.line_dash_offset = value;
    }

    #[napi]
    pub fn set_composite(&self, value: String) {
        let mut core = self.lock();
        core.state.composite = Composite::parse(&value);
    }

    #[napi]
    pub fn set_image_smoothing(&self, value: bool) {
        self.lock().state.image_smoothing_enabled = value;
    }

    // ── State stack ──────────────────────────────────────────────────────

    #[napi]
    pub fn save(&self) {
        let mut core = self.lock();
        let state = core.state.clone();
        core.stack.push(state);
    }

    #[napi]
    pub fn restore(&self) {
        let mut core = self.lock();
        if let Some(restored) = core.stack.pop() {
            core.state = restored;
        }
    }

    // ── Transforms ───────────────────────────────────────────────────────

    #[napi]
    pub fn get_transform(&self) -> GpuixTransformComponents {
        let m = self.lock().state.m;
        GpuixTransformComponents { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f }
    }

    #[napi]
    pub fn set_transform(&self, a: f64, b: f64, c: f64, d: f64, e: f64, f: f64) {
        let mut core = self.lock();
        core.state.m = Matrix2D { a, b, c, d, e, f };
    }

    #[napi]
    pub fn transform(&self, a: f64, b: f64, c: f64, d: f64, e: f64, f: f64) {
        let mut core = self.lock();
        // DOM accumulation: the new matrix applies to the point FIRST, then
        // the existing one — drawing happens "inside" the current frame.
        core.state.m = multiply_matrix(&Matrix2D { a, b, c, d, e, f }, &core.state.m);
    }

    #[napi]
    pub fn translate(&self, tx: f64, ty: f64) {
        let mut core = self.lock();
        core.state.m = multiply_matrix(&translation_matrix(tx, ty), &core.state.m);
    }

    #[napi]
    pub fn rotate(&self, angle: f64) {
        let mut core = self.lock();
        core.state.m = multiply_matrix(&rotation_matrix(angle), &core.state.m);
    }

    #[napi]
    pub fn scale(&self, sx: f64, sy: f64) {
        let mut core = self.lock();
        core.state.m = multiply_matrix(&scaling_matrix(sx, sy), &core.state.m);
    }

    #[napi]
    pub fn reset_transform(&self) {
        self.lock().state.m = identity_matrix();
    }

    // ── Path building (user space; the CTM is baked in per segment) ──────

    #[napi]
    pub fn begin_path(&self) {
        self.lock().path = PathBuilder::default();
    }

    #[napi]
    pub fn move_to(&self, x: f64, y: f64) {
        let mut core = self.lock();
        let m = core.state.m;
        core.path.move_to(x, y, m);
    }

    #[napi]
    pub fn line_to(&self, x: f64, y: f64) {
        let mut core = self.lock();
        let m = core.state.m;
        core.path.line_to(x, y, m);
    }

    #[napi]
    pub fn close_path(&self) {
        self.lock().path.close_path();
    }

    #[napi]
    pub fn quadratic_curve_to(&self, cpx: f64, cpy: f64, x: f64, y: f64) {
        let mut core = self.lock();
        let m = core.state.m;
        core.path.quadratic_curve_to(cpx, cpy, x, y, m);
    }

    #[napi]
    pub fn bezier_curve_to(&self, c1x: f64, c1y: f64, c2x: f64, c2y: f64, x: f64, y: f64) {
        let mut core = self.lock();
        let m = core.state.m;
        core.path.bezier_curve_to(c1x, c1y, c2x, c2y, x, y, m);
    }

    #[napi]
    pub fn arc_to(&self, x1: f64, y1: f64, x2: f64, y2: f64, radius: f64) {
        let mut core = self.lock();
        // The facade throws the DOM exceptions; a residual error from the
        // ported validation is unreachable and silently ignored.
        let m = core.state.m;
        let _ = core.path.arc_to(x1, y1, x2, y2, radius, m);
    }

    #[napi]
    pub fn arc(&self, x: f64, y: f64, radius: f64, start_angle: f64, end_angle: f64, anticlockwise: Option<bool>) {
        let mut core = self.lock();
        let m = core.state.m;
        let _ = core.path.arc(x, y, radius, start_angle, end_angle, anticlockwise.unwrap_or(false), m);
    }

    #[napi]
    pub fn ellipse(
        &self,
        x: f64,
        y: f64,
        radius_x: f64,
        radius_y: f64,
        rotation: f64,
        start_angle: f64,
        end_angle: f64,
        anticlockwise: Option<bool>,
    ) {
        let mut core = self.lock();
        let m = core.state.m;
        let _ = core.path.ellipse(x, y, radius_x, radius_y, rotation, start_angle, end_angle, anticlockwise.unwrap_or(false), m);
    }

    #[napi]
    pub fn rect(&self, x: f64, y: f64, w: f64, h: f64) {
        let mut core = self.lock();
        let m = core.state.m;
        core.path.rect(x, y, w, h, m);
    }

    /// `radii` is the normalized corner list — exactly eight numbers,
    /// `[tl.rx, tl.ry, tr.rx, tr.ry, br.rx, br.ry, bl.rx, bl.ry]`. The
    /// facade performs the JS-side radii validation that throws
    /// `TypeError`/`RangeError` with DOM-visible semantics.
    #[napi]
    pub fn round_rect(&self, x: f64, y: f64, w: f64, h: f64, radii: Vec<f64>) {
        let mut core = self.lock();
        // A malformed list (impossible from the facade) degrades to square
        // corners rather than panicking on the index.
        if radii.len() == 8 {
            let m = core.state.m;
        core.path.round_rect_corners(x, y, w, h, &radii, m);
        } else {
            let m = core.state.m;
        core.path.rect(x, y, w, h, m);
        }
    }

    // ── Drawing ──────────────────────────────────────────────────────────

    #[napi]
    pub fn fill(&self, rule: String) -> bool {
        let mut core = self.lock();
        let polys = flatten_path(&core.path.subpaths, 0.15);
        let paint = core.state.fill.clone();
        core.record_paint(polys, parse_fill_rule(&rule), &paint)
    }

    #[napi]
    pub fn stroke(&self) -> bool {
        let mut core = self.lock();
        let subpaths = core.path.subpaths.clone();
        core.record_stroke(&subpaths)
    }

    #[napi]
    pub fn clip(&self, rule: String) {
        let mut core = self.lock();
        core.apply_clip(parse_fill_rule(&rule));
    }

    /// The point is in device space — the DOM hit-tests the bitmap, not the
    /// current user space.
    #[napi]
    pub fn is_point_in_path(&self, x: f64, y: f64, rule: String) -> bool {
        let core = self.lock();
        if !x.is_finite() || !y.is_finite() {
            return false;
        }
        let polys = flatten_path(&core.path.subpaths, 0.15);
        point_in_polys(&polys, x, y, parse_fill_rule(&rule))
    }

    #[napi]
    pub fn fill_rect(&self, x: f64, y: f64, w: f64, h: f64) -> bool {
        let mut core = self.lock();
        let builder = rect_builder(x, y, w, h, core.state.m);
        let polys = flatten_path(&builder.subpaths, 0.15);
        let paint = core.state.fill.clone();
        core.record_paint(polys, FillRule::NonZero, &paint)
    }

    #[napi]
    pub fn stroke_rect(&self, x: f64, y: f64, w: f64, h: f64) -> bool {
        let mut core = self.lock();
        // A zero extent strokes the degenerate line — its band is visible,
        // like the DOM.
        let builder = rect_builder(x, y, w, h, core.state.m);
        let subpaths = builder.subpaths.clone();
        core.record_stroke(&subpaths)
    }

    #[napi]
    pub fn clear_rect(&self, x: f64, y: f64, w: f64, h: f64) -> bool {
        let mut core = self.lock();
        let builder = rect_builder(x, y, w, h, core.state.m);
        let polys = flatten_path(&builder.subpaths, 0.15);
        if polys.is_empty() {
            return false;
        }
        if coverage_bbox(&polys, FillRule::NonZero, core.width, core.height).is_none() {
            return false;
        }
        let clip = core.state.clip.clone();
        core.ops.push(Op::ClearRect { polys, clip });
        core.dirty = true;
        true
    }

    // ── Images ───────────────────────────────────────────────────────────

    /// The facade has already normalized the 3/5/9-argument forms, flipped
    /// negative extents, and applied the zero-extent early returns.
    #[napi]
    pub fn draw_image(
        &self,
        source: &GpuixCanvas2DCore,
        src_x: f64,
        src_y: f64,
        src_w: f64,
        src_h: f64,
        dst_x: f64,
        dst_y: f64,
        dst_w: f64,
        dst_h: f64,
    ) -> bool {
        // Materialize the source through its own lock first; the snapshot
        // copies what its buffer holds right now.
        source.lock().materialize();
        let mut core = self.lock();
        core.record_draw_image(&source.lock(), src_x, src_y, src_w, src_h, dst_x, dst_y, dst_w, dst_h)
    }

    /// Read a normalized positive rect back as straight RGBA. The facade
    /// owns the WebIDL long conversions and the zero-size exceptions.
    #[napi]
    pub fn get_image_data(&self, left: f64, top: f64, width: f64, height: f64) -> Buffer {
        let mut core = self.lock();
        Buffer::from(core.read_image_data(left as i64, top as i64, width as i64, height as i64))
    }

    /// Write straight `ImageData` bytes with a pre-normalized dirty
    /// rectangle (`x0`/`y0` ≤ `x1`/`y1`).
    #[napi]
    pub fn put_image_data(
        &self,
        data: Uint8Array,
        img_w: f64,
        img_h: f64,
        dx: f64,
        dy: f64,
        x0: f64,
        y0: f64,
        x1: f64,
        y1: f64,
    ) {
        let mut core = self.lock();
        core.ops.push(Op::PutImage {
            data: data.to_vec(),
            img_w: img_w as i64,
            img_h: img_h as i64,
            dx: dx as i64,
            dy: dy as i64,
            x0: x0 as i64,
            y0: y0 as i64,
            x1: x1 as i64,
            y1: y1 as i64,
        });
        core.dirty = true;
    }

    /// DOM `reset()`: cleared bitmap, default state, empty path.
    #[napi]
    pub fn reset(&self) {
        self.lock().reset();
    }

    /// Dimension read for the renderer's context-aware upload.
    pub fn dimensions(&self) -> (u32, u32) {
        let core = self.lock();
        (core.width as u32, core.height as u32)
    }

    /// The upload path: materialize and hand out the whole buffer as
    /// straight RGBA. Called by the renderer's context-aware upload method
    /// so pixels never round-trip through JS.
    pub fn straight_rgba(&self) -> Vec<u8> {
        self.lock().straight_rgba()
    }
}

/// A one-rectangle path builder, the shared shape of `fillRect`,
/// `strokeRect`, and `clearRect`.
fn rect_builder(x: f64, y: f64, w: f64, h: f64, m: Matrix2D) -> PathBuilder {
    let mut builder = PathBuilder::default();
    builder.rect(x, y, w, h, m);
    builder
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core_8x8() -> ContextCore {
        ContextCore::new(8.0, 8.0)
    }

    fn pixel(core: &ContextCore, x: usize, y: usize) -> [u8; 4] {
        let i = (y * 8 + x) * 4;
        [core.premul[i], core.premul[i + 1], core.premul[i + 2], core.premul[i + 3]]
    }

    #[test]
    fn u8_clamp_rounds_half_to_even_like_a_clamped_array() {
        // JS `new Uint8ClampedArray([126.5])[0] === 126` (even neighbour).
        assert_eq!(to_u8_clamp(126.5), 126);
        assert_eq!(to_u8_clamp(127.5), 128);
        assert_eq!(to_u8_clamp(254.5), 254);
        assert_eq!(to_u8_clamp(-3.0), 0);
        assert_eq!(to_u8_clamp(300.0), 255);
        assert_eq!(to_u8_clamp(f64::NAN), 0);
        assert_eq!(to_u8_clamp(254.4), 254);
        assert_eq!(to_u8_clamp(254.6), 255);
    }

    #[test]
    fn fill_rect_records_then_materializes() {
        let mut core = core_8x8();
        core.state.fill = Paint::Solid { r: 255.0, g: 0.0, b: 0.0, a: 1.0 };
        assert!(core.record_paint(
            flatten_path(&rect_builder(2.0, 2.0, 4.0, 4.0, identity_matrix()).subpaths, 0.15),
            FillRule::NonZero,
            &core.state.fill.clone(),
        ));
        // Lazy: nothing painted until materialize.
        assert!(core.ops.len() == 1);
        assert_eq!(pixel(&core, 3, 3), [0, 0, 0, 0]);
        core.materialize();
        assert_eq!(pixel(&core, 3, 3), [255, 0, 0, 255]);
        assert_eq!(pixel(&core, 1, 1), [0, 0, 0, 0]);
        // Materialize is idempotent between mutations.
        core.materialize();
        assert_eq!(pixel(&core, 3, 3), [255, 0, 0, 255]);
    }

    #[test]
    fn copy_mode_clears_the_rest_of_the_canvas() {
        let mut core = core_8x8();
        core.state.fill = Paint::Solid { r: 0.0, g: 255.0, b: 0.0, a: 1.0 };
        assert!(core.record_paint(
            flatten_path(&rect_builder(0.0, 0.0, 8.0, 8.0, identity_matrix()).subpaths, 0.15),
            FillRule::NonZero,
            &core.state.fill.clone(),
        ));
        core.materialize();
        assert_eq!(pixel(&core, 0, 0), [0, 255, 0, 255]);
        core.state.fill = Paint::Solid { r: 255.0, g: 0.0, b: 0.0, a: 1.0 };
        core.state.composite = Composite::Copy;
        assert!(core.record_paint(
            flatten_path(&rect_builder(2.0, 2.0, 2.0, 2.0, identity_matrix()).subpaths, 0.15),
            FillRule::NonZero,
            &core.state.fill.clone(),
        ));
        core.materialize();
        assert_eq!(pixel(&core, 3, 3), [255, 0, 0, 255]);
        assert_eq!(pixel(&core, 0, 0), [0, 0, 0, 0]);
    }

    #[test]
    fn put_and_read_image_data_round_trip() {
        let mut core = core_8x8();
        let data = vec![10u8, 20, 30, 128, 40, 50, 60, 255];
        core.apply_put_image(&data, 2, 1, 0, 0, 0, 0, 2, 1);
        let read = core.read_image_data(0, 0, 2, 1);
        assert_eq!(read, data);
    }

    #[test]
    fn degenerate_gradient_records_nothing() {
        let mut core = core_8x8();
        core.state.fill = Paint::Gradient(GradientDesc {
            radial: false,
            x0: 4.0,
            y0: 4.0,
            r0: 0.0,
            x1: 4.0,
            y1: 4.0,
            r1: 0.0,
            stops: vec![GradStop { offset: 0.0, r: 255.0, g: 0.0, b: 0.0, a: 1.0 }],
        });
        assert!(!core.record_paint(
            flatten_path(&rect_builder(0.0, 0.0, 8.0, 8.0, identity_matrix()).subpaths, 0.15),
            FillRule::NonZero,
            &core.state.fill.clone(),
        ));
        assert!(core.ops.is_empty());
        assert!(!core.dirty);
    }

    #[test]
    fn linear_gradient_parameter_is_axis_projection() {
        let grad = GradientDesc {
            radial: false,
            x0: 0.0,
            y0: 0.0,
            r0: 0.0,
            x1: 10.0,
            y1: 0.0,
            r1: 0.0,
            stops: vec![
                GradStop { offset: 0.0, r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                GradStop { offset: 1.0, r: 255.0, g: 255.0, b: 255.0, a: 1.0 },
            ],
        };
        let (r, g, _, _) = grad.evaluate_device(5.0, 7.0, &identity_matrix()).unwrap();
        assert!((r - 127.5).abs() < 1e-9);
        assert!((g - 127.5).abs() < 1e-9);
        // Before the first stop and after the last, end colours hold.
        let (r, _, _, _) = grad.evaluate_device(-3.0, 0.0, &identity_matrix()).unwrap();
        assert_eq!(r, 0.0);
        let (r, _, _, _) = grad.evaluate_device(30.0, 0.0, &identity_matrix()).unwrap();
        assert_eq!(r, 255.0);
    }

    #[test]
    fn straight_rgba_unpremultiplies() {
        let mut core = core_8x8();
        let data = vec![255u8, 128, 0, 128];
        core.apply_put_image(&data, 1, 1, 0, 0, 0, 0, 1, 1);
        let straight = core.straight_rgba();
        // 255 * 128/255 clamps back to 255; 128 stays 128.
        assert_eq!(&straight[0..4], &[255, 128, 0, 128]);
    }
}
