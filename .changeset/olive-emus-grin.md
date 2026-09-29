---
'@gpuiv/native': minor
'@gpuiv/vue': minor
'@gpuiv/packager': minor
---

`registerUrlScheme` now works on Windows and Linux instead of reporting unsupported. GPUI's platform ports leave the claim unimplemented, so the registration is done in GPUIV's own layer with the same per-user story the packager installs: Windows writes `HKCU\Software\Classes\<scheme>` candidate-handler keys (`URL Protocol` marker, quoted open command — the default-protocol claim remains the user's confirmation, Windows hash-protects protocol UserChoice), Linux merges `x-scheme-handler/<scheme>` into a per-user desktop entry and claims it via `xdg-mime`. Delivery (`onOpenUrls`) was already implemented on both platforms. The packager's `register` command also learned `win.urlSchemes` / `linux.urlSchemes` config for packaging-time declaration.
