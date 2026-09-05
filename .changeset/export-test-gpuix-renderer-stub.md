---
'@gpuiv/native': patch
'@gpuiv/vue': patch
---

Export `TestGpuixRenderer` on every platform. Construction on Linux (or any build without the GPU test renderer) throws instead of failing with `TypeError: TestGpuixRenderer is not a constructor`.

```ts
import { TestGpuixRenderer } from '@gpuiv/native'

// macOS / Windows with test-support: constructs the GPU test renderer
// Linux: throws, because wgpu cannot read a rendered image back yet
new TestGpuixRenderer()
```

Upstream: remorses/gpuix#30
