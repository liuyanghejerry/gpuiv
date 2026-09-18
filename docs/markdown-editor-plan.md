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

> 已完成。验证：`packages/vue/src/__tests__/markdown-editor-model.test.ts`（29 项，纯 JS——
> 模型层无渲染，GPU 支撑测试从 M2/M3 起）。两个实现记录：markdown-it 固定 `^14`
> 与 prosemirror-markdown 的传递依赖同源（v15 自带类型且 `breaks` 行为已变，勿升）；
> markdown-it v14/v15 都不把软换行转 hardbreak，解析侧直接 `softbreak → hard_break`
> 节点实现 remark-breaks 语义。表格单元格序列化借用外层 state 的 `renderInline`
> （mark 只在 renderInline 路径生效），借道前必须先 `write("")` flush 待关闭块，
> 且借用期间清空 `state.delim`（否则 `> ` 漏进单元格）。

- [x] M0.1 schema：ColaMD 节点集（doc/paragraph/heading/blockquote/bullet_list/
      ordered_list/list_item(checked)/code_block(info)/horizontal_rule/image/hard_break/
      table 系列；marks：em/strong/code/strikethrough/link/highlight——code 排最末，
      保证序列化时最内层开启，见 review 修正轮）
- [x] M0.2 Markdown→doc 解析（markdown-it `^14` + `html:false`；自写 task-list 核心规则；
      `softbreak → hard_break` = remark-breaks 语义）
- [x] M0.3 doc→Markdown 序列化（软换行输出 `\n`；tight/loose 列表保持；有序列表 start；
      表格列对齐、单元格 `|` 转义；blockquote 内表格逐行 `state.write`；结尾补单个
      `\n` 对齐 remark-stringify）
- [x] M0.4 标记风格保持（bullet `*`/`-`/`+`、emphasis/strong `_`、fence `~~~`，
      对齐 ColaMD markdown-style.ts 的探测逻辑；统计前先剥离 `**…**`/`__…__`，
      避免把 strong 误计入 `*em*`）
- [x] M0.5 round-trip：canonical 用例文档树相等 + 幂等；4 份 ColaMD 真实文档
      （outline-test / mermaid-test / PRINCIPLES / README）fixture 验证通过
- [x] M0.6（遗留补齐）脚注：markdown-it-footnote 插件 + footnote_definition/
      footnote_reference 节点 + 序列化（[^label]: 定义块、[^label] 引用）；round-trip
      文档树相等 + 幂等（多定义间补空行，字节级差异可接受）

### M1 — 编辑核心（PM state/commands，纯 JS，`packages/vue/src/markdown-editor/state.ts`）

> 已完成。验证：`src/__tests__/markdown-editor-state.test.ts`（59 项）。实现记录：
> `MarkdownEditorCore` 是 headless 控制器（无 prosemirror-view）；input rule 处理函数
> 按 prosemirror-inputrules 的规范坐标顺序写（wrap 类规则**先 delete 再在 `tr.doc`
> 里 resolve blockRange**，`findWrapping` 不传第 4 参——list_item 由内部推导）；
> 块级规则只在顶层段落触发、mark 规则不在 code mark 激活时触发（review 修正轮加的
> 门禁，对齐 milkdown/ColaMD）。`splitBlockAt` 返回拆分后**新 textblock 的 doc 位置**
> （曾在列表内错误返回容器 list 的位置）；`joinWithPreviousBlock` 用 `canJoin` 守卫
> 永不抛异常（不可 join 的前驱改为 caret 移入其末尾 textblock，hr 则删除）；
> `insertMarkdownAt` 对 code_block 目标原文插入不重组文档；`editBlock` 把插入文本里
> 的 `\n` 分解为 hard_break 节点保持树形与 reparse 一致。

- [x] M1.1 EditorState 创建/重置；`reset()`=setMarkdown 程序化替换不进撤销栈
      （fresh state，`undoDepth()===0`）
