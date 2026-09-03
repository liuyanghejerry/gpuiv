---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Moved the `<canvas>` 2D rasterization core into the native package. Drawing
now records into a Rust-side display list and rasterizes once per flush — on
upload or on a pixel read — so pixel buffers no longer round-trip through
JS: `renderer.uploadCanvasFromContext(elementId, ctx)` pulls straight from
the native core, and `getImageData` reads it synchronously. The complete
Canvas 2D JS API is unchanged, and the vendored WPT conformance suite keeps
pinning it (452 green / 141 skipped, same as before the move). Update
`@gpuiv/native` and `@gpuiv/vue` together — the new facade flushes through
the new native method.
