---
'@gpuiv/native': patch
---

Fix blurry text on Windows when display scaling is above 100%.

GPUI only declares **Per-Monitor V2** DPI awareness in the host executable manifest ([zed#8936](https://github.com/zed-industries/zed/pull/8936)). GPUIV is a napi `.node` loaded into `node.exe` / `bun.exe`, so that manifest never applies and Windows bitmap-stretched the window. The UI thread now requests Per-Monitor V2 awareness itself before creating any window.

Upstream: remorses/gpuix#31
