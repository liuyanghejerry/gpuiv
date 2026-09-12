---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add runtime window controls: `toggleFullscreen()`, `isFullscreen()`, and
`minimizeWindow()` (GPUI `Window::toggle_fullscreen` / `is_fullscreen` /
`minimize_window`). The test renderer records the fullscreen parity and
minimize count, because the offscreen test window applies fullscreen through
async AppKit animation. Part of the issue #49 P1 app-shell gap work.
