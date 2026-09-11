---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add focus-within APIs and map `visibility: "hidden"` to GPUI `invisible()`.

- `getFocusedElementId()` returns the host id of the focused element, or `null`
- `focusNextWithin(elementId)` / `focusPreviousWithin(elementId)` move focus to
  the next / previous tab stop inside that subtree, wrapping in it — the
  primitive behind modal focus traps
- `visibility: "hidden"` now skips painting while keeping the layout box
  (maps onto GPUI `invisible()`)

The walk reads GPUI's painted TabStopMap (`focus_next_among` /
`focus_prev_among`), so it needs the zed submodule bump that ships with this
change.
