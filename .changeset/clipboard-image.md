---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add clipboard image read/write. `writeClipboardImage(data, width, height)`
encodes straight-alpha RGBA pixels as PNG onto the system clipboard
(GPUI `ClipboardItem::Image`); `readClipboardImage()` decodes whatever image
the platform stored back to RGBA, or returns null when the clipboard holds no
image. The test renderer runs the same encode/store/read round trip against
the test platform's in-memory clipboard. Part of the issue #49 P1 app-shell
gap work.
