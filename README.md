# GPUIV

**Build GPUI-based desktop apps with Vue 3 and TypeScript — without a browser shell.**

**English** · [简体中文](README.zh-CN.md)

GPUIV is a Vue 3 custom renderer for [GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui), the UI framework behind Zed. Write your application with Vue components, reactivity, and TSX; GPUI handles flexbox layout and GPU painting through Metal, DirectX, or Vulkan. No browser DOM, Chromium, or WebView is involved in rendering.

[![CI](https://github.com/liuyanghejerry/gpuiv/actions/workflows/ci.yml/badge.svg)](https://github.com/liuyanghejerry/gpuiv/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@gpuiv/vue)](https://www.npmjs.com/package/@gpuiv/vue)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[Why GPUIV?](#why-gpuiv) · [Demos](#examples) · [Quick start](#quick-start) · [API reference](docs/reference.md) · [Build from source](docs/development.md)

<a href="docs/images/readme-chat.png"><img src="docs/images/readme-chat.png" alt="GPUIV chat demo with a sidebar, native diff viewer, and message composer" width="100%" /></a>

*A chat client built from Vue components, with virtualized messages, selectable Markdown, highlighted diffs, animated panels, and a native composer. [Explore the source](examples/chat.tsx) or [run the demo](#run-the-examples). Replies use demo data.*

## Why GPUIV?

GPUIV combines the Vue development model with a direct desktop rendering path. It is especially well suited to AI chat clients, editors, dashboards, and other content-rich developer tools.

| Advantage | What it means in practice |
|---|---|
| **Keep the Vue 3 programming model** | Build with components, reactivity, TypeScript, and TSX. Use Fast Refresh and Vue DevTools while developing; install prebuilt packages without compiling Rust for your app. |
| **Render without a browser shell** | Your interface lives in desktop windows and is laid out and painted by GPUI. There is no embedded Chromium or WebView in the rendering path. |
| **Send only what changed** | Vue diffs component updates, then sends the resulting host mutations to Rust in one atomic batch per flush. Only changed elements cross the JavaScript/Rust boundary; GPUI retains ownership of layout and painting. |
| **Build content-rich tools without starting from scratch** | Use Markdown display and WYSIWYG editing, syntax highlighting, virtualized lists and diffs, ANSI logs, cross-element text selection, native inputs, and IME support. |
| **Integrate with the desktop** | Create multiple windows and use file dialogs, clipboard text and images, menus, tray icons, global shortcuts, notifications, file opening, and deep links from the same application model. |
| **Test the interface users actually see** | Drive native input with Playwright-like automation, inspect painted text, take GPU-backed screenshots, and capture exact animation frames with a deterministic clock. GPU test rendering is available on macOS and Windows. |
| **Target three desktop platforms** | Share your Vue component code across macOS, Windows, and Linux, with Metal, DirectX, and Vulkan rendering backends respectively. See [platform support and current limits](#status). |

## Examples

These screenshots show **real example components rendered by GPUIV**, not design mockups. The committed images were captured with the GPU-backed test renderer on macOS. Click an image to view it at full size.

**[Explore the full Demo Gallery](docs/demo-gallery.md)** for more interaction states, native text rendering, and runnable desktop examples.

<table>
  <tr>
    <th>Native Markdown editor</th>
    <th>Component gallery</th>
  </tr>
  <tr>
    <td width="60%"><a href="docs/images/readme-editor.png"><img src="docs/images/readme-editor.png" alt="Native Markdown editor with mixed Chinese and English text, highlights, task lists, and an outline" width="100%" /></a></td>
    <td width="40%"><a href="docs/images/readme-gallery.png"><img src="docs/images/readme-gallery.png" alt="Beautiful UI gallery with buttons, chips, context cards, and a searchable list" width="100%" /></a></td>
  </tr>
  <tr>
    <td>Edit formatted blocks, switch to Markdown source, search, and navigate by outline. Includes mixed Chinese and English text, tables, tasks, and highlights.<br /><a href="examples/markdown-editor.tsx">Source</a> · <code>bun --hot markdown-editor.tsx</code></td>
    <td>Explore themed buttons, chips, cards, searchable lists, and other application building blocks with light/dark themes.<br /><a href="examples/beautiful-ui.tsx">Source</a> · <code>bun --hot beautiful-ui.tsx</code><br /><em>Beautiful UI is a private workspace demo, not a published package.</em></td>
  </tr>
</table>

### Canvas and custom visuals

<a href="docs/images/readme-canvas.png"><img src="docs/images/readme-canvas.png" alt="Canvas demo comparing hue, saturation, color, luminosity, multiply, screen, overlay, and difference blend modes" width="580" /></a>

Draw and composite through `getContext("2d")`, including paths, gradients, clipping, image data, and W3C blend modes. Export the result as PNG, or combine images and SVG with the rest of your Vue interface.

[Canvas blend source](examples/canvas-blends.tsx) · `bun --hot canvas-blends.tsx` · Try the [paint app](examples/paint.tsx) for brush strokes, shapes, erasing, and undo / redo.

### Run the examples

Clone and [build the repository](docs/development.md#building), then run from `examples/`:

```bash
cd examples
bun --hot chat.tsx
```

| Start here | Run | What to try |
|---|---|---|
| [Counter](examples/counter.tsx) | `bun --hot counter.tsx` | Vue state, click events, and hover styles in a minimal app |
| [Chat](examples/chat.tsx) | `bun --hot chat.tsx` | Switch conversations, collapse the sidebar, open the model picker |
| [Markdown editor](examples/markdown-editor.tsx) | `bun --hot markdown-editor.tsx` | Edit formatted text, toggle a task, switch to source mode |
| [Component gallery](examples/beautiful-ui.tsx) | `bun --hot beautiful-ui.tsx` | Toggle light/dark, explore controls, tables, and a flowchart |
| [Native text](examples/native-text.tsx) | `bun --hot native-text.tsx` | Compare Markdown, code, and native diff rendering |
| [Paint](examples/paint.tsx) | `bun --hot paint.tsx` | Draw, erase, make shapes, undo / redo |
| [ANSI log](examples/ansi-log.tsx) | `bun --hot ansi-log.tsx` | Stream colored output into a selectable virtualized log |
| [Multiple windows](examples/window-resize.tsx) | `bun --hot window-resize.tsx` | Resize two independent desktop windows |

[Browse all examples](examples/), including [error boundaries](examples/error-handling.tsx), [file opening](examples/open-files.tsx), [single-instance apps](examples/single-instance.tsx), and [macOS window vibrancy](examples/blurred-window.tsx). To regenerate the curated screenshots on macOS or Windows, run `bun scripts/screenshots.ts` after building the repository.

## Quick start

Install [Bun](https://bun.sh) and create a project. The npm packages include prebuilt native binaries; you can start an app without compiling Rust.

```bash
mkdir my-gpuiv-app
cd my-gpuiv-app
bun init -y
bun add @gpuiv/vue vue
```

Set these compiler options in `tsconfig.json` so [Bun's JSX transform](https://bun.sh/docs/runtime/jsx) uses Vue:

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

Copy [`examples/shims.d.ts`](examples/shims.d.ts) into your project as `gpuiv.d.ts` for editor and `tsc` checks. Vue's default JSX types describe HTML/SVG; these declarations allow GPUIV's native props and slot children.

Create `app.tsx`:

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
          style={{
            padding: 16, borderRadius: 12, backgroundColor: '#2563eb',
            cursor: 'pointer', hover: { backgroundColor: '#1d4ed8' },
          }}
        >
          <text>{`Count: ${count.value}`}</text>
        </div>
      </div>
    )
  },
})

createApp(App, { title: 'My first GPUIV app', width: 640, height: 400 })
```

Run it:

```bash
bun --hot app.tsx
```

Click to update the counter. Save the file to remount the app in the same desktop window. For component-level Fast Refresh that preserves other components' state, add the [HMR preload](docs/reference.md#hot-reload).

GPUIV uses its own elements and a supported subset of CSS-style properties; it is not a drop-in renderer for existing HTML applications. Start with `<div>` for layout and `<text>` for content, then consult the [elements](docs/reference.md#supported-elements), [styles](docs/reference.md#supported-styles), and [events](docs/reference.md#supported-events) references when adapting an interface.

## How it works

```text
Vue 3 components and state
          │ changed host mutations, one atomic batch per flush
          ▼
napi-rs → Rust RetainedTree → GPUI layout and GPU painting
                              ├─ Metal   (macOS)
                              ├─ DirectX (Windows)
                              └─ Vulkan  (Linux)
```

Vue computes the update; Rust retains the element tree; GPUI builds the frame. Input events travel in the opposite direction, from GPUI back to your Vue handlers. Read the [renderer architecture](docs/architecture.md) for the mutation protocol, retained tree, and event flow.

## Status

GPUIV is an experimental, self-maintained Vue 3 fork. It is suitable for exploring GPUI-based desktop interfaces; check platform-specific APIs and the [full feature checklist](docs/status.md) before choosing it for your app.

| Platform | Renderer | Prebuilt binaries | GPU tests / screenshots |
|---|---|---|---|
| macOS | Metal | Apple Silicon and Intel | Available |
| Windows | DirectX | ARM64 and x64 | Available |
| Linux | Vulkan | ARM64 and x64 (GNU) | Not yet; live-window automation works |

Menus and vibrancy are macOS-specific; global shortcuts and tray icons/menus currently support macOS and Windows. On Linux the native addon enables both Wayland and X11: GPUI selects Wayland when `WAYLAND_DISPLAY` is non-empty, otherwise X11 when `DISPLAY` is; to force X11 under XWayland start with `env -u WAYLAND_DISPLAY`. Application windows and live-window automation work on both backends, but the offscreen GPU test renderer and its PNG capture remain unavailable on Linux. Wayland also supports layer-shell surfaces for panels, docks, and wallpapers.

Nested scrolling is currently unsupported. App packaging is a workspace tool for macOS `.app` bundles, Windows portable executables, and Linux x64/ARM64 `.tar.gz` archives; signing, notarization, Linux AppImage output, and Linux self-update are still pending. See [packaging](docs/reference.md#packaging) and the [full feature checklist](docs/status.md) for current boundaries.

## Documentation

| I want to… | Go to |
|---|---|
| Look up a component, style, or event | [API reference](docs/reference.md) |
| Automate and test my app | [Automation](docs/reference.md#automation) · [GPU-backed tests](docs/reference.md#testing) |
| Debug updates or enable Fast Refresh | [Runtime errors](docs/reference.md#runtime-errors) · [Hot reload](docs/reference.md#hot-reload) · [Vue DevTools](docs/reference.md#vue-devtools) |
| Package a desktop app | [Packaging guide](docs/reference.md#packaging) |
| Understand Vue → Rust → GPUI | [Renderer architecture](docs/architecture.md) |
| Build or contribute to GPUIV | [Development guide](docs/development.md) · [Contributor rules](AGENTS.md) |
| Check support and known gaps | [Feature status](docs/status.md) · [Upstream tracking](docs/upstream/README.md) |

## Relationship to upstream GPUIX

GPUIV is a self-maintained fork of [remorses/gpuix](https://github.com/remorses/gpuix), created for experimentation and learning. Upstream GPUIX provides Node.js and React bindings for GPUI; this fork replaces the React-facing package with a Vue 3 custom renderer, published as `@gpuiv/vue` and `@gpuiv/native`.

The Rust/napi-rs layer, retained tree, mutation protocol, native elements, and testing approach originate in GPUIX. The fork's synced changes and deliberate differences are recorded in [the upstream ledger](docs/upstream/README.md). Ported code from Comet and other projects is credited in [third-party notices](THIRD_PARTY_NOTICES.md).

## License

[Apache-2.0](LICENSE)
