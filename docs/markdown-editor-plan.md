# Markdown WYSIWYG 编辑器（`<markdown-editor>`）实现计划与特性清单

> 分支 `feat/markdown-wysiwyg`（基于 main @ `52e1287`）。目标：编辑内核能力对齐
> ColaMD v2.4.3（`src/renderer/editor/editor.ts`）。追踪 issue：
> [liuyanghejerry/gpuiv#101](https://github.com/liuyanghejerry/gpuiv/issues/101) P0-1。
> 本文档的清单即工作队列：每项先写失败测试 → 实现 → 验证 → 勾选。

## 架构（定稿，见 issue #101 可行性调研评论）

- **headless ProseMirror 做文档模型与控制器**：只用 `prosemirror-model/state/transform/
  inputrules/history/markdown` 六个包，**不用 `prosemirror-view`**（DOM 绑定）。
- **每个 textblock 一个原生可编辑元素**：IME 组合限制在焦点块内，跨块组合不存在；
  选区在 PM 模型层全局，绘制复用 gpuiv 每元素选区机制。
- **装饰从 PM state 计算**（搜索高亮、标题落点闪烁），作为属性下发给原生块元素。
- 原生支撑落在 `packages/native`（扩展 `custom_elements/` 或新元素 + 文本测量/命中测试
  napi API）。**不改 `zed/` 子模块**；需要动 GPUI 即停（见停止规则）。

## 验证命令（每项勾选前必跑）

```bash
cd packages/native && cargo test --lib     # 有原生改动时
cd packages/vue && bun run test            # 每项必跑
bun scripts/dev.ts --shots                 # 有截图项时
```

## 非目标

数学公式与 Mermaid（P0-2/P0-3，公式块降级为代码块）、ColaMD 应用外壳（标签条/文件面板/
文件监听）、富文本 HTML 剪贴板（P1）、脚注悬浮预览、≥512KB 强制源码模式、字数统计。

## 队列

### M0 — 模型与序列化层（纯 JS，`packages/vue/src/markdown-editor/model.ts`）

> 已完成。验证：`packages/vue/src/__tests__/markdown-editor-model.test.ts`（27 项，纯 JS——
> 模型层无渲染，GPU 支撑测试从 M2/M3 起）。两个实现记录：markdown-it 固定 `^14`
> 与 prosemirror-markdown 的传递依赖同源（v15 自带类型且 `breaks` 行为已变，勿升）；
> markdown-it v14/v15 都不把软换行转 hardbreak，解析侧直接 `softbreak → hard_break`
> 节点实现 remark-breaks 语义。表格单元格序列化借用外层 state 的 `renderInline`
> （mark 只在 renderInline 路径生效），借道前必须先 `write("")` flush 待关闭块。

- [x] M0.1 schema：ColaMD 节点集（doc/paragraph/heading/blockquote/bullet_list/
      ordered_list/list_item(checked)/code_block(info)/horizontal_rule/image/hard_break/
      table 系列；marks：em/strong/code/strikethrough/link/highlight）
- [x] M0.2 Markdown→doc 解析（markdown-it `^14` + `html:false`；自写 task-list 核心规则；
      `softbreak → hard_break` = remark-breaks 语义）
- [x] M0.3 doc→Markdown 序列化（软换行输出 `\n`；tight/loose 列表保持；有序列表 start；
      表格列对齐；结尾补单个 `\n` 对齐 remark-stringify）
- [x] M0.4 标记风格保持（bullet `*`/`-`/`+`、emphasis/strong `_`、fence `~~~`，
      对齐 ColaMD markdown-style.ts 的探测逻辑）
- [x] M0.5 round-trip：canonical 用例文档树相等 + 幂等；4 份 ColaMD 真实文档
      （outline-test / mermaid-test / PRINCIPLES / README）fixture 验证通过

### M1 — 编辑核心（PM state/commands，纯 JS，`packages/vue/src/markdown-editor/state.ts`）

> 已完成。验证：`src/__tests__/markdown-editor-state.test.ts`（23 项）。实现记录：
> `MarkdownEditorCore` 是 headless 控制器（无 prosemirror-view）；input rule 处理函数
> 按 prosemirror-inputrules 的规范坐标顺序写（wrap 类规则**先 delete 再在 `tr.doc`
> 里 resolve blockRange**，`findWrapping` 不传第 4 参——list_item 由内部推导）；
> 快捷键→命令的接线在 M3.8（gpuiv 渲染层 onKeyDown）。

- [x] M1.1 EditorState 创建/重置；`reset()`=setMarkdown 程序化替换不进撤销栈
      （fresh state，`undoDepth()===0`）
- [x] M1.2 撤销/重做（prosemirror-history 接线，undo/redo/undoDepth）
- [x] M1.3 input rules：`# `~`###### `、`- `/`* `/`+ `、`1. `（保留 start）、
      ```` ``` ````、`> `、`==x==`（mark 规则）、`[x] `/`[ ] `（list_item 翻转）
- [x] M1.4 格式命令：strong/em/code/strikethrough/highlight（含空选区 storedMark）、
      toggleLink（href）、toggleList wrap/unwrap（findWrapping）
- [x] M1.5 任务项翻转命令（task→翻转 checked；plain→checked:true）

### M2 — 原生块编辑层（`packages/native` + host 元素）

> M2.1/M2.2/M2.4 完成（2026-09-18）。实现落在 `custom_elements/input.rs` 的
> `<input>`/`<textarea>` 上，三个新 custom prop：`spans`（UTF-16 偏移的
> `{start,end,fontWeight?,fontStyle?,underline?,strikethrough?,background?,color?,fontFamily?}`，
> 可重叠、PM mark 组合语义）、`decorations`（搜索高亮 range → quad，复用选区的
> 三段式分行几何）、`selection`（UTF-16 anchor/head，补上"JS 无法编程设置编辑器
> 选区"这个比 spans 更关键的缺口）。run 构造在 `build_span_runs`（span 叠加 +
> preedit 强制下划线 + 相邻合并），placeholder 分支忽略 spans；带背景 span 时
> 走 `WrappedLine::paint_background`。光标/命中/选区/IME bounds 全部经由
> WrappedLine 几何查询，天然跨 run 正确。span 不得改 font size（行高假设）——
> 块级字号由宿主 div 样式承担，符合 markdown 块结构。测试面：
> `getPaintedInputRuns`（runs 摘要）与 `getInputDecorations`（像素矩形）两个
> test_renderer getter。验证：Rust 单测 8 项（span_tests）+ GPU 测试 6 项
> （`markdown-editor-native.test.tsx`：样式 run、值回显抑制下 spans 保持、
> preedit 跨 span 下划线、装饰矩形、程序化选区替换、背景+删除线）。

- [x] M2.1 原生可编辑块元素：styled spans（颜色/weight/italic/下划线/删除线/背景）+
      光标/选区/preedit（组合输入）——扩展现有 `custom_elements/input.rs`
- [x] M2.2 候选窗跟随光标（`bounds_for_range` 走 point_for_index，多 run 下不变；
      由 preedit 渲染测试与几何路径不变性覆盖，OS 候选窗本身无法自动化断言）
- [ ] M2.3 文本测量 + 命中测试 napi API（pos↔coords，供跨块选区与装饰定位）
- [x] M2.4 装饰下发通道（`decorations` prop → 分行 quad）
- [ ] M2.5 跨块选区绘制（拖拽选择、shift 点击扩展、跨块 ⌘C；`selection` prop 已就位）

### M3 — 组件与交互（`packages/vue` `<markdown-editor>`）

- [ ] M3.1 组件外壳：props（source/theme）、change 事件、受控/非受控
- [ ] M3.2 块级渲染：h1–h6、嵌套列表、引用、围栏代码（Syntect 高亮）、分隔线、图片、
      GFM 表格（对齐）、任务列表（复选框点击翻转）、脚注
- [ ] M3.3 行内渲染：em/strong/行内码/删除线/链接（点击/⌘点击 openUrl）/highlight/软换行
- [ ] M3.4 标题锚点跳转 + 落点闪烁装饰
- [ ] M3.5 源码模式切换（`<textarea>`，滚动比例恢复）
- [ ] M3.6 纯文本 Markdown 复制/粘贴（跨块）
- [ ] M3.7 ⌘F 搜索高亮（装饰从 PM state 计算下发）
- [ ] M3.8 快捷键整合（格式命令、撤销、模式切换）

### M4 — 示例与收尾

- [ ] M4.1 `examples/markdown-editor.tsx` 演示 app
- [ ] M4.2 `bun scripts/dev.ts --shots` 截图
- [ ] M4.3 `.changeset`、README Status、issue #101 P0-1 勾选

## 停止规则

某能力在不改 `zed/` 的前提下连续 3 轮尝试无解（最可能：preedit 样式 run、候选窗定位、
内联混排字号）→ 停止推进，把阻塞证据写到 issue #101 并汇报。不硬凑、不绕过 GPUI。
