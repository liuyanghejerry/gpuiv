---
'@gpuiv/vue': patch
---

Keep runtime error observers, overlays, and Reload actions on the window that fails so a secondary window cannot discard the main window's state. Close the current mounted tree after an overlay or reload.
