---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add a `highlight` prop for text search, with `useTextSearch` driving a find bar.

`highlight` paints a wash under every match in a subtree, like browser find. Declare it on any element — the nearest declaration wins, nested declarations are skipped — and `onHighlight` reports the match count after the build that resolved it.

```tsx
import { useTextSearch } from '@gpuiv/vue'

const search = useTextSearch({ query: 'needle' })

<div v-bind="search.props">
  <text>one needle here</text>
  <text>another needle</text>
</div>
```

- A match never crosses a line, but it does cross the host nodes the renderer makes for one interpolated line, so `<text>Hello {name}!</text>` matches `Hello Tommy`.
- Matches are numbered in **paint order**, so `activeIndex` means "the nth match in the document" whether a `<text>` or a `<code>` painted it. `<code>`, `<markdown>` and `<diff>` match the exact string they paint (`query` only; explicit `ranges` index retained text).
- Explicit `ranges` are `[start, end)` pairs in UTF-16 code units, the units `indexOf` and `RegExp.exec` return.
- Virtualized content: a `<virtual-list>` only mounts a window of rows, so pass your own bookkeeping — `matches: { total, indexOffset }`, both MATCH counts summed with the exported `findRanges` (the same matcher, in JS).
- Resolution is cached on two levels: a query change never re-walks the subtree (keyed on a new `searchRevision`, not the general revision), and moving the find cursor only re-colours what was already found.

Tests: `renderer.getPaintedHighlights()` returns every wash painted in the last frame, in paint order, with `active` flags and rects.
