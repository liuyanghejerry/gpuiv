---
'@gpuiv/vue': patch
---

Keep the macOS window alive after a JavaScript runtime error.

A throw used to kill the frame loop that pumps AppKit, so the window froze
while bun exited. `startFrameLoop` now catches errors from `tick()` and
schedules the next pump. Native event callbacks catch throws from Vue
handlers. `createApp()` also installs `uncaughtException` and
`unhandledRejection` listeners so bun stays alive, and starts the frame loop
before the first mount flush. The error is logged; save under `bun --hot` to
remount.

Upstream: remorses/gpuix (2487521)
