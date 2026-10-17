---
'@gpuiv/native': minor
'@gpuiv/vue': minor
'@gpuiv/animal-island': patch
---

Support `display: none` for retained elements and native `filter` motion tracks. Hidden subtrees keep their Vue state and native identity while skipping layout, paint and hit-testing, and matching image-filter lists interpolate on the frame clock. Keep every Carousel slide mounted so hidden pages retain local state, add the outgoing-slide crossfade, and animate BackTop's shadow with the new filter track instead of swapping cached SVGs.
