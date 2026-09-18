---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Extend `<input>`/`<textarea>` into a styled-text editing surface. New props: `spans` (inline styled runs — weight, italic, underline, strikethrough, background, color, family — at UTF-16 offsets with IME preedit underline preserved; boolean `underline`/`strikethrough` inherit the run's text color), `decorations` (search-style range highlight quads), `selection` (programmatic UTF-16 anchor/head), `valueRevision` (authoritative re-sync that bypasses echo suppression) and `interceptClipboard` (clipboard keybindings become events instead of native edits). New events: `selectionChange` (paint-time deduped UTF-16 anchor/head), `copy`/`cut`/`paste` (intercepted clipboard intents), `undo`/`redo` (routed to the host when a listener is registered, native undo stack skipped) and `backspaceStart` (backspace with empty selection at offset 0, for cross-block joins). `style.textAlign` is now honored when painting. New test APIs: `getPaintedInputRuns(elementId)`, `getInputDecorations(elementId)`, `getInputTextPosition(elementId, offset)` and `getInputTextOffset(elementId, x, y)`.
