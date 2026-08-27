---
'@gpuiv/native': patch
---

`getElementBounds()` now returns the real border box of an element.

The bounds recorder's canvas is absolutely positioned at an element's
content-box origin and sized to its padding box, so the recorded box was
translated from the real hitbox by the element's padding and border. A
locator-driven `click()` still worked (the center is always inside), but
corner-region clicks and any code working from the recorded coordinates
silently missed. The record is now converted back to the border box, the
same box GPUI hit-tests, for `<div>`, `<text>`, `<code>`, and the input
elements.
