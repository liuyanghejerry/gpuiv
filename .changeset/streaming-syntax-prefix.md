---
'@gpuiv/native': minor
---

Streamed code blocks highlight incrementally: an appended source now resumes Syntect parsing from a stable-prefix checkpoint (the previous last line) instead of re-parsing the whole document, so token-by-token streaming costs work proportional to the new tail. `getSyntaxCacheStats` reports the new `streamHits` counter.
