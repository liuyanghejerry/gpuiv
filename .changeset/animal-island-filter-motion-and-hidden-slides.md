---
'@gpuiv/native': minor
'@gpuiv/vue': minor
'@gpuiv/animal-island': patch
---

Support `display: none` for retained elements and native `filter` motion tracks. Hidden subtrees keep their Vue state and native identity while skipping layout, paint and hit-testing, and matching image-filter lists interpolate on the frame clock while the last filtered frame (or the unfiltered source before the first) stays visible until the next one is ready. Keep every Carousel slide mounted so hidden pages retain local state, add the outgoing-slide crossfade, and keep BackTop's hover scale on one baked rest shadow that scales with the artwork instead of regenerating a filter per frame.
