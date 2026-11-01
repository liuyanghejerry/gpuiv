---
'@gpuiv/vue': minor
---

Add `app.recordVideo({ path, fps })` to the automation client. Capture frame-exact MP4, WebM, or GIF recordings with `video.frame()` and `video.wait(ms)`, then encode with ffmpeg and resume the native clock using `video.stop()`.
