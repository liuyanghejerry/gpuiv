---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

`onLayout` on `<div>` and `<text>` reports the element's border box after its first paint and each time its size changes, with no polling of `getElementBounds`. The event payload gains `width` and `height`.
