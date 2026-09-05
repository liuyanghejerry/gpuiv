---
'@gpuiv/vue': patch
---

Keep click, keyboard, and other event handlers active after `bun --hot` remounts an app on its existing native window.

Renderer event ownership and element IDs now survive JavaScript module reloads for the full life of the native renderer. Late events from the previous tree still cannot enter its replacement, and the render-level `onEvent` option is rebound to each mount instead of only the first.

Upstream: remorses/gpuix#37
