---
'@gpuiv/vue': minor
---

`collectGarbageWhenIdle()` runs one full garbage collection once the app has stopped committing mutations for a while (default: two 5s checks with no batch and under half a core of CPU), then waits for the next burst. Returns a stop function.
