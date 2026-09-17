---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Font fallback configuration. The theme now accepts `fontSansFallbacks` / `fontMonoFallbacks` family lists, applied everywhere the theme fonts are used — `<code>`, `<diff>`, and `<markdown>` content and chrome. Absent lists keep the platform's own font cascade (CoreText on macOS); set them to pin CJK/emoji coverage on Windows and Linux.
