---
'@gpuiv/vue': patch
---

Keep Fast Refresh state when a watcher reports one save twice. Bun's Windows file watcher can fire two events for a single write; the second, byte-identical re-evaluation previously took the classic-remount path in `createApp` and discarded the state the in-place reload had just preserved — every save on Windows lost Fast Refresh. The HMR runtime now recognizes an identical re-evaluation that immediately follows a changed one (within a 50 ms coalescing window) as a duplicate report and keeps the live tree; an asset save — identical entry hashes with no just-applied change behind them — still remounts so the new data is applied.
