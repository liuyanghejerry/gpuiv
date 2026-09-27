---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

`<text>` accepts a `runs` prop for inline-styled segments: `runs={[{ text: "plain " }, { text: "bold", fontWeight: 700 }, { text: "err", underline: { wavy: true } }]}`. The runs replace any string children, including when the array is empty; non-text children remain. Per-segment `color`, `fontWeight`, `fontStyle`, `fontFamily`, `underline`, `strikethrough` and `backgroundColor` are supported; unset attributes fall back to the element's own style. Selection, search and copy keep working because they key off the concatenated string. Per-run font size is deliberately not offered — a size change would reflow the line.
