---
'@gpuiv/vue': minor
---

Add app packaging: `@gpuiv/packager` (new workspace package) turns an app into a distributable product — a macOS `.app` (plist, icon, ad-hoc codesign, zip) and a Windows portable GUI exe (icon + version info, zip) — by compiling with `bun build --compile` and pinning exactly one native binding into the executable. Every build smoke-tests its own artifact through the automation protocol. `@gpuiv/vue` gains `isPackaged()` and `resourcesPath()` for packaged-app contexts. Design record: `docs/packaging-plan.md`.
