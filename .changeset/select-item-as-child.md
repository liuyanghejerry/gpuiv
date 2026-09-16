---
'@gpuiv/vue': minor
---

Add `asChild` to `SelectItem` and `ComboboxItem`.

With `asChild`, the item renders no wrapper of its own: its click/hover
handlers, state-driven style, and remaining props merge onto the single child
element via `cloneVNode`, so a custom row's root becomes the item and owns the
one native hit target. A filled custom row no longer covers the item's hitbox
(GPUI paints a flat hit list and does not hover-gate clicks through filled
children). Component children receive the merged props through Vue's
fallthrough attrs and must render a single root element.
