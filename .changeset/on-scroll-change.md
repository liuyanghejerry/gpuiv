---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

`onScrollChange` on an `overflow: "scroll"` element reports its scroll offset whenever it moves — wheel, scrollbar drag, `scrollTo`, `scrollIntoView`, or content shrinking under the offset — complementing `onScroll`, which reports only the wheel delta before it is applied. The event payload gains `scrollX` and `scrollY`.
