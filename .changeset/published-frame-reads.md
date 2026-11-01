---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add `getElementsAt(x, y)` for topmost-first element hit testing with clipping, deferred layers, and pointer-event handling. Read bounds, automation trees, and window sizes from the last completed frame without forcing paint or waiting for the UI thread; pass `forceRender: true` when a fresh frame is required. Preserve the last good window size when a native query fails.
