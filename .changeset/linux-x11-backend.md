---
'@gpuiv/native': patch
---

Enable GPUI's Wayland and X11 compositor-selection features explicitly on Linux. Our builds already inherited them through `gpui_linux`'s feature forwarding (and through `test-support`), so nothing was broken here, but published `--no-default-features` release builds now pin them independently of that chain — the same hardening upstream applied after their X11 builds silently opened no window (`cd9493a`, their #93). GPUI selects Wayland when `WAYLAND_DISPLAY` is non-empty, otherwise X11 when `DISPLAY` is; to force X11 under XWayland start with `env -u WAYLAND_DISPLAY`.
