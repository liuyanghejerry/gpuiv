---
'@gpuiv/native': patch
---

Reuse text measurements across frames. A `<text>` whose content, inherited style and available width did not change is no longer re-shaped and re-wrapped on every frame, so frames over large text trees get cheaper again (a 1,000-row table drops from ~78 ms to ~62 ms per frame). Layout is unchanged.
