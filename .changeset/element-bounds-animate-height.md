---
'@gpuiv/vue': minor
---

Add `useElementBounds(ref)` and `<AnimateHeight>`. `useElementBounds` polls the element's last painted window-space bounds through the existing `getElementBounds` renderer API; `AnimateHeight` builds on it to tween a container between `height={0}` and `height="auto"` — the drawer/accordion pattern the web solves with `grid-template-rows: 0fr → 1fr` — with content re-measured continuously while open.
