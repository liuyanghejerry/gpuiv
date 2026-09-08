---
'@gpuiv/vue': patch
---

Show a runtime error overlay with a Reload button after a JavaScript throw.

A throw used to keep the process alive but the window stayed on its last frame with no feedback. `createApp()` now replaces the tree with the error message and stack, and **Reload** remounts the last tree. Component render errors, event handlers, frame-loop ticks, and `uncaughtException` / `unhandledRejection` all take this path. Saving under `bun --hot` still remounts.
