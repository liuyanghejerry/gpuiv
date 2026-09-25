---
'@gpuiv/native': patch
'@gpuiv/vue': patch
---

Paste shortcuts now propagate when the clipboard has no text. `Cmd+V` / `Ctrl+V` on an `<input>` or `<textarea>` reaches `onKeyDown` (element and window) when the clipboard is empty, image-only, or holds Finder-copied files, so applications can handle those pastes themselves. A read-only editor propagates too. Mixed text-and-image clipboard content still pastes its text natively.
