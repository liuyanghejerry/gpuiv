#![deny(clippy::all)]

mod automation;
mod canvas;
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
