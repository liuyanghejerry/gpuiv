---
'@gpuiv/native': patch
'@gpuiv/vue': patch
---

Clearing or appending to a long list now costs time proportional to its length instead of its square. Clearing 20,000 rows drops from ~140 ms to ~50 ms.
