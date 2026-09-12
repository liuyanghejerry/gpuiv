---
'@gpuiv/vue': minor
---

Select now follows Base UI's split between Root label data and mounted Item interaction data. `items` on `Select` is optional and only a label lookup for `SelectValue` while the popup is closed; keyboard navigation and clicks read the mounted `SelectItem` children through a provide/inject registration registry, so a styled wrapper around `SelectItem` works and a late-mounted selected item becomes the highlight. Without `items`, `SelectValue` shows the raw value. `SelectItem`'s `textValue` prop is removed.
