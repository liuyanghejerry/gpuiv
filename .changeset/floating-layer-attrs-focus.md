---
'@gpuiv/vue': patch
---

Fix `FloatingLayer` duplicating fallthrough attrs onto its `anchored` root in addition to the content div. `tabIndex`/`autoFocus` landing on both elements raced for popup focus, and when the `anchored` element won, keyboard navigation in `SelectContent` was silently swallowed.