- [x] M1.2 撤销/重做（prosemirror-history 接线，undo/redo/undoDepth）
- [x] M1.3 input rules：`# `~`###### `、`- `/`* `/`+ `、`1. `（保留 start）、
      ```` ``` ````、`> `、`==x==`（mark 规则）、`[x] `/`[ ] `（list_item 翻转）
- [x] M1.4 格式命令：strong/em/code/strikethrough/highlight（含空选区 storedMark）、
      toggleLink（href）、toggleList wrap/unwrap（findWrapping；多段落选区逐段成 item，
      不再裹进单个 item）
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
> test_renderer getter。验证：Rust 单测 10 项（span_tests）+ GPU 测试 7 项
> （`markdown-editor-native.test.tsx`：样式 run、值回显抑制下 spans 保持、
> preedit 跨 span 下划线、装饰矩形、程序化选区替换、背景+删除线）。
>
> 2026-09-18 review 修正：布尔 `underline`/`strikethrough` span 曾因
> `Hsla::default()`（alpha=0）画成透明，改为 `color: None` 继承 run 文字色
> （`SpanLine::Inherit`）；paint 不再硬编码左对齐，`textAlign` 贯通到
> `WrappedLine::paint`；新增事件 `cut`（interceptClipboard 下原生不再代为删除）、
> `backspaceStart`（空选区 offset 0 的 backspace）、`undo`/`redo`（宿主注册
> listener 时跳过原生撤销栈）；`build_span_runs` 的 UTF-16→UTF-8 换算提出
> 段循环（每帧 O(段×span×文长) → O(span×文长)）。

- [x] M2.1 原生可编辑块元素：styled spans（颜色/weight/italic/下划线/删除线/背景）+
      光标/选区/preedit（组合输入）——扩展现有 `custom_elements/input.rs`
- [x] M2.2 候选窗跟随光标（`bounds_for_range` 走 point_for_index，多 run 下不变；
      由 preedit 渲染测试与几何路径不变性覆盖，OS 候选窗本身无法自动化断言）
- [x] M2.3 文本测量 + 命中测试 napi API（`getInputTextPosition`/`getInputTextOffset`
      test renderer napi；跨块选区最终经"原生 caret 即命中结果"路线无需真实渲染器
      版本，测量 API 供测试与覆盖层对齐用）
- [x] M2.4 装饰下发通道（`decorations` prop → 分行 quad）
- [x] M2.5 跨块选区（shift-点击扩展：原生 caret 即命中测试结果——selectionChange
      上报新块内偏移，无需在真实渲染器上暴露测量 API；选区按块渲染 selection 色
      decorations。**降级项**：拖拽跨块扩展需原生在被捕获按压期间外发 mouse-move，
      记为后续原生增强；块内拖拽选择原生可用）
- [x]（M2 附注，2026-09-18 review 查明根因）曾记录为"测量元素在 flex 行内高度
      塌陷（gpuiv/Taffy 交互）且连带点击 hit-test 失效，根因留给原生布局层"——
      真因是组件把 CSS 乘数 lineHeight（1.45/1.7）传给像素契约的原生 API
      （`px(1.7).round()`=2px），与 Taffy 无关。修正为绝对像素后，显式高度
      workaround 已整体移除，块高由原生 minRows/maxRows 测量布局接管（软换行
      增高仍走内部滚动钳制）

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
> 样式）；序列化器补结尾空段落（拆分出的空块不再被吞）。
> 验证：`markdown-editor-component.test.tsx` 18 项 GPU 测试（渲染样式/标记/复选框、
> input rule 全链路、Enter 拆分+焦点转移、复选框点击翻转、⌘B 全选加粗、shift-enter
> 软换行、边界输入不吞 mark、块内 IME、key 冲突回归、图片占位偏移、撤销/剪切/
> join 接线等）。

- [x] M3.1 组件外壳：props（source/theme）、change 事件、`getMarkdown()` expose
      （review 修正：`source` 变更经 watch + `core.reset()` 响应，带 echo 守卫防
      父级回填冲掉撤销栈；源码模式下 `getMarkdown()` 返回实时 `sourceText`）
- [x] M3.2 块级渲染：h1–h6、嵌套列表（marker/缩进/任务复选框）、引用、围栏代码
      （ColaMD 同款无高亮）、分隔线、图片（行内 \uFFFC 占位保持偏移对齐）、GFM
      表格（对齐、单元格可编辑）、脚注定义块（`[^n]:` 标记 + 0.92x 字号）与行内
      引用（\uFFFC 单字符占位 + accent 下划线——单字符保持 PM 偏移对齐，编辑该
      字符即编辑 Markdown 引用）
- [x] M3.3 行内渲染：em/strong/行内码/删除线/highlight/链接（样式+下划线）/软换行
- [x] M3.4 标题锚点跳转 + 落点闪烁（`jumpToHeading(text)` expose：定位标题块、
      聚焦其 textarea、1.4s 黄色落点覆盖层 `md-flash`；文档内 `#` 链接点击属
      ColaMD 的 DOM 拦截行为，gpuiv 编辑器内点击归原生 caret，跳转由应用层
      outline/锚点 UI 调用）
