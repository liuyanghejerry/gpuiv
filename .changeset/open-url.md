---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add `openUrl(url)`: hands a URL to the user's default browser / handler via
GPUI's `App::open_url`, for links that must leave the app (OAuth, payment
pages). The test bridge records the last URL (`getLastOpenedUrl`) for
assertions. Part of the issue #49 P1 app-shell gap work.
