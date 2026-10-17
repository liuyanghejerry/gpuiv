# React 版本对照审计

本次基线为 [guokaigdg/animal-island-ui 的 `c696d16167d01370f822f95db22340b05d837555`](https://github.com/guokaigdg/animal-island-ui/tree/c696d16167d01370f822f95db22340b05d837555)，直接对照组件 TSX、Less、测试及 demo。此前移植以 `animal-island-vue` 为来源；本表记录 React 版本额外的 API、行为、外观和原生适配，不将两个上游版本视为相同。

画廊保留原有 39 个页面，并新增 CountUp，共 40 页。Icon 是原生移植保留的扩展页面：React 库使用外部 `naive-icons`，并不导出同名 Icon 家族。AvatarGroup、FormItem、Skeleton 的三个辅助组件归入各自主组件页面。本审计不表示所有 CSS 效果或像素均完全一致。

## API 与原生约定

- React 的节点内容对应 Vue VNode、VNode 数组及具名/作用域插槽。字符串和数字进入原生 `<text>`；`null`、布尔值等无可见内容不会绘制成文字。
- 保留 Vue 的 `modelValue` / `onUpdate:modelValue`。Input、Select、DatePicker、TimePicker 的 React `value` 和 Upload 的 `fileList` 同样可受控使用；显式 React 值优先于 Vue 别名。
- 公共 Props 类型使用原生事件、VNode 与 `StyleDesc`，并公开 CountUp 相关类型和 `Avatar.Group`。不将浏览器 `SyntheticEvent`、`CSSProperties` 或 DOM 引用伪装为原生对象。
- 弹层采用 `FloatingLayer`、平台 Select 或 deferred anchored 层。侧栏和右侧展示区是独立的兄弟滚动容器；组件内部避免嵌套滚动。
- 本次修改位于 Animal Island 包、Vue 动画/浮动层及本地 native 翻译层。native 保留 anchored 显式透明背景，将颜色及单个/数组阴影轨道接入已有帧时钟，使用现有 GPUI 阴影与图像绘制 API；图片滤镜在本地后台资源任务中处理。未修改上游 GPUIX 或 Zed。

## 基础组件

| 页面 | 已覆盖的 React 契约与本次变化 | 仍有的原生差异 |
| --- | --- | --- |
| Title | ribbon、layer、tab 的 SVG 折角/尾部/斜角；尺寸与调色板；原生测量支持内容宽度。 | layer/tab 文本 hover 的 1.06 倍缩放、字距和文字阴影未还原。改变字体几何会影响原生布局，不能直接等价于 CSS transform。 |
| Button | type、size、danger、ghost、block、disabled、loading、htmlType、点击/键盘/焦点；任意图标节点；hover/press 位移及背景、文字、边框、硬阴影的原生补间；danger/ghost 的 hover+active CSS 优先级；固定几何虚线 SVG 的着色轨道；React Donut 按 2.5 秒逆时针旋转。 | 原生位移补间代替 CSS transform。Donut 旋转由局部 SVG 帧采样实现，非通用原生 transform。 |
| Divider | 五种线条、方向、内容位置；任意图标节点和兼容图标名；宽线稿随测量宽度重复。 | 浏览器 className 与 `StyleDesc` 之外的 CSS 值不生效。 |
| Icon | 保留 101 个全彩图标、具名组件和自定义图标；Button/BackTop 复用对应 Donut/Rocket 图案。 | 这是 React 外部图标库的原生适配扩展；原有可选 bounce 仍无动画，em/rem 图标尺寸不支持。 |
| Tag | 尺寸、变体、调色板、close/keyboard；虚线边框着色补间；可点击标签 hover 抬升 1px；表面颜色/阴影及关闭按钮颜色过渡。 | 原生位移代替 CSS transform；字距尚未映射。 |
| Cursor | 原指针/落点图案、按下圆环、组件局部跟随和事件组合。 | OS 指针不能隐藏或替换；`forceAll` 不能改写任意后代的系统光标。装饰跟随与 OS 指针同时存在。 |
| CodeBlock | code、copyable、onCopy、复制成功/失败及 2 秒复位；原暖棕卡片；按 React 原正则识别 shell 命令，显式 language 优先；原生 Syntect 高亮和可选行号；复制按钮 hover 抬升 1px、按下恢复原位并补间其背景色。 | 原生高亮按语法 scope 分类，不能逐 token 复刻 React 正则配色；原生字体为单字体名，非浏览器字体栈。 |
| Background | React 全部 20 种类型，新增 `dots-gray`；粉/黄/青/绿等波点强度与 React 一致；Card 的单独波点色仍保持独立。 | 纹理等到第一次原生尺寸采样后出现；React 未引用的桌面壁纸不作为新 API 添加。 |
| Footer | 当前年份、默认/自定义文字、颜色、12px 字号、居中和 contentinfo 语义。 | 使用原生角色与布局，不产生 HTML footer。 |

## 表单组件

| 页面 | 已覆盖的 React 契约与本次变化 | 仍有的原生差异 |
| --- | --- | --- |
| Input | React `value` 的字符串/数字受控别名、readOnly、autoFocus、tabIndex、键盘回调；VNode 前后缀；原有 defaultValue、清空、状态、阴影、password、IME、maxLength；容器颜色/阴影与清除按钮颜色的原生过渡。 | `onChange(value, nativeEvent?)` 是 Vue/原生回调；除密码外，浏览器 input type 的验证约束不适用。 |
| Switch | checked/modelValue、defaultChecked、disabled/loading、键盘及原生滑块；完整节点 checkedChildren/unCheckedChildren；正常/选中原生内阴影；轨道颜色/内阴影与手柄边框色同滑动一起补间；disabled/loading 整体透明度沿原 0.25s 曲线补间。 | VNode 标签需要调用者提供合适宽度；字符串标签保留宽度估计。文字阴影和旋转边框加载效果仍为近似。 |
| Select | React 搜索、清空、onSearch/onClear、clearAriaLabel；filterOption 布尔/自定义函数、optionFilterProp；任意 notFoundContent；过滤结果键盘导航、Esc 清空查询后关闭、焦点保持。普通菜单继续使用平台已挂载条目注册表；触发器背景/边框及清除按钮颜色过渡保留原生焦点引用。 | 按用户要求默认在触发器上方、左侧对齐、间隔 8px，覆盖 React 原有位置算法；可配置 side/align。长菜单不引入嵌套滚动；原生 ARIA 不具备所有 DOM 引用关系；退出立即完成。 |
| DatePicker | React `value` 与 Vue 受控值；日期/范围/月模式、disabledDate、自定义 format、待确认值、清空、today、键盘和 popup 控制；触发器双层阴影、日期格/导航/操作按钮颜色补间。 | 弹层位置采用原生锚定；退出立即完成；浏览器 ARIA 引用关系不完整。 |
| TimePicker | React `value` 与 Vue 受控值；步长、format、时间列、待确认值、当前时间、清空、popup 和键盘；触发器双层阴影及选项/操作按钮颜色补间。 | 每列以七行分页替代浏览器滚动列，避免嵌套滚动。 |
| Checkbox | 受控/default 分组、单项 disabled、尺寸/方向、键盘、任意标签节点；选中时六点原生位置/尺寸/透明度动画；边框 0.25s、标签颜色 0.15s 原生过渡。 | 勾线描绘仍为静态 SVG；六点轨迹代替 CSS box-shadow。 |
| Radio | 受控/default 分组、单项 disabled、Arrow/Home/End 焦点、键盘、任意标签节点；原生六点选中动画、边框及标签颜色过渡。 | 勾线及六点轨迹与 Checkbox 的原生适配相同。 |
| Rate | value/default/count/size/readonly/allowClear、键盘与 hover；新填充星星错开 60ms 的两阶段尺寸动画，末颗星的六点动画，hover 抬升。 | 数字几何补间代替 CSS scale，SVG 颜色直接切换。React 本身也没有半星、自定义字符或自定义颜色 API。 |
| Form | Form、FormItem、useForm 的布局、初值、嵌套 name、依赖、校验、回调及命令式方法；valuePropName/trigger 可绑定 React 风格字段；默认仍使用 Vue model；挂载后可替换 form 实例并重新绑定回调。 | 使用原生 flex 与程序化提交/重置；DOM id、htmlFor、错误消息引用关系不可完全复现。 |
| Upload | React `fileList` 受控别名、VNode tip；真实原生文件选择/拖放、accept/maxCount、beforeUpload 转换、customRequest/action、列表/预览/remove。 | File 为 Node File 并支持 native path；action fetch 上传进度是 0→100，细粒度进度需 customRequest；无浏览器 cookie jar、drag-enter 高亮。 |

## 反馈组件

| 页面 | 已覆盖的 React 契约与本次变化 | 仍有的原生差异 |
| --- | --- | --- |
| Notification | 任意标题/正文/按钮/图标节点、六种位置、同 key 更新、自动关闭、close-once；可点击卡片抬升与表面/关闭按钮颜色过渡；常规关闭按 250ms 离场后回调，destroy 同步移除。 | 原生离场节点和分组由 Vue presence 管理；文字字距/阴影、完整 DOM ARIA 关系与浏览器事件冒泡不适用。 |
| Modal | 任意 title 和 footer 数字/节点/数组，`footer=0` 不替换成默认操作；game 的 React 有机轮廓；Typewriter、关闭、焦点恢复和 deferred 层。 | 装饰 SVG 不裁剪任意原生后代；scale 入场用 opacity 代替；Tab 约束通过原生焦点修正，不能等价于浏览器 preventDefault。 |
| Drawer | 任意 title/footer 节点；四方向、尺寸、位置动画、关闭与焦点恢复；关闭按钮颜色补间。 | `pushBackground` 的背景子树 scale(0.94) 和 14px 圆角裁剪尚未接入；React 已主动移除该效果的 blur，不属于待移植功能。Tab 约束与 ARIA 引用仍有平台差异。 |
| Loading | 原椭圆暗角渐变、任意 tip、50 个雪花、delay、受控显示、打断退出与卸载清理；zIndex 对应 native deferred priority。 | 文字阴影和 OS reduced-motion 偏好未自动映射；圆形雪花旋转不改变视觉。 |
| Tooltip | 分离 hover/focus/click 模式；事件组合到实际子组件，保留原回调；100ms 关闭宽限、重新进入取消关闭、可选 delay；任意标题；island 复用 React 归一化路径并沿轮廓绘制 SVG alpha 阴影；完整 deferred 表面使用 0.25s opacity 与朝触发器的 4px 位移入场。 | deferred 命中/遮挡区域为矩形，SVG 不裁剪原生后代；旋转方形箭头用三角装饰代替；无 described-by DOM 关联。 |
| Progress | percent 钳制、showInfo、任意 infoFormat、duration；14/24/32px 轨道、2px 描边、14px 波点；默认薄荷三段渐变、100% 完成态提亮和 2px 内高光；四种场景图固定为整轨宽度，再从左侧揭开。保留 inside/top 信息位置扩展。 | 字距未映射；渐变与场景图用原生 img 和圆角裁剪；第一次填充等待轨道尺寸；resize 时会再次补间。 |
| Skeleton | loading、四种变体、active、rows、width/rowWidths/widthValue/heightValue；Button/Input/Avatar 辅助组件；原五停高光 SVG 沿原生时钟横向扫动（1.6s ease-in-out）、独立循环与卸载清理；多个实例共用 100ms 宽度查询，无逐帧 mutation，每周期完成时重启一次。 | GPUI 父级 overflow 仅矩形裁剪，扫光在圆形和圆角边缘尚不能等价于 CSS 圆角蒙版。loading=false 且无内容时输出空内容。 |
| BackTop | React Rocket 图案、64px 尺寸、bottom 32/right 24、10px 入场、1.08 hover 尺寸、0.96 press 尺寸及 2px 位移；静止/hover 的轮廓阴影按 React 的 Gaussian σ10/14px 绘制，外扩画布不改变 64px 图案尺寸。 | 原生没有隐式浏览器 window 滚动器，需要指定目标 id/ref；120ms 查询滚动位置代替浏览器滚动事件。hover 阴影在两张缓存 SVG 间离散切换，尚无连续滤镜插值。 |

## 数据展示

| 页面 | 已覆盖的 React 契约与本次变化 | 仍有的原生差异 |
| --- | --- | --- |
| Card | 全部 13 色/14 pattern；真实虚线；hoverable 按 React 抬升 2px/0.3s；虚线卡片不抬升，仅补间描边色；表面调色板与阴影轨道、样式覆盖保留。 | 测量装饰在第一次尺寸采样后出现。 |
| Avatar | size/shape/src/alt/任意 icon 节点/gap/onError；真实图片错误回退及返回 false 的拒绝回退；原生自然文本测量控制字号，绘制后继续校正字体 hinting 导致的宽度取整。AvatarGroup 提供 maxCount/maxStyle/size/shape/gap、继承与子项优先、+N，以及 Avatar.Group 别名。 | 第一帧以基础字号绘制，测量后缩字；显式子内容字体样式可能影响最终适配。测量对象保持基础字号且不参与正常布局；收敛后不持续采样可见文字。 |
| Badge | 数字/字符串/任意节点 count、overflowCount、showZero、dot、尺寸、调色板、独立/包裹使用；空值隐藏；原生淡入。 | CSS scale 入场改为 opacity；浏览器 title tooltip 未自动提供；宽胶囊仍使用固定角点偏移。 |
| Collapse | 任意节点/数组的 question、answer，兼容具名插槽；0.3s AnimateHeight 开合和原受控扩展；圆形开关图标背景色原生补间。 | 鱼/字形旋转未还原；ARIA 无 DOM-id 引用。 |
| Tabs | 任意标签与文本/数组面板；受控/default/键盘；0.25s 透明度和 4px 面板入场；按当前 React 移除旧叶子装饰，deprecated leafAnimation 仍被接受；标签背景/文字色和选中阴影补间。 | ARIA 不提供 DOM-id 关系。 |
| Table | 列/表头/render/插槽、rows/key、stripe/loading/empty、scroll/client pagination；修复 pagination.onChange 被吞掉；PaginationProps 补齐回调类型；行 hover 背景色与圆角补间。 | 使用 flex 而非 HTML table；无 sticky header；loading 遮罩的 backdrop-filter: blur(2px) 尚未实现；fixed 列在 React 源码同样未实现。纵向滚动需置于其他滚动容器之外。 |
| Pagination | 受控/default 页码、pageSize、尺寸选择、jumper、总数、variants、change/showSizeChange；尺寸菜单沿用上方左对齐定位；页码/方向按钮颜色补间；方向 SVG 共享按钮的颜色动画目标，含 hover 与 disabled。 | 输入通过原生 valueRevision 保持受控同步；SVG 使用独立但同步的颜色轨道，尚非通用子元素颜色继承。 |
| Typewriter | speed、trigger、autoPlay、onDone、保留节点结构；原生组件默认插槽可嵌套逐字裁剪，保留组件状态、具名插槽和事件；文本总长度变化重播；autoPlay=false 显示全文并触发完成；额外 showCursor 保留。 | 与 React 一样按 UTF-16 字符截取；长度未改变的内容更新不重新播放；组件内部未通过默认插槽暴露的文本不参与裁剪。 |
| Image | variant/color、native load/error、单轴自然比例、preview；默认三层阴影按原顺序绘制；stamp 实际齿孔按 16px 节距及 5px 半径适配任意比例，暖纸和半色调纹理；stamp 照片通过原生 `img filter` 处理 saturate(0.93)/contrast(1.03)；底纸 SVG 串联两层 alpha 轮廓 drop-shadow，画布保留阴影外扩。 | 年份文字的字距/文字阴影尚未映射；预览缩放仍以透明度近似；lazy 仍由原生后台立即解码。滤镜属性变化生成新的缓存结果，非连续滤镜动画。 |
| Carousel | 受控/default、键盘、autoplay、焦点暂停、控件；18px 和 opacity 幻灯片入场；导航按钮颜色及指示点颜色/宽度补间。 | 非当前页卸载以移除 native focus/event hosts，不像 React 保留隐藏页的局部状态；没有同时保留旧页进行交叉淡出。 |
| Time | 实时时/分、星期/月日、冒号闪烁、透明度入场、原生 attrs。 | 闪烁遵循墙钟半秒而非 CSS 挂载相位；字距、tabular-nums 与 aria-live 元数据未全部映射。 |
| Countdown | number/Date 目标；DD/HH/mm/ss 与字面量；prefix；尺寸/variant/bordered；250ms change、finish 一次；20 面数字条始终向下滚动，跨循环落到等价面；island 真虚线。 | 固定宽度数字格代替 tabular-nums；aria-valuetext 代替浏览器 sr-only 文本。 |
| CountUp | 完整 start/end/duration/isCounting、暂停恢复、默认/指定小数、分组与小数分隔、内置/自定义 easing、formatter、updateInterval、prefix/suffix、size/variant/bordered、celebrate、update/complete、延时重播、渲染函数和 reset；island 真虚线。 | 数字由可取消的 16ms JS 时钟驱动，文案不变不重复提交。CSS scale/rotation 庆祝改为 native 位移、扩展光环和淡出星芒；原生状态文本代替 sr-only；OS reduced-motion 未自动映射。 |

## 工程内可扩展的能力与底层边界

上表记录当前实现；下列工程内路径已接入，通用合成能力仍单独列为边界。

GPUI 的外阴影绘制在完整填充下面，透明/半透明填充可露出边框盒内部的阴影；它不等同于 CSS 外阴影对内部区域的剔除规则。

- **颜色与盒阴影过渡已接入**：本地 [MotionStyle](../vue/src/types.ts) 与 [native motion](../native/src/motion.rs) 支持 `backgroundColor`、`color`、`borderColor`、`boxShadow`，和已有数字属性共享原生帧时钟及连续重定向。颜色按预乘 alpha 的 sRGB 插值；阴影长度和颜色一起补间，缺失层淡入/淡出，inset/outset 不兼容时在中点离散切换。Animal Island 的私有 `ColorSurface` / `surfaceMotion` 将交互状态转成动画目标，保留原生元素身份及事件，不通过逐帧 Vue 更新驱动颜色。文字子节点显式指定自己的颜色时不继承父级颜色轨道。
- **图片 CSS 滤镜已接入**：原生 `<img filter="…">` 支持顺序组合 `brightness`、`contrast`、`saturate`、`grayscale`、`sepia`、`invert`、`opacity`、`hue-rotate`、`blur` 和 `drop-shadow`。加工在 GPUI 后台资源任务中完成并缓存；颜色运算保留透明 alpha，blur/阴影在原图 `objectFit` 和圆角裁切后处理，外扩像素不改变原始布局盒。它是图片 prop，不是任意 `StyleDesc.filter`；滤镜列表本身尚不支持 motion 连续插值，也不支持 `url()`、字体相对长度或 Canvas 2D 的独立 filter 属性。
- **已知 SVG 透明轮廓阴影已补齐**：stamp 将 `0 2px 3px rgba(0,0,0,.35)` 与 `0 16px 26px rgba(0,0,0,.45)` 按 CSS 顺序串联，第二层包含第一层的 alpha；Tooltip island 沿有机路径绘制阴影；Rocket 使用正确的静止/hover σ10/14px。尺寸 SVG 缓存且预留外扩画布，真实文字和交互仍在原生树中。Rocket 两个滤镜状态仍离散替换，不将其描述为连续滤镜动画。
- **单色 SVG 变换仍可扩展**：GPUI 的 [Svg::with_transformation](../../zed/crates/gpui/src/elements/svg.rs) 已支持缩放、旋转和平移，但绑定层尚未提供通用对应接口。这不意味着普通组件树和全彩图像已有同等变换能力。
- **任意实时组件子树滤镜、背景模糊与通用变换仍未接入**：当前公开接口没有跨平台生产用的子树离屏合成和完整变换路径；`Window::paint_layer` 仅分组绘制顺序。此类功能需要进一步的底层能力或较大的本地渲染工程，并同时解决裁剪、输入命中、文本选择和 IME 坐标。单图 `blur()` 不等同于 Table loading 的 `backdrop-filter: blur(2px)`，也不能直接提供 Drawer 的背景子树缩放。

React Drawer 明确因首帧成本去掉了 blur，见[固定基线源码](https://github.com/guokaigdg/animal-island-ui/blob/c696d16167d01370f822f95db22340b05d837555/src/components/Drawer/Drawer.tsx#L145-L155)。其 pushBackground 与 Table loading 的背景模糊是两项独立差异。

## 动画生命周期与验证范围

按钮、表单控件、Card/Tag、Tabs/Pagination/Table 等表面、复制/关闭按钮的颜色与盒阴影使用扩展后的原生 motion；已有位移、选择反馈、面板和数字条继续使用同一帧时钟。图片滤镜在后台生成缓存资源，不能由这些颜色轨道推断为也支持连续插值。VNode 输入内容与原生绘制必须分开验收：宿主测试能够验证 API、定时器、事件和 mutation，不能证明 SVG 裁剪或最终像素与浏览器一致。

新增回归覆盖表单/数据别名、Select 搜索/过滤/清空、原生选择动画、VNode 内容、Tooltip 事件组合、虚线/纹理/轮廓、CountUp 生命周期、Countdown 循环、Avatar 缩字、Typewriter 重播/嵌套组件和 CodeBlock 命令检测/复制动画。对应测试位于 `tests/react-*.test.ts`，包括 `react-progress-surface.test.ts`、`react-typewriter-components.test.ts` 及 Countdown、Tooltip 的真实窗口用例。

Skeleton 的 `loading-skeleton.test.ts` 验证共享宽度查询、零逐帧 mutation、尺寸变化、独立完成循环及停用/卸载清理；`skeleton-native.test.ts` 使用冻结的原生时钟检查移动距离、五停高光中点像素、矩形溢出裁剪及循环重启，不将该测试当作圆角子树裁剪证据。

本轮新增的 `form-surface-motion.test.ts`、`surface-motion.test.ts` 和 `svg-effects.test.ts` 验证状态目标、事件/ref 与 SVG 几何缓存；`surface-motion-native.test.ts`、Vue 的 `motion-paint-native.test.ts` 和 `img-filters.test.tsx` 提供真实像素回归，检查中间色、透明度、阴影顺序、滤镜颜色、透明边缘、放大图片的 CSS 模糊半径及切源。只有支持截图的原生测试渲染器运行像素断言，Linux 跳过情况不作为像素通过证据。

已实测真实原生窗口：冻结 native clock 后，Countdown 一格数字条从 y=24 经过 y=48 到 y=55，验证 31px 位移的中间画面；Avatar 的自然文本宽 96px，缩后宽 32px，满足 40px 头像两侧各 4px 的 gap。原生窗口测试不抢焦点，Linux CI 没有 display 时仅跳过该窗口用例。

Vue `AnimatePresence` 修复了同一离场子树内多个 motion/usePresence 后代的完成汇总：所有已注册参与者完成后才释放子树，已完成、重复上报和卸载参与者分别处理。三个宿主回归验证这一生命周期，避免为 Animal Island 增加动画后造成 Modal/Notification 等子树提前退出或无法退出。该修复不修改 GPUI/Zed 的行为。

各平台的截图、完整测试数量与最终画廊回归结果以本次提交的验证记录为准。本文明确保留的近似和缺口仍需原生能力、设计取舍或后续专项对照，不能用“40 个页面已覆盖”代替完整视觉保真声明。
