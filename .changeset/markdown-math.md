---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Markdown math: `$$…$$` display formulas render as centered SVG images. The new `@gpuiv/vue/math` subpath exports `renderMathMap(source, options?)`, which scans markdown for `$$…$$` / `$…$` (skipping code spans), renders each formula through MathJax headless (liteAdaptor, self-contained path SVGs, results cached), fixes glyph colour, rewrites ex units to px baked at 2× for crisp GPU downscale, and returns a map to pass as `<markdown math={map}>`. Unmapped display formulas fall back to the literal TeX in a muted card. `$inline$` formulas keep their TeX source visible as an accent mono run — inline baseline-aligned SVG runs need new text-layout mechanics and remain open (the map entries already carry the `depth` metadata that layout will need).
