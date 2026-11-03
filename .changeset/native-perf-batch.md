---
'@gpuiv/native': patch
---

Four retained-tree/frame-loop costs are gone. A re-render that changed nothing no longer wakes the window to redraw an identical frame. Focus sync visits only the elements that can take focus instead of every retained element each frame. Elements without listeners or custom props no longer allocate maps for them. `<div>` and `<text>` no longer add a hidden canvas child to record their bounds — the element's own paint reports its border box, so a frame lays out and paints far fewer nodes.
