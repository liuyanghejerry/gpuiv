---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Rasterize the non-separable blend modes: `hue`, `saturation`, `color`, and `luminosity` now paint through the W3C Compositing and Blending §5. operators instead of throwing, completing the `globalCompositeOperation` palette for layer blending.
