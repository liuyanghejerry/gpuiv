---
'@gpuiv/vue': patch
---

Keep the renderer injection key stable across Bun hot reloads so updated components retain access to their existing window's renderer.
