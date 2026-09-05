---
'@gpuiv/native': patch
'@gpuiv/vue': patch
---

Exit the process when the last window closes on Windows and Linux.

`GpuixRenderer.tick()` now reports whether the UI thread is still inside `Platform::run` (it returns `false` after the last window closes, as on macOS), and `requiresTick()` is true on every desktop platform so the JS frame loop polls it and `createApp()` exits. Later UI commands after the last window no longer log `window not found`.

Upstream: remorses/gpuix#32
