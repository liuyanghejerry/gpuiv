---
'@gpuiv/native': patch
---

Prevent live-app mouse automation from aborting the GPUI process when a locator clicks, hovers, wheels, or drags.

Mouse input now enters through the window without already holding the root view, so GPUI event listeners can safely update that view during dispatch.

Upstream: remorses/gpuix#38
