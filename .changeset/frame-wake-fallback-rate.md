---
'@gpuiv/vue': patch
---

Fix live automation flaking after the display-link frame loop: a lost wake (macOS stops display-link delivery to occluded windows) now falls back to the platform's default poll rate instead of 100ms, so a tree paints within one poll after a commit and locator clicks reading last-painted bounds no longer race the first paint. `launch()` also pipes the live child's stderr through to the test output instead of dropping it, so a misbehaving child is visible in CI logs.
