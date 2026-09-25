---
'@gpuiv/native': patch
'@gpuiv/vue': patch
---

Coalesce macOS repaints into the frame loop. Every `applyBatch` used to draw a full frame (build + Taffy layout + paint) synchronously inside the FFI call — with live components flushing ~130 batches/s (spinners, bounds polls, streamed text) and scrolling rebuilding the largest part of the tree, that pinned a CPU core and dropped frames. Batches now only mark the tree dirty; the frame loop's `tick()` draws once per tick, which also caps the paint rate at the loop's 16ms cadence (~60fps). Same-frame paths (selection drag, IME) keep their explicit `window.refresh()`. Scroll CPU on the component gallery measured 100% → ~40% of a core; the frame loop's default interval moved from 8ms to 16ms to match the paint cap.
