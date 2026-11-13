# @gpuiv/native

Prebuilt native bindings for [GPUIV](https://github.com/liuyanghejerry/gpuiv), a Vue 3 custom renderer for [GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui). This package connects the JavaScript renderer to GPUI through napi-rs and ships binaries for macOS, Windows, and Linux.

Most applications should install [`@gpuiv/vue`](https://www.npmjs.com/package/@gpuiv/vue), which depends on this package automatically. Install `@gpuiv/native` directly only when using the low-level renderer API or native types.

```bash
bun add @gpuiv/native
```

```ts
import { GpuixRenderer } from '@gpuiv/native'

const renderer = new GpuixRenderer()
```

The higher-level `createApp` API from `@gpuiv/vue` handles renderer initialization, window ownership, the frame loop, and Vue event delivery for you.

## Supported platforms

| Platform | Architectures | Rendering backend |
| --- | --- | --- |
| macOS | Apple Silicon, Intel | Metal |
| Windows | ARM64, x64 | DirectX |
| Linux (GNU) | ARM64, x64 | Vulkan |

The platform-specific binaries are installed through optional dependencies. GPU-backed test rendering and screenshots are available on macOS and Windows; Linux release binaries support application windows and live automation, but not the offscreen test renderer.

## Documentation

- [GPUIV quick start](https://github.com/liuyanghejerry/gpuiv#quick-start)
- [API reference](https://github.com/liuyanghejerry/gpuiv/blob/main/docs/reference.md)
- [Renderer architecture](https://github.com/liuyanghejerry/gpuiv/blob/main/docs/architecture.md)
- [Platform support and current limits](https://github.com/liuyanghejerry/gpuiv#status)
- [Source and development guide](https://github.com/liuyanghejerry/gpuiv/blob/main/docs/development.md)

GPUIV is experimental. Check the [feature status](https://github.com/liuyanghejerry/gpuiv/blob/main/docs/status.md) before choosing it for an application.

[Apache-2.0](https://github.com/liuyanghejerry/gpuiv/blob/main/LICENSE)
