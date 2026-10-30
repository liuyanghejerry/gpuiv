---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

`scrollbarColor` paints a native scrollbar thumb: over an `overflow: "scroll"` container on each axis that has more to show, and over a `<virtual-list>`. The thumb follows the scroll offset in the frame it paints, sizes unmeasured virtual rows from the measured ones, takes no pointer input, and `scrollbarWidth` sets its thickness (default 6). Padding on a `<virtual-list>` now insets its rows on all four sides, with the thumb at the list's own edge.
