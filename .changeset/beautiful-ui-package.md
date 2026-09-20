---
'@gpuiv/beautiful-ui': minor
'@gpuiv/native': minor
---

建立 @gpuiv/beautiful-ui 子包，迁移 beautiful-ui Phase A 组件。

包含 tokens、theme、motion 基础设施，以及 atoms (Button、Chip、EntityChip、ValuePill、Shimmer、StreamText) 和 primitives (ContextCards、SearchList、FilterTable、RecommendationCard、ChatComposer、CodeBlock、LoadingState)。

构建验证：`npx tsc --noEmit` 零错误，`bun run build` 通过，0 处 `any` 类型。
