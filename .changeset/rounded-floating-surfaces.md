---
'@gpuiv/vue': patch
---

`FloatingLayer` now copies border radii (uniform and per-corner), `visibility`, and `opacity` — including their hover/active refinements — onto its outer anchored surface, so the fallback fill no longer shows square corners behind rounded Select/Combobox/Tooltip popups and nested opacity no longer multiplies against that fill. `pointerEvents: "none"` now disables the anchored occluder so hidden or non-interactive overlays do not steal hits.
