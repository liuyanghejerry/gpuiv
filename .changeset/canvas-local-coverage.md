---
'@gpuiv/native': patch
---

Reduce CPU work for small brush strokes on large canvases by clearing only the previously used antialiasing coverage region between drawing operations.
