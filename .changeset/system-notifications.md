---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

System notifications. `showSystemNotification` posts to the OS notification center (same-tag notifications replace each other where the platform supports it; the effective tag is returned so untagged ones can still be dismissed), `dismissSystemNotification` retracts by tag, and `onSystemNotificationResponse` receives body clicks and action-button presses. `setAppIdentity` sets the process identity Windows attributes toasts to and the user-visible app name. On macOS, notifications only deliver from a packaged `.app` bundle — a bare `bun` process is skipped by the platform's bundle guard.
