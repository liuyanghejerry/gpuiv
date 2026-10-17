---
'@gpuiv/animal-island': patch
---

Keep avatar text inside its configured gap when native font hinting rounds the fitted width. Measure the painted text after resizing, correct oversized results, and stop fitting once the text fits.
