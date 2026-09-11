---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add `onFileDrop` for Finder and OS file drops.

Drop files onto any host element and receive the absolute filesystem paths:

```tsx
<div
  onFileDrop={(event) => openFiles(event.paths ?? [])}
  style={{ width: 400, height: 300 }}
/>
```

- `event.paths` is `string[]` of absolute Unicode paths; `event.x`/`event.y` is the drop point in window pixels
- an empty drop, or a drop containing a non-Unicode path, never fires
- nested targets keep working: GPUI stops propagation after a matching drop, so the innermost listener wins
- works on `div`, `text`, `img`, `svg`, `input`, `textarea`, `code`, `markdown`, `diff`, and `anchored` — `<virtual-list>` is not a host div, wrap it
- desktop only
- tests: `app.renderer.nativeSimulateFileDrop(x, y, paths)` drives the real GPUI drop pipeline
