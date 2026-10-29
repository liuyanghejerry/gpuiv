---
'@gpuiv/native': patch
---

`scrollIntoView` and `scrollToItem` on a plain `overflow: "scroll"` container scrolled to the wrong child or not at all: the internal bounds canvas was the scroll container's first paint-tree child, shifting gpui's child indices by one against the retained tree's. The canvas now paints after the user children, so indices align.
