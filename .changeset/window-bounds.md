---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Window position read and restore. `getWindowBounds()` returns the window's frame in logical points (origin at the main display's top-left), and the window options now accept `x`/`y` to open at a saved position instead of centered. Save the bounds on quit and pass them back on the next launch to persist the window position. Ignored for `layerShell` surfaces.
