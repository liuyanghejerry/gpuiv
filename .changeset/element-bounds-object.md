---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

**BREAKING:** `getElementBounds` returns `{ x, y, width, height }` instead of `[x, y, width, height]`.

The array form could not grow — extra fields like scroll offsets would have had to sit at magic indexes. The native napi method, `TestGpuixRenderer`, the Vue `TestRenderer`/`app.renderer` facade, and the live automation client all use named fields now. Update destructuring call sites:

```diff
-const [x, y, width, height] = renderer.getElementBounds(id)!
+const { x, y, width, height } = renderer.getElementBounds(id)!
```
