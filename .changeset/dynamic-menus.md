---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add runtime menu bars via `setMenus(menus, onAction)`. Items fire their `id` back to JS, `system` items keep built-in behaviors (quit, hide, window controls), and `keystroke` items show their key equivalent in the menu. macOS only.
