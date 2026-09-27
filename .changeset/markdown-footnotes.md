---
'@gpuiv/native': minor
---

Read-only `<markdown>` renders footnotes. `[^label]` references paint as numbered accent markers (`[1]`) in document order of first appearance, definitions render in place with the shared number, and clicking a reference emits `linkClick` with `footnote:<label>` so apps can scroll or preview. Previously references painted as the literal `[label]` and definitions vanished into the surrounding stream. Footnote numbering is global, so sources containing definitions take the same full-reparse path as link-reference definitions.
