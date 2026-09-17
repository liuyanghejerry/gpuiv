---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Deep links. `onOpenUrls` registers the handler for URLs the platform asks the app to open (deep links, files dropped on the Dock icon); `registerUrlScheme(scheme)` registers the app as the handler for a URL scheme such as `myapp://`, resolving on success and rejecting with the platform's reason otherwise (macOS requires 12+, a bundle id, and an installed app; Windows and Linux report unsupported).
