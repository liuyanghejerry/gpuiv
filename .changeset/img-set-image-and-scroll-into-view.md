---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Every host element ref now has `scrollIntoView()`, which scrolls the nearest `overflow: "scroll"` parent or `<virtual-list>` until the element is visible. `<img>` refs additionally gain `setImage(bytes)` and `setImagePixels(width, height, rgba)` for live image uploads that bypass `src` and the JSON mutation protocol — the previous GPU image is dropped on replace and on unmount, and a virtual-list child scrolls by its logical index (windowStart-aware), not its windowed child position.
