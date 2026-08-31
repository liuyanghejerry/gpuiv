---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add a native `<canvas>` element with a JS→Rust pixel bridge: `uploadCanvasPixels(elementId, width, height, pixels)` pushes a full RGBA buffer that GPUI paints as a GPU texture (pixels ride a dedicated FFI call, never the mutation JSON), `readCanvasPixels(elementId)` reads the last upload back, and the Vue `<GpuixCanvas>` wrapper exposes both plus its host id through a template ref. Also close three pointer-semantics gaps: a `contextMenu` event (right-button release, like macOS), `setPointerCapture` / `releasePointerCapture` commands on top of gpui's pointer capture, and a `stopWheelPropagation` prop that keeps ancestor scrollers from consuming wheel gestures (the async FFI cannot do the DOM's synchronous `preventDefault`).
