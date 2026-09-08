---
'@gpuiv/vue': patch
---

Add an error-handling example that tours the runtime error story end to end: a render throw and a click-handler throw landing on the overlay with Reload restoring the app, an `onErrorCaptured` boundary falling back locally, and an `onRuntimeError` report log.

Run it with `bun run error-handling` in `examples/`.
