# @gpuiv/vue

Build native desktop applications with Vue 3, TypeScript, and [GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui), the UI framework behind Zed. GPUIV renders through Metal, DirectX, or Vulkan without embedding Chromium, a browser DOM, or a WebView.

The package includes the Vue custom renderer, native components and desktop APIs, prebuilt native binaries through [`@gpuiv/native`](https://www.npmjs.com/package/@gpuiv/native), and testing and automation helpers.

## Install

Install [Bun](https://bun.sh), then add GPUIV and Vue to your application:

```bash
bun add @gpuiv/vue vue
```

Configure the JSX transform in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "vue",
    "strict": true,
    "skipLibCheck": true
  }
}
```

For editor and `tsc` checks, copy the [native JSX declarations](https://github.com/liuyanghejerry/gpuiv/blob/main/examples/shims.d.ts) into your project as `gpuiv.d.ts`.

## Create an app

```tsx
import { defineComponent, ref } from 'vue'
import { createApp } from '@gpuiv/vue'

const App = defineComponent({
  setup() {
    const count = ref(0)
    return () => (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 16,
        padding: 32, width: '100%', height: '100%',
        backgroundColor: '#18181b', color: '#fafafa',
      }}>
        <text style={{ fontSize: 24, fontWeight: 600 }}>Hello, GPUIV</text>
        <div
          onClick={() => count.value++}
          style={{ padding: 16, borderRadius: 12, backgroundColor: '#2563eb' }}
        >
          <text>{`Count: ${count.value}`}</text>
        </div>
      </div>
    )
  },
})

createApp(App, { title: 'My first GPUIV app', width: 640, height: 400 })
```

Run the app with hot reload:

```bash
bun --hot app.tsx
```

GPUIV uses native elements and a supported subset of CSS-style properties. Use `<div>` for layout and `<text>` for painted content; it is not a drop-in renderer for existing HTML applications.

## What's included

- Native Markdown display and editing, syntax highlighting, diffs, ANSI logs, virtualized lists, and selectable text
- Headless Button, Dialog, Select, Combobox, Tooltip, Collapsible, motion, and presence components
- Multiple windows, native inputs and IME, file dialogs, clipboard, menus, tray icons, notifications, global shortcuts, and deep links
- Playwright-like automation, GPU-backed screenshots on macOS and Windows, and deterministic animation-frame capture
- Desktop packaging through [`@gpuiv/packager`](https://www.npmjs.com/package/@gpuiv/packager) and themed components through [`@gpuiv/animal-island`](https://www.npmjs.com/package/@gpuiv/animal-island)

## Documentation

- [Full quick start and examples](https://github.com/liuyanghejerry/gpuiv#quick-start)
- [Elements, styles, events, components, and desktop APIs](https://github.com/liuyanghejerry/gpuiv/blob/main/docs/reference.md)
- [Testing and automation](https://github.com/liuyanghejerry/gpuiv/blob/main/docs/reference.md#automation)
- [Packaging](https://github.com/liuyanghejerry/gpuiv/blob/main/docs/reference.md#packaging)
- [Renderer architecture](https://github.com/liuyanghejerry/gpuiv/blob/main/docs/architecture.md)
- [Platform support and feature status](https://github.com/liuyanghejerry/gpuiv/blob/main/docs/status.md)

GPUIV is experimental. macOS, Windows, and Linux are supported; review the [current platform limits](https://github.com/liuyanghejerry/gpuiv#status) before choosing it for an application.

[Apache-2.0](https://github.com/liuyanghejerry/gpuiv/blob/main/LICENSE)
