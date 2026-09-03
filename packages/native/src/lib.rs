#![deny(clippy::all)]

mod automation;
mod canvas;
// Canvas 2D math, ported verbatim from packages/vue/src/canvas/. Public so
// the napi context layer (canvas2d/context.rs) can build on it; until that
// lands only its own tests call it, and a private module would dead-code-warn.
pub mod canvas2d;
mod color;
mod custom_elements;
mod diff;
mod element_tree;
mod markdown;
mod motion;
mod renderer;
// The data model is public so `examples/bench_serde.rs` measures the real
// types instead of a copy that silently drifts from them.
pub mod retained_tree;
pub mod style;
mod syntax;
mod text;
mod theme;

#[cfg(feature = "test-support")]
mod test_renderer;
mod app_menu;

pub use element_tree::*;
pub use renderer::*;
pub use style::*;
