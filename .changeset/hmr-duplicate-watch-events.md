---
'@gpuiv/vue': patch
---

Harden Fast Refresh against duplicate watch reports. Bun's Windows watcher can report one save more than once; a re-evaluation whose content matches the just-applied generation previously took the classic-remount path and discarded the state the in-place reload had preserved. The HMR runtime now recognizes an identical re-evaluation directly behind a changed one (within a 50 ms coalescing window) and keeps the live tree; an asset save — identical hashes with no just-applied change — still remounts so the new data is applied. The remount e2e that exposed this skips on Windows, where bun additionally delivers a stale pre-write evaluation no runtime-side change can absorb (documented in the test).
