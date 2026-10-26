# GPUIV

**使用 Vue 3 和 TypeScript 构建基于 GPUI 的桌面应用，无需浏览器外壳。**

[English](README.md) · **简体中文**

GPUIV 是面向 [GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui) 的 Vue 3 自定义渲染器。GPUI 是 Zed 编辑器背后的 UI 框架。你可以使用 Vue 组件、响应式状态和 TSX 编写应用，由 GPUI 负责 Flexbox 布局，并通过 Metal、DirectX 或 Vulkan 进行 GPU 绘制。整个渲染路径不依赖浏览器 DOM、Chromium 或 WebView。

[![CI](https://github.com/liuyanghejerry/gpuiv/actions/workflows/ci.yml/badge.svg)](https://github.com/liuyanghejerry/gpuiv/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@gpuiv/vue)](https://www.npmjs.com/package/@gpuiv/vue)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[核心优势](#核心优势) · [Demo 与截图](#demo-与截图) · [快速上手](#快速上手) · [API 参考](docs/reference.md) · [从源码构建](docs/development.md)

<a href="docs/images/readme-chat.png"><img src="docs/images/readme-chat.png" alt="GPUIV 聊天 Demo，包含侧栏、原生 Diff 视图和消息输入框" width="100%" /></a>

*用 Vue 组件构建的聊天客户端：虚拟化消息列表、可选择的 Markdown、代码高亮 Diff、动画面板和原生输入框。[查看源码](examples/chat.tsx)或[运行 Demo](#运行示例)。聊天回复使用演示数据。*

## 核心优势

GPUIV 将 Vue 的开发模型与直接的桌面渲染路径结合起来，尤其适合 AI 聊天客户端、编辑器、仪表盘，以及其他内容密集的开发者工具。

| 优势 | 对开发者的实际意义 |
|---|---|
| **延续 Vue 3 开发体验** | 使用组件、响应式状态、TypeScript 和 TSX 构建界面；开发时可使用 Fast Refresh 和 Vue DevTools；通过预编译 npm 包快速开始，无需为应用编译 Rust。 |
| **不依赖浏览器外壳** | 界面运行在桌面窗口中，由 GPUI 直接完成布局和绘制，渲染路径中不需要嵌入 Chromium 或 WebView。 |
| **只传递发生变化的内容** | Vue 对组件更新做差异计算，每次刷新将产生的宿主变更合并为一个原子批次发送给 Rust。只有变化的元素会跨越 JavaScript/Rust 边界，布局和绘制仍由 GPUI 负责。 |
| **面向富内容应用的内置能力** | 直接使用 Markdown 展示与所见即所得编辑、语法高亮、虚拟化列表和 Diff、ANSI 日志、跨元素文本选择、原生输入框及 IME 支持，无需从零组装这些基础能力。 |
| **接入完整桌面工作流** | 在同一套应用模型中使用多窗口、文件对话框、文本与图片剪贴板、菜单、托盘图标、全局快捷键、系统通知、文件打开和 Deep Link。 |
| **测试用户真正看到的界面** | 通过类似 Playwright 的自动化 API 驱动原生输入、检查实际绘制文本、截取 GPU 渲染画面，并用确定性时钟捕获指定动画帧。GPU 测试渲染目前支持 macOS 和 Windows。 |
| **一套组件代码覆盖三个桌面平台** | 在 macOS、Windows 和 Linux 间共享 Vue 组件，分别使用 Metal、DirectX 和 Vulkan 渲染后端。具体支持与限制见[平台状态](#项目状态与平台支持)。 |

## Demo 与截图

以下截图均为 **GPUIV 实际运行示例组件的渲染结果**，不是设计稿或概念图。当前提交的图片通过 GPU 测试渲染器在 macOS 上截取。点击图片可查看原尺寸。

**[查看完整 Demo Gallery](docs/demo-gallery.zh-CN.md)**，了解更多交互状态、原生文本渲染和可运行的桌面示例。

<table>
  <tr>
    <th>原生 Markdown 编辑器</th>
    <th>组件库 Gallery</th>
  </tr>
  <tr>
    <td width="60%"><a href="docs/images/readme-editor.png"><img src="docs/images/readme-editor.png" alt="原生 Markdown 编辑器，包含中英混排、高亮、任务列表和大纲" width="100%" /></a></td>
    <td width="40%"><a href="docs/images/readme-gallery.png"><img src="docs/images/readme-gallery.png" alt="Beautiful UI 组件库，包含按钮、标签、上下文卡片和可搜索列表" width="100%" /></a></td>
  </tr>
  <tr>
    <td>编辑富文本块、切换 Markdown 源码、搜索内容并通过大纲导航，支持中英混排、表格、任务和高亮。<br /><a href="examples/markdown-editor.tsx">源码</a> · <code>bun --hot markdown-editor.tsx</code></td>
    <td>浏览按钮、标签、卡片、搜索列表等应用构建块，体验亮色与暗色主题。<br /><a href="examples/beautiful-ui.tsx">源码</a> · <code>bun --hot beautiful-ui.tsx</code><br /><em>Beautiful UI 是仓库内私有 workspace 示例，不作为公开 npm 包发布。</em></td>
  </tr>
</table>

### Canvas 与自定义视觉

<a href="docs/images/readme-canvas.png"><img src="docs/images/readme-canvas.png" alt="Canvas Demo，对比色相、饱和度、颜色、亮度、正片叠底、滤色、叠加和差值混合模式" width="580" /></a>

通过 `getContext("2d")` 绘制和合成图形，支持路径、渐变、裁剪、像素数据及 W3C 混合模式，并可导出 PNG。也可以将图片、SVG 与其他 Vue 界面组合使用。

[Canvas 混合模式源码](examples/canvas-blends.tsx) · `bun --hot canvas-blends.tsx` · 或体验[画图应用](examples/paint.tsx)的画笔、图形、橡皮擦与撤销/重做。

### 运行示例

克隆并[从源码构建仓库](docs/development.md#building)，然后在 `examples/` 目录下运行：

```bash
cd examples
bun --hot chat.tsx
```

| 示例 | 运行命令 | 可以体验什么 |
|---|---|---|
| [Counter](examples/counter.tsx) | `bun --hot counter.tsx` | 最小应用中的 Vue 状态、点击事件和悬停样式 |
| [Chat](examples/chat.tsx) | `bun --hot chat.tsx` | 切换会话、折叠侧栏、打开模型选择器 |
| [Markdown 编辑器](examples/markdown-editor.tsx) | `bun --hot markdown-editor.tsx` | 编辑富文本、切换任务状态、切换源码模式 |
| [组件库 Gallery](examples/beautiful-ui.tsx) | `bun --hot beautiful-ui.tsx` | 切换明暗主题，体验控件、表格和流程图 |
| [Native Text](examples/native-text.tsx) | `bun --hot native-text.tsx` | 对比 Markdown、代码和原生 Diff 渲染 |
| [画图](examples/paint.tsx) | `bun --hot paint.tsx` | 绘画、擦除、创建图形、撤销与重做 |
| [ANSI 日志](examples/ansi-log.tsx) | `bun --hot ansi-log.tsx` | 将彩色输出流式写入可选择文本的虚拟化日志 |
| [多窗口](examples/window-resize.tsx) | `bun --hot window-resize.tsx` | 调整两个独立桌面窗口的大小 |

[浏览全部示例](examples/)，还包括[错误边界](examples/error-handling.tsx)、[文件打开](examples/open-files.tsx)、[单实例应用](examples/single-instance.tsx)和 [macOS 窗口毛玻璃效果](examples/blurred-window.tsx)。完成源码构建后，可在 macOS 或 Windows 上运行 `bun scripts/screenshots.ts` 重新生成这组精选截图。

## 快速上手

安装 [Bun](https://bun.sh) 并创建项目。npm 包包含预编译原生二进制文件，无需编译 Rust 即可启动应用。

```bash
mkdir my-gpuiv-app
cd my-gpuiv-app
bun init -y
bun add @gpuiv/vue vue
```

在 `tsconfig.json` 中设置以下编译选项，让 [Bun 的 JSX 转换](https://bun.sh/docs/runtime/jsx)使用 Vue：

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

将 [`examples/shims.d.ts`](examples/shims.d.ts) 复制到项目中并命名为 `gpuiv.d.ts`，用于编辑器提示和 `tsc` 检查。Vue 默认的 JSX 类型描述的是 HTML/SVG，这些声明补充了 GPUIV 的原生属性和插槽子节点。

创建 `app.tsx`：

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

运行应用：

```bash
bun --hot app.tsx
```

点击按钮即可更新计数。保存文件后，应用会在同一个桌面窗口中重新挂载。如果希望在组件级 Fast Refresh 时保留其他组件的状态，请添加 [HMR 预加载](docs/reference.md#hot-reload)。

GPUIV 使用自己的元素和受支持的 CSS 风格属性子集，并不是现有 HTML 应用的直接替代品。布局从 `<div>` 开始，文字使用 `<text>`；迁移界面时请查阅[元素](docs/reference.md#supported-elements)、[样式](docs/reference.md#supported-styles)和[事件](docs/reference.md#supported-events)参考。

## 工作原理

```text
Vue 3 组件与状态
          │ 变化的宿主变更，每次刷新合并为一个原子批次
          ▼
napi-rs → Rust RetainedTree → GPUI 布局与 GPU 绘制
                              ├─ Metal   (macOS)
                              ├─ DirectX (Windows)
                              └─ Vulkan  (Linux)
```

Vue 负责计算更新，Rust 保存元素树，GPUI 构建每一帧。输入事件沿相反方向从 GPUI 回到 Vue 事件处理函数。关于变更协议、保留树和事件流的细节，请阅读[渲染器架构](docs/architecture.md)。

## 项目状态与平台支持

GPUIV 是一个实验性、独立维护的 Vue 3 分支，适合探索基于 GPUI 的桌面界面。在将其用于自己的应用之前，请检查各平台 API 和[完整功能清单](docs/status.md)。

| 平台 | 渲染器 | 预编译二进制 | GPU 测试与截图 |
|---|---|---|---|
| macOS | Metal | Apple Silicon 和 Intel | 已支持 |
| Windows | DirectX | ARM64 和 x64 | 已支持 |
| Linux | Vulkan | ARM64 和 x64（GNU） | 暂未支持；真实窗口自动化可用 |

菜单和窗口毛玻璃效果仅支持 macOS；全局快捷键和托盘图标/菜单目前支持 macOS 与 Windows。Linux 原生扩展同时启用 Wayland 和 X11：`WAYLAND_DISPLAY` 非空时 GPUI 选择 Wayland，否则在 `DISPLAY` 非空时选择 X11；如需在 XWayland 下强制使用 X11，请通过 `env -u WAYLAND_DISPLAY` 启动。应用窗口和基于真实窗口的自动化测试在两种后端上均可运行，但 Linux 仍没有离屏 GPU 测试渲染器及其 PNG 截图能力。Wayland 还支持用于面板、Dock 和壁纸的 layer-shell 表面。

目前不支持嵌套滚动。应用打包工具位于仓库 workspace 中，可生成 macOS `.app`、Windows 便携可执行文件，以及 Linux x64/ARM64 `.tar.gz` 压缩包；签名、公证、Linux AppImage 输出和 Linux 自更新仍待完成。更多边界请查阅[打包文档](docs/reference.md#packaging)和[完整功能清单](docs/status.md)。

## 文档导航

| 我想要…… | 查看文档 |
|---|---|
| 查询组件、样式或事件 | [API 参考](docs/reference.md) |
| 自动化测试应用 | [自动化 API](docs/reference.md#automation) · [GPU 测试](docs/reference.md#testing) |
| 调试更新或启用 Fast Refresh | [运行时错误](docs/reference.md#runtime-errors) · [热更新](docs/reference.md#hot-reload) · [Vue DevTools](docs/reference.md#vue-devtools) |
| 打包桌面应用 | [打包指南](docs/reference.md#packaging) |
| 理解 Vue → Rust → GPUI | [渲染器架构](docs/architecture.md) |
| 构建或参与贡献 | [开发指南](docs/development.md) · [贡献规则](AGENTS.md) |
| 查看支持范围和已知缺口 | [功能状态](docs/status.md) · [上游跟踪](docs/upstream/README.md) |

## 与上游 GPUIX 的关系

GPUIV 是 [remorses/gpuix](https://github.com/remorses/gpuix) 的独立维护分支，最初用于实验和学习。上游 GPUIX 提供 GPUI 的 Node.js 与 React 绑定；本分支将面向 React 的包替换为 Vue 3 自定义渲染器，并发布为 `@gpuiv/vue` 和 `@gpuiv/native`。

Rust/napi-rs 层、保留树、变更协议、原生元素和测试方法源自 GPUIX。已同步的修改与有意保留的差异记录在[上游跟踪台账](docs/upstream/README.md)中；来自 Comet 等项目的移植代码已在[第三方声明](THIRD_PARTY_NOTICES.md)中注明。

## 许可证

[Apache-2.0](LICENSE)
