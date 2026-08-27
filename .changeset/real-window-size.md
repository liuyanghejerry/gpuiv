---
'@gpuiv/native': patch
---

`getWindowSize()` now reports the real viewport instead of a hardcoded `800x600`.

Anything that turned a mouse position into layout coordinates pointed at the wrong place on every window that was not exactly that size — including `useWindowInsets()`' keyboard geometry. macOS reads the viewport directly; Windows and Linux ask the UI thread.
