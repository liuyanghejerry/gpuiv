---
'@gpuiv/native': minor
---

Multiple windows now work on Windows and Linux too: a second renderer's `init()` opens its window on the process's single GPUI UI thread instead of failing. Window-scoped commands (scroll, focus, window controls, automation queries) are addressed to their own window through the shared command channel, and closing a window removes it from the UI thread's window table.
