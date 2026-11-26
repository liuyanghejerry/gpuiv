---
'@gpuiv/vue': patch
---

Emit a one-time dev-mode warning when a plain scroll `<div>` retains more than 300 children, pointing to `<virtual-list>`. Silent in production (`NODE_ENV=production`).
