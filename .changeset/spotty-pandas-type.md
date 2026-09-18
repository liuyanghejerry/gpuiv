---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add `spans`, `decorations` and `selection` props to `<input>`/`<textarea>`. `spans` renders inline styled runs (weight, italic, underline, strikethrough, background, color, family) at UTF-16 offsets with IME preedit underline preserved — the rendering surface for styled text editing without contenteditable. `decorations` paints range highlight quads (search-style). `selection` applies a programmatic UTF-16 anchor/head selection. New test APIs: `getPaintedInputRuns(elementId)` and `getInputDecorations(elementId)`.
