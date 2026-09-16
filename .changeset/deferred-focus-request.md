---
'@gpuiv/native': patch
'@gpuiv/vue': patch
---

Queue `focusElement()` requests that arrive before the element has a native focus handle.

A focus request fired from a mount effect ahead of the first frame used to be
dropped. It is now applied by the first render that creates the element's focus
handle. If several requests arrive before that render, the latest request wins,
and an explicit request beats `autoFocus`.
