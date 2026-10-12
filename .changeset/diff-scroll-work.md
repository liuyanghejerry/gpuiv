---
'@gpuiv/native': patch
---

Reduce diff scrolling work by checking changed props instead of hashing the full patch every frame, and limiting offscreen row measurement to four code lines.
