---
'@gpuiv/native': patch
---

Fix the `setMenus` test bridge rejecting submenu items: the recorded-menus validation now converts the submenu alongside its root, so a `submenu`-only item records instead of erroring.
