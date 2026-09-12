---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add canvas PNG export. The `GpuixCanvas` instance gains `toDataURL()` and
`toBlob(callback)` over a new renderer command `canvasToPng(elementId)`,
which encodes the last uploaded buffer with Rust's `image` crate. Any
requested type falls back to PNG (the DOM's unsupported-type behavior);
before the first upload both report null instead of encoding a transparent
bitmap. Together with the file dialogs and clipboard image APIs this
completes the export-image loop for drawing apps. Part of the issue #49 P1
gap work.
