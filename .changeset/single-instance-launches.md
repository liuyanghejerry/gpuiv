---
'@gpuiv/vue': minor
---

Add `acquireSingleInstance` to elect one application process before opening a window and forward later launches with their arguments and working directory. Queue requests until the application is ready, authenticate local delivery, and release ownership automatically when the primary process exits or crashes. Provide a standalone `@gpuiv/vue/single-instance` entry that does not load the native renderer.
