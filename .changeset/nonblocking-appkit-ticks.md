---
'@gpuiv/native': patch
---

Keep Bun responsive while GPUIV pumps embedded AppKit events on macOS.

`GpuixRenderer.tick()` now drains only native work that is ready. It no longer
waits for a display-link wake, so continuously producing PTYs, timers, promises,
and sockets can make progress between frames.

Upstream: remorses/gpuix#39
