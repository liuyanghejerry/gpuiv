---
'@gpuiv/native': patch
'@gpuiv/animal-island': patch
---

Keep Animal Island Input UTF-16 length limits from splitting emoji surrogate pairs. Preserve provisional IME text and apply the limit to the final full value, including compositions that end without a final change event. Treat negative and non-finite limits as unrestricted.

Make native `valueRevision` corrections override pending value echoes even when Vue combines a changed value and revision in one render, so length corrections reach the actual editor.
