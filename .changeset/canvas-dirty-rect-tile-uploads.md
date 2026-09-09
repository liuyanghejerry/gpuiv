---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Canvas uploads are now dirty-rect: the native store keeps a CPU mirror of each canvas and paints it as a grid of 256×256 texture tiles, so a flush splices only the region the drawing ops touched and re-uploads only the tiles that region intersects. Upload cost scales with the dirty area instead of the canvas size — a 64×64 brush dab on a 2880×1920 canvas moves ~0.4 MB instead of ~22 MB, and a flush with nothing pending uploads nothing and skips the repaint. `GpuixCanvas.uploadPixels` and `renderer.uploadCanvasPixels` accept an optional `[x, y, w, h]` dirty rect for manual buffer control, and the 2D context path (`uploadCanvasFromContext`) tracks its own dirty region from each op's bounding box. Replaced tiles are freed from the sprite atlas on the next render, which also fixes atlas growth during long drawing sessions.
