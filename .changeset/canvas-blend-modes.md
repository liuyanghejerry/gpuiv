---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Rasterize the separable `globalCompositeOperation` blend modes on `<canvas>`.

Assigning `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, or `exclusion` now blends per the W3C *Compositing and Blending Level 1* spec instead of silently rendering as `source-over`. The blend runs in straight (un-premultiplied) colour space and composites onto the premultiplied buffer, so translucent backdrops, `globalAlpha`, coverage edges, and `drawImage` all keep their alpha semantics.

The non-separable modes (`hue`, `saturation`, `color`, `luminosity`) remain unimplemented and now **throw** when assigned, like the text APIs — they are also removed from the `GpuixCompositeOperation` type. Unknown values are still ignored, matching the DOM.
