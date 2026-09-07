---
'@gpuiv/native': patch
---

Draw the `<input>` and `<textarea>` caret at about 75% of `fontSize`, not full line height.

A 13px mail composer used to paint a bar as tall as the line box, so it stuck out above and below the text. The caret now matches typical cap height and sits in the middle of the line.
