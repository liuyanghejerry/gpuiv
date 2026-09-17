---
'@gpuiv/native': minor
---

Incremental diff parsing for streamed patches. `<diff>` now keeps a streaming parse state: appending to `patch` reparses only from the last stable boundary (the last file's last hunk, or its header while hunk-less), so completed files are never re-parsed or re-word-diffed as tokens arrive. A source truncated mid-line is completed by the append rather than leaving a stale partial row, and non-append edits reset cleanly. Parsed output is identical to a full parse (parity-tested across streamed corpora, including renames, bare hunks, and truncated tails).
