---
'@gpuiv/vue': patch
---

Fix `Select` losing keyboard focus after choosing an item. Selecting closed the popup through the raw state setter, so the focused content element was destroyed without focus returning to the trigger: ArrowDown no longer reopened the menu and Tab order started over. Enter/Space selection now restores focus to the trigger, as Escape already did.
