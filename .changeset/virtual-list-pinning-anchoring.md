---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Virtual-list scroll pinning and a pixel-preserving anchor API, so a feed can prepend rows and an infinite-scroll history can land a page without moving the message the reader is looking at.

- A top-aligned list scrolled to the very top **stays at the top when rows are prepended**, matching the browser. Away from the top, the anchor keeps the rows on screen exactly where they are. A `followTail` list that has not filled its viewport keeps following the tail.
- `scrollToItem(index, offsetInItem?)` gains a pixel offset that **may be negative**, anchoring the viewport top above the row. gpui resolves it at layout time against freshly measured rows, so a restore after a prepend is pixel-exact rather than estimate-based. Virtual-list scrolls are queued and applied after that frame's child splice, so an index computed against a just-committed child list is never shifted twice.
- `getListScrollTop(listId)` reports the logical anchor `[itemIndex, offsetInItemPx, viewportHeightPx]` — exact even while row heights are still estimates, unlike the pixel-space `getScrollOffset`. `itemIndex == itemCount` is gpui's at-end sentinel; the viewport height converts it into a position relative to the trailing rows.
- The Vue `<VirtualList>` wrapper exposes the pair through a template ref — `scrollToItem(index, offsetInItem?)`, `getListScrollTop()` returning `{ itemIndex, offsetInItem, viewportHeight, atEnd }` with the sentinel decoded, and the host element `id` — and widens its mounted window to cover the scroll target before the scroll lands.
