---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Global shortcuts: `registerGlobalShortcut(renderer, accelerator, onTrigger?)` arms a system-wide hotkey that works with any app focused; registering the same accelerator again replaces it, and `unregisterGlobalShortcut(renderer, accelerator)` removes it. Accelerators are `'+'`-separated modifiers (`ctrl`, `alt`/`option`, `shift`, `cmd`/`win`/`super`) then one key (`a`–`z`, `0`–`9`, `f1`–`f12`). macOS uses Carbon `RegisterEventHotKey` (no accessibility permission needed, the AppKit loop pumps Carbon events); Windows uses `RegisterHotKey` on a message-only window (a combination another app claimed fails with a clear error). Linux reports unsupported — X11 `XGrabKey` does not survive Wayland.