- [x] M3.5 源码模式切换（`mode="source"` prop：单一等宽 textarea，改动经
      `core.reset()` 回流（undo 清空符合 ColaMD 语义）；`viewportHeight` 设置后
      组件根为滚动容器，切换时按 scrollTo-探测最大滚动→比例→恢复（用现有
      scrollTo/getScrollOffset API，无需新增原生接口。review 修正：原生滚动偏移
      向下为负，探测须用 `-1e9`，此前恒回顶部））
- [x] M3.6 纯文本 Markdown 复制/剪切/粘贴（跨块复制/剪切=PM slice 序列化为
      Markdown 写剪贴板，剪切另经 `deleteRange` 删除；多块粘贴=解析剪贴板文本，
      >1 块或含非段落块时经 `insertMarkdownAt` 成块插入（代码块目标原文插入），
      否则走 editBlock 原文插入，三条路径都经 selection prop 还原 caret。
      关键机制：**cmd-c/cmd-v 是原生 keybinding，动作消费后 keyDown 到不了 JS**——
      编辑器开 `interceptClipboard` 后原生只发 `copy`/`cut`/`paste` 事件（copy/cut
      带 UTF-16 选区，paste 带剪贴板文本），组件侧完成序列化/结构化插入）
- [x] M3.7 搜索高亮（`searchQuery`/`searchActiveIndex` props：命中走 decorations
      通道，`searchMatches` 事件回报计数；active 命中聚焦所在块并经 `selection`
      prop 选中范围——装饰从组件层基于 PM 块文本计算下发；⌘F 面板由应用层接，
      example 会演示。review 修正：聚焦只在 `(searchQuery, searchActiveIndex)`
      对变化时发生（watch），渲染路径零副作用，不再每次渲染抢焦点）
- [x] M3.8 快捷键整合：格式命令（⌘B/I/E/K/⇧X/⇧H、列表 ⌘⇧7 有序/⌘⇧8 无序/
      ⌘⇧9 任务、⌘Enter 任务翻转）+ Enter 拆分 + Backspace 跨块合并 +
      ⌘Z/⇧⌘Z 撤销重做（PM history 为唯一栈）。
      review 修正：backspace/undo/redo 同为原生 keybinding（keyDown 到不了 JS），
      原 keyDown join 分支是死代码——改由原生事件 `backspaceStart`/`undo`/`redo`
      接线，join 后 caret 经 selection prop 精确落到接合点。
      块 key 策略重写为 `BlockKeyAllocator` 逐渲染 pass：先保留全部存活 textblock
      的身份 key（移动中的块不会被抢 key），再按上一渲染的位置映射回退，冲突铸
      新 key；hr/img/info/trow 用独立前缀不与 `b{pos}` 撞名空间；split/join 后
      经 `focusDocPosition` 用同一分配器解析目标块 key，不再插值猜 `b${pos}`。
      修复「列表包裹→解包→Enter」与「块尾 Enter 且有后继块」两条路径的双活块
      同 key（hostIds/blockTexts/revisions 互相污染）回归

### M4 — 示例与收尾

> 完成（2026-09-18）。示例 app（`examples/markdown-editor.tsx`，`bun run markdown-editor`
> 启动）带工具栏（模式切换/搜索框/next/状态行）与 outline 面板（跳转+闪烁）；
> 编辑列 overflow 滚动（review 修正补齐）；截图测试
> `markdown-editor-shot.test.tsx`（`bun scripts/dev.ts --shots markdown-editor`，
> PNG 落 `packages/vue/screenshots/markdown-editor.png`）。

