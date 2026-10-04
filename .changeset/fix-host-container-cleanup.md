---
'@gpuiv/vue': patch
---

Destroy the native host container when an app or test app unmounts so remounts, Reload, and resetApp do not accumulate retained nodes.
