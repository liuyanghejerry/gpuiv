---
'@gpuiv/vue': patch
---

Stop `<markdown-editor>` from crashing on clipboard events that arrive right after a document-shrinking edit. Two native events delivered in the same tick share the previous render's handler closures; a cut/copy/paste carrying a block position the document no longer contains threw ProseMirror's `RangeError`. Position-taking paths now no-op on stale positions instead.
