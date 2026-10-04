---
'@gpuiv/vue': patch
---

Route each event handler in a listener array through Vue's error handling so async rejections reach error boundaries and a handled error does not skip the remaining listeners.
