//! The pure-geometry core of the 2D canvas: affine matrices, path building
//! and flattening, scanline coverage rasterization, and stroke outline
//! geometry.
//!
//! Verbatim port of the TS modules in `packages/vue/src/canvas/`
//! (`matrix.ts`, `path.ts`, `raster.ts`, `stroke.ts`), one Rust file per TS
//! module, function for function. The canvas WPT suite pins the semantics.

pub mod matrix;
pub mod path;
pub mod raster;
pub mod stroke;

pub use matrix::{
    apply_matrix, identity_matrix, invert_matrix, max_scale_of, multiply_matrix, rotation_matrix,
    scaling_matrix, translation_matrix, Matrix2D,
};
pub use path::{
    flatten_path, PathBuilder, PathError, PathSegment, PathSubpath, Poly, RoundRectRadius,
};
pub use raster::{
    point_in_polys, rasterize_coverage, CoveredBBox, CoverageBuffer, FillRule, SUBSCANLINES,
};
pub use stroke::{build_stroke_geometry, StrokeCap, StrokeJoin, StrokeParams};
