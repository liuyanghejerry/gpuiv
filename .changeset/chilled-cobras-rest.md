---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Tray support: `setTray(renderer, { iconPath, tooltip?, template? }, onClick?)` installs the process tray (macOS `NSStatusItem` via GPUIV-owned platform code — GPUI has no tray API — and Windows `Shell_NotifyIconW` on a message-only window), `clearTray(renderer)` removes it. One tray per process (a second `setTray` replaces the first); `onClick` fires on a tray click. `template: true` renders a monochrome macOS menu-bar template; Windows loads `.ico` (other formats best-effort). Linux reports unsupported (StatusNotifierItem/DBus not implemented) and a tray menu is not offered yet — clicks are the whole surface.
