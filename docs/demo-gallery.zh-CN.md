# GPUIV Demo Gallery

**看看你能用 Vue 3 和 GPUI 构建什么。**

[English](demo-gallery.md) · **简体中文** · [返回 README](../README.zh-CN.md)

本页每张图片都来自 GPUIV 的真实示例或 GPU 可视化测试，不是设计稿或概念图。点击图片可查看原尺寸。聊天回复和文档内容使用演示数据。

[从源码构建仓库](development.md#building)后，在 `examples/` 目录下运行本文的应用命令；可视化测试命令则需要从仓库根目录运行。第一次接触 GPUIV？请先查看[快速上手](../README.zh-CN.md#快速上手)。

## AI 聊天工作区

<a href="images/readme-chat.png"><img src="images/readme-chat.png" alt="GPUIV 聊天工作区，包含会话列表、Markdown 消息、代码高亮 Diff 和输入框" width="100%" /></a>

使用虚拟化消息历史、可选择的 Markdown、代码高亮 Diff、动画面板和原生文本输入，构建 AI 聊天客户端或编程助手。可以体验切换会话、选择文本、折叠侧栏和打开模型选择器。

**源码：**[`examples/chat.tsx`](../examples/chat.tsx) · **运行：**`bun --hot chat.tsx`

<table>
  <tr>
    <th>原生模型选择器</th>
    <th>可折叠工作区</th>
  </tr>
  <tr>
    <td width="50%"><a href="images/chat-model-picker.png"><img src="images/chat-model-picker.png" alt="聊天 Demo 中展开的分组模型选择器" width="100%" /></a></td>
    <td width="50%"><a href="images/chat-sidebar-collapsed.png"><img src="images/chat-sidebar-collapsed.png" alt="侧栏折叠后的聊天 Demo" width="100%" /></a></td>
  </tr>
  <tr>
    <td>通过 Headless Select 原语实现分组选项、键盘交互和弹出层，并与界面中的其他组件自由组合。</td>
    <td>由 Vue 状态驱动布局，结合原生动画折叠面板，无需改变应用的组件模型。</td>
  </tr>
</table>

## Markdown 编辑器

<a href="images/readme-editor.png"><img src="images/readme-editor.png" alt="Markdown 编辑器，包含中英混排、任务、高亮和大纲" width="100%" /></a>

构建原生文档编辑器，支持富文本块、Markdown 源码模式、搜索、大纲导航、中英混排、表格、任务列表和高亮。可以切换任务、编辑内容，或在所见即所得与源码视图之间切换。

**源码：**[`examples/markdown-editor.tsx`](../examples/markdown-editor.tsx) · **运行：**`bun --hot markdown-editor.tsx`

## 原生 Markdown、代码与 Diff

<a href="images/metrics.png"><img src="images/metrics.png" alt="原生文本可视化测试，包含 Markdown、TypeScript 代码高亮和 Unified Diff" width="100%" /></a>

通过专门的 Markdown、代码和 Diff 组件呈现开发者内容。这张可视化测试图包含带样式的 Markdown、TypeScript 语法高亮和 Unified Diff，同时展示主题度量（metrics）如何统一调整组件的文字与间距。文本选择可以跨越元素边界。

**可视化测试源码：**[`showcase.test.tsx`](../packages/vue/src/__tests__/showcase.test.tsx) · **从仓库根目录运行：**`cd packages/vue && bun run test showcase`

更喜欢应用式 Demo？使用 [`examples/native-text.tsx`](../examples/native-text.tsx)，并在 `examples/` 目录下运行 `bun --hot native-text.tsx`。

## 应用组件

<a href="images/readme-gallery.png"><img src="images/readme-gallery.png" alt="Beautiful UI 组件库，包含按钮、标签、上下文卡片和可搜索列表" width="720" /></a>

使用带主题的按钮、标签、卡片、搜索列表和其他应用构建块组装桌面界面。Gallery 包含明暗主题，以及更复杂的控件、表格和流程图示例。

**源码：**[`examples/beautiful-ui.tsx`](../examples/beautiful-ui.tsx) · **运行：**`bun --hot beautiful-ui.tsx`

*Beautiful UI 是仓库内私有 workspace 示例，不作为公开 npm 包发布。*

## Canvas 与自定义视觉

<a href="images/readme-canvas.png"><img src="images/readme-canvas.png" alt="Canvas Demo，展示可分离与不可分离混合模式" width="580" /></a>

通过 `getContext("2d")` 使用路径、渐变、裁剪、像素数据和 W3C 混合模式进行绘制与合成。可以导出 PNG，也可以将 Canvas、图片、SVG 与其他 Vue 组件组合使用。

**源码：**[`examples/canvas-blends.tsx`](../examples/canvas-blends.tsx) · **运行：**`bun --hot canvas-blends.tsx`

## 更多可运行的 Demo

以下示例展示了更多桌面与应用工作流。构建仓库后，在 `examples/` 目录下运行对应命令。

| Demo | 可以体验什么 | 运行命令 |
|---|---|---|
| [画图](../examples/paint.tsx) | 画笔、图形、橡皮擦、撤销与重做 | `bun --hot paint.tsx` |
| [ANSI 日志](../examples/ansi-log.tsx) | 将彩色输出流式写入可选择文本的虚拟化日志 | `bun --hot ansi-log.tsx` |
| [多窗口](../examples/window-resize.tsx) | 拥有独立渲染器的多个桌面窗口 | `bun --hot window-resize.tsx` |
| [文件打开](../examples/open-files.tsx) | 安全接收操作系统在启动或运行期间打开的文件 | `bun --hot open-files.tsx` |
| [单实例](../examples/single-instance.tsx) | 单实例选举与后续启动参数转发 | `bun --hot single-instance.tsx` |
| [错误边界](../examples/error-handling.tsx) | 可恢复的渲染与事件错误 | `bun --hot error-handling.tsx` |
| [macOS 毛玻璃](../examples/blurred-window.tsx) | macOS 原生窗口背景材质 | `bun --hot blurred-window.tsx` |

[浏览全部示例](../examples/)，或查看[功能状态](status.md)了解完整能力清单和当前平台限制。

## 重新生成截图

当前提交的图片通过 GPU 测试渲染器在 macOS 上截取。在具有可用 GPU 的 macOS 或 Windows 上，构建仓库并从根目录运行：

```bash
bun scripts/screenshots.ts
```

[截图脚本](../scripts/screenshots.ts)会渲染真实示例和可视化测试，再将精选图片复制到 `docs/images/`。详细说明见[截图开发指南](development.md#readme-screenshots)。
