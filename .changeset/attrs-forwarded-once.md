---
'@gpuiv/vue': patch
---

Fix user event handlers firing twice on `Select`, `Combobox`, `Tooltip`, `VirtualList`, `GpuixCanvas` and `motion.div`. These components forward `$attrs` by hand and still let Vue merge the same attrs onto their root element, which chains an overridden handler with the user's copy. A user `onKeyDown` on `SelectContent` ran twice per key, as did `onMouseDownOutside` on the Select/Combobox content and `onMouseEnter`/`onMouseLeave` on the Tooltip parts. Attributes are now forwarded exactly once.
