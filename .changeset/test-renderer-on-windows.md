---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

`TestGpuixRenderer` now runs on **Windows** through DirectX, so Windows users can write GPU-backed tests for their own apps. CI runs the full Vue and example suites on a Windows GPU runner.

| Platform | Test renderer | PNG capture |
|---|---|---|
| macOS | Metal | Yes |
| Windows | DirectX | Yes |
| Linux | Not yet | Waiting for GPUI's wgpu headless renderer |

Also: the test renderer constructor takes an optional window size (`new TestGpuixRenderer(320, 200)`, or `createTestApp(Component, { width, height })`), and the offscreen test window is torn down like a real unmount — tree root cleared, custom element instances destroyed, then one empty frame painted — so entity handles never outlive the app (the gpui leak detector only exposed this once Windows ran the suite).
