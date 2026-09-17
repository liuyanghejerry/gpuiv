---
'@gpuiv/native': minor
---

Incremental markdown parsing for streamed sources. `<markdown>` now keeps a streaming parse state (ported from Comet's `IncrementalParser`): appending to `source` reparses only from the last stable top-level block boundary, so token-by-token output costs O(tail) per update instead of a full-document reparse. Completed blocks are shared between frames; sources containing link-reference definitions fall back to full reparses for correctness, and non-append edits reset cleanly. Rendered output is byte-for-byte identical to a full parse (parity-tested across streamed corpora).
