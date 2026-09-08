---
'@gpuiv/vue': minor
---

Native event handler errors now flow through Vue's error handling, matching web `v-on` semantics: `onErrorCaptured` boundaries catch them, and returning `false` stops the error from reaching the global runtime error overlay.

`createApp()` options gain `onRuntimeError(error, info)` — observe every routed runtime error (render, event handlers, frame-loop ticks, process-level throws) in parallel with the overlay, the Sentry-style integration point — and `errorOverlay: false` to turn the overlay off.
