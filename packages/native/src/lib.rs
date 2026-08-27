#![deny(clippy::all)]

mod automation;
mod color;
mod custom_elements;
mod diff;
mod element_tree;
mod markdown;
mod motion;
mod renderer;
mod retained_tree;
mod style;
mod syntax;
mod text;
mod theme;

#[cfg(feature = "test-support")]
mod test_renderer;

pub use element_tree::*;
pub use renderer::*;
pub use style::*;
