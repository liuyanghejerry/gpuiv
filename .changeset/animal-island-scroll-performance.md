---
'@gpuiv/native': patch
'@gpuiv/vue': patch
'@gpuiv/animal-island': patch
---

Keep bounds polling on Windows and Linux from forcing and waiting for another frame. Share window-size polling between components on the same renderer and interval. Preserve fresh automation snapshots, avoid updating animated height, pattern surfaces, progress bars and carousels when only their screen position changes, batch active Skeleton animations on one timer, and keep distant Animal Island gallery sections out of the active render tree.
