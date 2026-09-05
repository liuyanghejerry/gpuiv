#![deny(clippy::all)]

#[cfg(all(
    not(all(target_arch = "wasm32", target_os = "unknown")),
    not(all(
        feature = "test-support",
        any(target_os = "macos", target_os = "windows")
    ))
))]
use napi::bindgen_prelude::*;
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use napi_derive::napi;

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

#[cfg(all(
    feature = "test-support",
    any(target_os = "macos", target_os = "windows")
))]
mod test_renderer;
mod app_menu;

pub use element_tree::*;
pub use renderer::*;
pub use style::*;

#[cfg(any(
    test,
    not(all(
        feature = "test-support",
        any(target_os = "macos", target_os = "windows")
    ))
))]
const TEST_GPUIX_RENDERER_UNAVAILABLE: &str = concat!(
    "TestGpuixRenderer is macOS and Windows only. ",
    "Linux builds have no test-support because wgpu cannot read a rendered image back yet. ",
    "GpuixRenderer still works on Linux."
);

/// True only when this binary compiled the real GPU test renderer.
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
#[napi]
pub fn has_test_gpuix_renderer() -> bool {
    cfg!(all(
        feature = "test-support",
        any(target_os = "macos", target_os = "windows")
    ))
}

#[cfg(all(
    not(all(target_arch = "wasm32", target_os = "unknown")),
    not(all(
        feature = "test-support",
        any(target_os = "macos", target_os = "windows")
    ))
))]
#[napi]
pub struct TestGpuixRenderer;

#[cfg(all(
    not(all(target_arch = "wasm32", target_os = "unknown")),
    not(all(
        feature = "test-support",
        any(target_os = "macos", target_os = "windows")
    ))
))]
#[napi]
impl TestGpuixRenderer {
    #[napi(constructor)]
    pub fn new(_width: Option<f64>, _height: Option<f64>) -> Result<Self> {
        Err(Error::from_reason(TEST_GPUIX_RENDERER_UNAVAILABLE))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_message_explains_linux() {
        assert!(TEST_GPUIX_RENDERER_UNAVAILABLE.contains("macOS and Windows only"));
        assert!(TEST_GPUIX_RENDERER_UNAVAILABLE.contains(
            "Linux builds have no test-support because wgpu cannot read a rendered image back yet"
        ));
        assert!(TEST_GPUIX_RENDERER_UNAVAILABLE.contains("GpuixRenderer still works on Linux"));
    }

    #[test]
    fn has_test_gpuix_renderer_matches_real_impl() {
        assert_eq!(
            has_test_gpuix_renderer(),
            cfg!(all(
                feature = "test-support",
                any(target_os = "macos", target_os = "windows")
            ))
        );
    }
}
