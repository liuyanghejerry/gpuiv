---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Emit DOM-style IME composition events from `<input>`/`<textarea>`: `onCompositionStart` fires once when marking begins, `onCompositionUpdate` on every marked-text change, and `onCompositionEnd` on commit or cancel, so apps can gate shortcuts and UI on active composition. The test bridge gains `simulateMarkedText`, `simulateImeCommit`, and `simulateImeCancel`.
