---
'@gpuiv/vue': patch
---

Render the `ComboboxValue` scoped slot. The slot check used the React `children.length` idiom on a Vue slot function, whose arity is always 0 after Vue's normalization, so the slot never ran and the raw value (or placeholder) was always shown. Any provided slot now receives the current value and its content is rendered.
