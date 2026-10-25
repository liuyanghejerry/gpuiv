---
'@gpuiv/native': patch
---

Reduce Canvas 2D retained memory by storing raster coverage and clip masks in covered regions instead of full-canvas buffers, while preserving pixel output and dirty-tile uploads.

Refs #49
