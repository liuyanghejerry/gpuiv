---
'@gpuiv/vue': patch
---

Pump macOS input every 8ms instead of 16ms so trackpad events and display-link callbacks are not limited by a 60Hz JavaScript timer. Keep elapsed-work budgeting, dirty-frame coalescing, and the slower Windows/Linux shutdown poll.
