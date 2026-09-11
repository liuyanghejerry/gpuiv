---
'@gpuiv/vue': minor
---

Restyle the runtime error overlay to match webpack-dev-server.

Title becomes "Uncaught runtime errors:", the message sits in a red-tinted
scroll pane above the frames, frames keep webpack-style indent with a
platform mono font (Menlo / Consolas / DejaVu Sans Mono), the overlay is
near-black `#000000e6` with a bright red Reload button, and empty or
duplicate `Error:` message lines are stripped so the pane shows frames only.
`console.error` now prints the formatted stack once instead of dumping a
second inspect object.
