---
'@gpuiv/native': minor
---

Render standalone markdown images (`![alt](url)`) as image blocks inside `<markdown>`. A paragraph holding only images produces one image block per image, with data-URL and http(s) sources reusing the `<img>` load pipeline; an image among text still renders as its alt text with link styling. Height is capped by the new `mdImageMaxHeight` theme metric (default 320) and an unloadable image falls back to its alt text.
