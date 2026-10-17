---
'@gpuiv/animal-island': patch
---

Preserve decoded image proportions when Animal Island Image receives only one pixel dimension. Account for final frame padding and borders, keep explicit two-axis boxes stretched, and reset derived dimensions when the source changes or fails.
