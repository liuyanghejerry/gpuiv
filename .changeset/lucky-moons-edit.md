---
'@gpuiv/vue': minor
---

Add `<markdown-editor>`, a WYSIWYG Markdown editor component: a headless ProseMirror document rendered as one native editable block per textblock. Supports GFM (tables with alignment, task lists, strikethrough, footnotes), `==highlight==`, remark-breaks semantics, input rules (`# `, `- `, `1. `, ``` ``` ``` `, `> `, `==x==`, `[x] `), format shortcuts (⌘B/⌘I/⌘E/⌘K/⌘⇧X/⌘⇧H), block splitting on enter, task checkbox toggles, marker-style-preserving markdown round-trip, document-wide ⌘A select-all, a right-click context menu (Copy/Cut/Paste/Select All), cross-block selection with markdown copy/cut and structured paste, undo/redo through the ProseMirror history, search highlighting via decorations, source mode with scroll-ratio restore, and heading anchor jumps with a flash indicator. See `examples/markdown-editor.tsx`.
