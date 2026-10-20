---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

macOS frame loop wakes on the display link instead of polling. `GpuixRenderer.setFrameWakeCallback(callback)` registers a weak, coalesced native callback that fires after GPUI queues a display frame, so AppKit input is delivered at display rate (up to 120Hz on ProMotion) and nothing polls while idle. `startFrameLoop` uses it automatically when available, with a 100ms fallback timer for a lost wake (e.g. a hidden window's display link); an explicit `frameMs` keeps fixed-rate timer polling. Other platforms are unchanged.
