---
'@gpuiv/vue': patch
---

Parse the CSS Color 4 slash alpha in canvas `color(srgb …)` styles. `color(srgb 1 0 0 / 50%)` previously parsed to `null` — the `/` token landed in the channel list — so the assignment was silently ignored; the slash form (number or percentage alpha, with or without surrounding whitespace) now works.
