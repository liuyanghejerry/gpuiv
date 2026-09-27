---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add the `outline` style: a line outside the border box that takes no layout space, like CSS `outline`. Accepts `{ width, color, offset? }`; `offset` may be negative to draw the line inside. Combined with `focus`-visible styling it draws a focus ring that moves nothing, which a border cannot. Backed by `Style::outline` in the zed fork (`c0d597fd`), with the submodule bump also picking up keyboard-modality pointer-jitter suppression, duplicate tab-stop dedupe and test-window activation.
