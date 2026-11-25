---
'@gpuiv/native': patch
---

Make large text trees much cheaper to render. A `<text>` with a string child used to build five GPUI elements every frame (the host, a wrapper for the string, a layout wrapper, a paint canvas and the text); it now builds two, and no longer copies the string or rebuilds its selection key each frame. Layout, selection, search highlights, automation bounds and `getPaintedText()` are unchanged. A frame over 5,000 `<text>` nodes drops from ~103 ms to ~51 ms, and over a 1,000-row table from ~114 ms to ~77 ms.