- [x] M4.1 `examples/markdown-editor.tsx` 演示 app（含 ⌘F 搜索面板、源码模式切换、
      outline 跳转；示例文档覆盖全部块型与行内样式）
- [x] M4.2 `bun scripts/dev.ts --shots markdown-editor` 截图 + painted-text 断言 +
      搜索高亮 smoke
- [x] M4.3 `.changeset`（组件 minor + 原生 props minor）、README Status、
      issue #101 P0-1 勾选

## Review 修正轮（2026-09-18，四路并行 review → 修复）

Review 发现 6 个 blocker 并全部修复：lineHeight 单位错配（见 M2 附注，截图里所有
块曾渲染为 2px 细条）；块 key 冲突（见 M3.8）；Backspace join 死代码（见 M3.8）；
`splitBlockAt` 列表内返回容器位置致焦点丢失；搜索激活时每渲染抢焦点（见 M3.7）；
`cut` 在 interceptClipboard 下无剪贴板写入且事件与 copy 不可区分（见 M2/M3.6）。

同步修复的 major/minor：mark 顺序致 `==…`/`~~…` 跨越行内码时序列化错乱（code 移至
marks 末尾）；表格单元格 `|` 未转义、blockquote 内表格未逐行加 `> `；粘贴启发式
漏掉单换行 markdown（改解析判定）且代码块目标一律原文插入；跨块选区编辑后不
失效（touch 时清除）；布尔 underline/strikethrough 画成透明；原生 paint 硬编码
左对齐；行内 image 原子打歪偏移；`rowOrder()` 渲染期每行全文档 walk（O(n²) →
每渲染一次）；粘贴后 caret 被重同步打到块尾；输入规则门禁；`detectMarkerStyle`
误计 `**`；`toggleList` 多段落裹进单个 item；state 层危险路径（editBlock/
split/join/insertMarkdownAt/toggleTaskItemAt）补齐直接单测。

遗留限制（记录在案）：居中/右对齐单元格内 caret 与点击命中仍按未对齐坐标计算
（GPUI 仅绘制期对齐，命中侧镜像需自实现 `aligned_origin_x`）；`toggleList` 解包
丢弃任务 checked 态；拖拽跨块选区仍需原生捕获按压期外发 mouse-move（M2.5 降级项）。

## 验收修正轮（2026-09-18，手工验收 → 修复）

手工验收发现五项问题，全部修复：

1. **表格单元格黑字**（组件漏传 `color`，原生默认黑）与**光标偏矮**（漏传
   lineHeight）——单元格与正文行同待遇（`color: theme.text` + 像素 lineHeight）。
2. **表格列溢出/右对齐文字被裁**：原生编辑器在不定宽度下回退测量 320px，flex
   收缩失效，两格各 330 溢出 592 的行。改为显式百分比列宽（均分），右对齐
   「Status」列随之正确绘制在格内。
3. **搜索框输入第一个字符焦点即被正文抢走**：`(searchQuery, searchActiveIndex)`
   watch 改为只在「query 不变、activeIndex 变化」（纯 next/prev 导航）时聚焦。
4. **源码模式高度不填满**：源码分支根改为全高 flex 列 + textarea `flexGrow: 1`
   （短文档填满可视列，长文档维持 maxRows 钳制 + 内部滚动）。
5. **⌘A 无法全选文档、无右键菜单**：原生新增 `selectAll` 事件（宿主注册即接管，
   跳过原生块内全选）与 `contextMenu` 事件（右击释放时发，带窗口坐标；右击按下
   即聚焦、空选区落 caret、有选区则保留）。组件侧 ⌘A = 全文 docSelection（单块
   文档退化为块内全选，单元格与源码 textarea 保持原生语义）；内建右键菜单
   Copy/Cut/Paste/Select All，WYSIWYG 走 PM 管线、源码模式走 sourceText 剪贴。

遗留限制不变（居中/右对齐格内 caret 命中仍按未对齐坐标；toggleList 解包丢任务态；
拖拽跨块选区待原生增强）。

## 停止规则

某能力在不改 `zed/` 的前提下连续 3 轮尝试无解（最可能：preedit 样式 run、候选窗定位、
内联混排字号）→ 停止推进，把阻塞证据写到 issue #101 并汇报。不硬凑、不绕过 GPUI。
