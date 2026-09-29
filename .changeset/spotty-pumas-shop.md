---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Interactive task lists in read-only `<markdown>`: `- [ ]` / `- [x]` items now render a real checkbox in the marker column instead of the literal `[x]` text. Clicking a checkbox fires a new `onTaskToggle` event carrying the marker's rendered state (`value`) and its byte offsets in `source` (`startIndex`/`endIndex`), so apps flip `[ ]`↔`[x]` in place and re-render. Checkbox geometry (`mdTaskBoxSide`, `mdTaskBoxRadius`, `mdTaskStroke`) joins the theme metrics. Ordered task items keep the number and paint the marker literally.
