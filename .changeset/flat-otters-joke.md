---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Inline `$x^2$` formulas in `<markdown>` now render as baseline-aligned images when the `math` map covers them. The flattener replaces the TeX run with space characters whose measured advances (NBSP / THIN / HAIR SPACE denominations from the live mono font) reserve the formula's exact width, and the text underlay paints the rasterized SVG with its bottom sitting `depth` px below the line baseline — the metadata `renderMathMap` already produced. Selection drags across a formula keep working; copying one copies its placeholder spaces rather than the TeX (the same loss an inline image copies in the DOM), and unmapped formulas keep today's literal-TeX fallback. Formula SVGs rasterize once per element lifetime through gpui's usvg pipeline.
