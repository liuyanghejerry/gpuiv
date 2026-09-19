---
'@gpuiv/native': patch
'@gpuiv/vue': minor
---

Preserve file and deep-link requests received during startup until the application registers its callback. Add disposable open-request subscriptions and platform-aware file URL decoding, keeping valid files and deep links when another file URL is malformed.
