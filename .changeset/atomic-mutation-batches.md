---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Require atomic renderer mutation batches, and decode them into typed ops with styles shared by content.

The renderer no longer exposes separate `createElement`, `setStyle`, `setText`, `setCustomProp`, or `commitMutations` calls. Vue collects these operations and sends one validated `applyBatch(json)` batch per flush, on the live window and in the test renderer.

**Breaking (renderer/test API):** `TestGpuixRenderer` and the `NativeRenderer` TypeScript interface lost the per-op mutation methods; drive mutations through `applyBatch` (the Vue host config and `createTestApp` already do). The wire format is now nine ops; `removeChild` and `setCustomPropValue` are gone (`destroyElement` unlinks from its parent in Rust), and `setStyle` / `setCustomProp` carry raw JSON values instead of nested JSON strings.

Rust now decodes a batch straight from its JSON bytes into typed ops — strings borrow from the input, styles stay raw until apply — and hash-conses identical style payloads into shared `Arc`s before applying, so a failed batch leaves no residue. On the 10k-turn chat benchmark (221k ops), parse+apply drops from ~127 ms to ~30 ms and the retained tree from ~225 MB to ~43 MB.
