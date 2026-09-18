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
- [x] M0.6（遗留补齐）脚注：markdown-it-footnote 插件 + footnote_definition/
      footnote_reference 节点 + 序列化（[^label]: 定义块、[^label] 引用）；round-trip
      文档树相等 + 幂等（多定义间补空行，字节级差异可接受）

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
- [x] M2.5 跨块选区（shift-点击扩展：原生 caret 即命中测试结果——selectionChange
      上报新块内偏移，无需在真实渲染器上暴露测量 API；选区按块渲染 selection 色
      decorations。**降级项**：拖拽跨块扩展需原生在被捕获按压期间外发 mouse-move，
      记为后续原生增强；块内拖拽选择原生可用）
- [x]（M2 附注）测量元素在 flex 行内高度塌陷（gpuiv/Taffy 交互）且连带点击
      hit-test 失效——组件以显式高度（硬换行行数 × 行高，maxRows 钳制）规避，
      软换行增高降级为内部滚动；根因留给原生布局层后续修

### M3 — 组件与交互（`packages/vue` `<markdown-editor>`）

> M3.1/M3.2（除脚注与代码高亮）/M3.3/M3.8（格式命令部分）完成（2026-09-18）。
> 组件在 `packages/vue/src/markdown-editor/component.tsx`，已从包入口导出。
> 两个本轮落地的关键机制：
>
> 1. **`valueRevision` 权威重同步**（原生 prop + 组件分歧检测）：input rule/撤销/格式
>    命令改写块文本后，PM 文本与原生内容会分叉，而 value prop 可能恰好等于上次值
>    （registry 无 diff → 永不纠正）。组件维护 `nativeTexts`（原生上次上报）与
>    `blockTexts`（PM 当前），分歧时递增该块的 valueRevision，Rust 侧绕过回显抑制
>    强制 `set_external_text`。这是 echo-suppression 设计的必要补丁。
> 2. **`selectionChange` 事件**（input.rs paint 期去重 emit，UTF-16 anchor/head；
>    外部设置不回声）：组件据此跟踪每块原生选区，⌘B/⌘I/⌘E/⌘⇧X/⌘⇧H/⌘K（剪贴板取
>    URL，同 ColaMD）映射到 PM 选区后走 M1 命令。
>
> Enter 语义零原生改动对齐 ColaMD：textarea 绑 onSubmit 后 enter=Submit（→
> `splitBlockAt`，列表内拆 item），shift-enter=原生换行（hard_break）。
> schema 修正：em/strong/strikethrough/highlight `inclusive: false`（边界输入不继承
> 样式）；序列化器补结尾空段落（拆分出的空块不再被吞）。Backspace-at-0 → join 前块。
> 验证：`markdown-editor-component.test.tsx` 9 项 GPU 测试（渲染样式/标记/复选框、
> input rule 全链路、Enter 拆分+焦点转移、复选框点击翻转、⌘B 全选加粗、shift-enter
> 软换行、边界输入不吞 mark、块内 IME）。

- [x] M3.1 组件外壳：props（source/theme）、change 事件、`getMarkdown()` expose
- [x] M3.2 块级渲染：h1–h6、嵌套列表（marker/缩进/任务复选框）、引用、围栏代码
      （ColaMD 同款无高亮）、分隔线、图片、GFM 表格（对齐、单元格可编辑）、
      脚注定义块（`[^n]:` 标记 + 0.92x 字号）与行内引用（\uFFFC 单字符占位 +
      accent 下划线——单字符保持 PM 偏移对齐，编辑该字符即编辑 Markdown 引用）
- [x] M3.3 行内渲染：em/strong/行内码/删除线/highlight/链接（样式+下划线）/软换行
- [x] M3.4 标题锚点跳转 + 落点闪烁（`jumpToHeading(text)` expose：定位标题块、
      聚焦其 textarea、1.4s 黄色落点覆盖层 `md-flash`；文档内 `#` 链接点击属
      ColaMD 的 DOM 拦截行为，gpuiv 编辑器内点击归原生 caret，跳转由应用层
      outline/锚点 UI 调用）
- [x] M3.5 源码模式切换（`mode="source"` prop：单一等宽 textarea，改动经
      `core.reset()` 回流（undo 清空符合 ColaMD 语义）；`viewportHeight` 设置后
      组件根为滚动容器，切换时按 scrollTo-探测最大滚动→比例→恢复（用现有
      scrollTo/getScrollOffset API，无需新增原生接口））
- [x] M3.6 纯文本 Markdown 复制/粘贴（跨块复制=PM slice 序列化为 Markdown 写剪贴板；
      多块粘贴=解析剪贴板 Markdown 经 `insertMarkdownAt` 成块插入；单行粘贴走原生。
      关键机制：**cmd-c/cmd-v 是原生 keybinding，动作消费后 keyDown 到不了 JS**——
      编辑器开 `interceptClipboard` 后原生只发 `copy`/`paste` 事件（copy 带 UTF-16
      选区，paste 带剪贴板文本），组件侧完成序列化/结构化插入）
- [x] M3.7 搜索高亮（`searchQuery`/`searchActiveIndex` props：命中走 decorations
      通道，`searchMatches` 事件回报计数；active 命中聚焦所在块并经 `selection`
      prop 选中范围——装饰从组件层基于 PM 块文本计算下发；⌘F 面板由应用层接，
      example 会演示）
- [x] M3.8 快捷键整合：格式命令（⌘B/I/E/K/⇧X/⇧H、⌘Enter 任务翻转）+ Enter 拆分
      + Backspace 跨块合并；撤销/重做与模式切换快捷键待 M3.5/M3.6

### M4 — 示例与收尾

- [ ] M4.1 `examples/markdown-editor.tsx` 演示 app
- [ ] M4.2 `bun scripts/dev.ts --shots` 截图
- [ ] M4.3 `.changeset`、README Status、issue #101 P0-1 勾选

## 停止规则

某能力在不改 `zed/` 的前提下连续 3 轮尝试无解（最可能：preedit 样式 run、候选窗定位、
内联混排字号）→ 停止推进，把阻塞证据写到 issue #101 并汇报。不硬凑、不绕过 GPUI。
