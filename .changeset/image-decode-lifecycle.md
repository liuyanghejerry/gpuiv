---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Report native image decode completion and failure through `onLoad` and `onError`, once per source generation. Include the source and intrinsic dimensions or error in the event payload. Restore Animal Island Image loading fades and error artwork, and Avatar image fallbacks with the original `onError=false` opt-out.

Batch image completion repaint notifications on the next GPUI frame so many resources finishing together do not redraw the entire window once per image or stall native queries.
