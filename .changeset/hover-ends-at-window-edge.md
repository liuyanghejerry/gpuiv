---
'@gpuiv/native': patch
'@gpuiv/vue': patch
---

Hover ends when the pointer leaves the window. GPUI now clears hover state on the window-exit event (previously hover stuck to the last hit element until the pointer returned), and the test renderer gains `simulateMouseExit` / `nativeSimulateMouseExit(x, y)` so apps can regress the platform's no-final-move exit in GPU-backed tests.
