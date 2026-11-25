---
'@gpuiv/native': patch
---

Update the bundled GPUI to the latest `remorses/zed` `gpuix` branch. The GPUI profiler now allocates its journal buffer only when something writes to it, so idle apps use less memory.
