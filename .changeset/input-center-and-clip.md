---
'@gpuiv/native': patch
---

Single-line `<input>` now vertically centers text when given extra height,
and clips content to its own `borderRadius` automatically.

Previously, text sat at the top of the box and could paint outside
rounded corners. This matches how HTML inputs behave.
