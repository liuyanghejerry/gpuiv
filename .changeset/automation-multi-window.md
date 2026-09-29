---
'@gpuiv/vue': minor
---

Every `createWindow()` window now answers on the automation session: `app.window(index)` returns a view whose locators address that window's tree (window 0 is the main window, the default for existing code). The stdio bus routes each request by its window index to that window's backend, and an index that never opened fails fast with `NotFound` instead of hanging. In-process `connectTest` sessions are unchanged.
