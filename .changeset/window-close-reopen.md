---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add window close interception and Dock relaunch observers: `createApp(App, { onWindowShouldClose })` cancels an OS close attempt and hands the decision to JS, which confirms with the new `closeWindow()`; `onReopen` fires when the running app is relaunched from the Dock icon (macOS).
