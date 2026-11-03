---
'@gpuiv/native': patch
---

`loadFont` / `loadFontBytes` validate the font before handing it to the text system: a file that is not a TrueType/OpenType font, or whose family/full/PostScript name records are missing or unreadable, now fails the call with an error instead of aborting the whole process. The GPU test renderer also gained `loadFontBytes`, so tests can exercise custom fonts headlessly.
