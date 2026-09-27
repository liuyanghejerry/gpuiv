---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

`<VirtualList>` grows sticky section headers. Pass `stickyIndices` (logical indices of header rows, ascending) and optionally `renderStickyHeader`; the active section's header pins at the top of the list as an overlay that paints above the rows and passes wheel and selection through (`pointerEvents: "none"`), swapping when the next section's header crosses the top. The header content must paint its own opaque background. Backed by a new `getVirtualListGeometry(elementId, index)` renderer query — `[anchorIndex, viewportX, viewportY, viewportWidth, viewportHeight]` plus item bounds when measured — which is also the primitive for other scroll-driven UI. True in-flow sticky (headers pushed by their successor, interactive overlays) needs a GPUI List change and stays on the fork queue.
