//! Canvas 2D rasterization, ported verbatim from the pure-math TypeScript
//! modules in `packages/vue/src/canvas/` (`matrix.ts`, `path.ts`, `raster.ts`,
//! `stroke.ts`, all under [`geom`]). The WPT conformance suite
//! (`packages/vue/src/__tests__/canvas-wpt.test.ts`, 593 cases) pins the exact
//! semantics of those algorithms — every branch, boundary condition,
//! NaN/Infinity handling and floating-point evaluation order — so nothing here
//! should be "improved" without checking that suite.
//!
//! [`context`] is the napi-facing half: the drawing state machine, the
//! recorded display list, lazy rasterization, and the composite/gradient
//! pixel pipeline ported from `context2d.ts`/`gradient.ts`.
pub mod context;
pub mod geom;
