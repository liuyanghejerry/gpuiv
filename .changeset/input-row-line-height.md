---
'@gpuiv/native': patch
---

Size `<input>` and `<textarea>` rows from `style.fontSize` and `style.lineHeight`.

Row height used to be pinned to GPUI's default 16×φ no matter what the style said — a 28px font sat in a 26px box. The row now comes from the element's text style: an explicit `lineHeight` sets the row in pixels, and without one a larger `fontSize` grows the box (default leading). `minRows`/`maxRows` still multiply that height, and an explicit `height` still wins.
