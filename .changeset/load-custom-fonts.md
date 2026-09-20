---
'@gpuiv/native': minor
---

Add `renderer.loadFont(path)` and `renderer.loadFontBytes(bytes)` to register custom `.ttf`/`.otf` fonts with the GPUI text system, so `fontFamily` can reference bundled fonts (e.g. Inter, JetBrains Mono) instead of silently falling back when they are not installed. Call them right after `init()`, before text in that family is first painted — GPUI caches a failed family lookup, so already-painted fallback text does not switch retroactively.
