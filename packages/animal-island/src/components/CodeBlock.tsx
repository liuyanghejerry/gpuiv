/** CodeBlock — GPUIV port of animal-island-vue's `CodeBlock.vue`.
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - 语法高亮: 原版手写正则 tokenizer（只认 JS/TS/JSX，11 个硬编码色）→ 直接换
 *    GPUIV 原生 `<code>` 元素（Rust Syntect，全语言、流式增量高亮）——这是升级
 *    而非降级。原版色板映射到最近的 syntax capture：comment/string/keyword/
 *    number/tag(jsx)/function/property/operator/constructor(component)/
 *    functionBuiltin(react hooks)。Syntect 按 TextMate scope 着色，无法逐 token
 *    复刻原版的正则分类，配色为近似；默认文字色 #e8d5bc 与原 pre 一致。
 *  - 新增 props: `language`（默认 "tsx"，原版无此 prop、tokenizer 写死）与
 *    `showLineNumbers`（原生能力，默认 false 保持原版外观）。
 *  - 卡片: 深暖棕底 #2b2118、1px 边 #3d3028、radius 20、padding 20/24、
 *    fontSize 14、fontWeight 600、文字 #e8d5bc —— 全部取原版 Less 精确值。
 *    原生 `<code>` 不画任何底衬，surface 由它的 style 承担（见 reference.md）。
 *  - 行高: 原版 `line-height: 1.7` → 23.8px（GPUIV lineHeight 是 px，14×1.7）。
 *  - 滚动: 原版 pre `overflow: auto`（纵横双向内滚）→ 原生 `<code>` 自身就是
 *    水平滚动容器、永不折行（whiteSpace/overflowX 无效化）；原版无 max-height，
 *    垂直本就全高，没有嵌套滚动要砍。
 *  - 复制: `navigator.clipboard.writeText` + execCommand 降级 →
 *    `renderer.writeClipboardText`（同步调用，GPUIV 无 DOM 降级路径；renderer
 *    或方法缺失时进入 error 态）。状态机 idle/copied/error 与 2s 自动复位原样
 *    保留；copied 文案按任务要求加 ✓（原版为"已复制"）。
 *  - 复制按钮: absolute top 12 right 12、min-width 62、height 32、padding 0 12、
 *    1px 边 rgba(232,213,188,0.3)、radius 50px→radius.pill、
 *    底 rgba(61,48,40,0.94)、hover 底 #4b3b31（原版 hover 的 translateY(-1px)
 *    砍掉——GPUIV 无 transform）、focus-visible `outline: 2px solid #19c8b9
 *    offset 2` → GPUIV 结构化 outline（用本地 focused 状态模拟 :focus-visible）。
 *  - style 拆分: 原版把 width/minWidth/maxWidth/margin* 分到外层 wrapper、其余
 *    分到 pre 的规则原样保留；"pre" 一侧在移植中作用到 `<code>` 的 style
 *    （它就是卡片 surface）。有复制按钮且用户未给 padding/paddingRight 时自动
 *    paddingRight: 96 给按钮留位（原版同款逻辑）；用户给了 padding 简写则四边
 *    全归用户（Rust 端先应用 padding 再应用单侧，这里不再另发单侧默认值）。
 *  - 外边距: wrapper `margin: 1em 0` → marginTop/Bottom 14（库基础字号 14px；
 *    GPUIV 无 em 单位）。用户给了 margin 简写则不再发默认上下边距。
 *  - 等宽字体栈 'SF Mono','Fira Code',… → 砍掉（GPUIV fontFamily 只收单值；
 *    用原生 theme 的 fontMono 默认）。`tab-size: 4` 无对应 style → 砍掉。
 *  - class/style 之外的 attrs 透传到 wrapper 根 div（原版透传到 pre；GPUIV 无
 *    class，一并剥除）。
 */

import { defineComponent, onBeforeUnmount, ref, type PropType } from "vue"
import { useGpuix, type EventPayload, type GpuixTheme, type StyleDesc } from "@gpuiv/vue"
import { colors, fontSize, fonts, radius } from "../tokens.js"
import { activationKeys } from "../interaction.js"

export interface CodeBlockProps {
  /** 要高亮的源码 */
  code: string
  /** 是否显示复制按钮，默认 true */
  copyable?: boolean
  /** Syntect 语言（新增 prop；原版 tokenizer 写死 JS/TS/JSX） */
  language?: string
  /** 行号（原生能力；默认 false 保持原版外观） */
  showLineNumbers?: boolean
  /** 复制成功回调（原版 emit('copy', code)） */
  onCopy?: (code: string) => void
  testId?: string
}

export type CodeBlockCopyStatus = "idle" | "copied" | "error"

/** 卡片配色（原版 CodeBlock.vue Less 精确值）。 */
const CARD_BG = "#2b2118"
const CARD_BORDER = "#3d3028"
const CARD_TEXT = "#e8d5bc"

/** 原版行高 1.7 × fontSize 14（GPUIV lineHeight 为 px）。 */
const CODE_LINE_HEIGHT = 23.8

/** 原版手写 tokenizer 的 11 色 → 原生 syntax capture 的最近映射（见文件头）。 */
const CODE_THEME: GpuixTheme = {
  appearance: "dark",
  bg: CARD_BG,
  border: CARD_BORDER,
  text: CARD_TEXT,
  textMuted: "#6b5e50",
  syntax: {
    comment: "#6b5e50",
    string: "#a8d4a0",
    stringSpecial: "#a8d4a0",
    keyword: "#d4a0e0",
    // 原版 true/false/null/undefined/NaN/Infinity 同 keyword 色。
    boolean: "#d4a0e0",
    constant: "#d4a0e0",
    number: "#a8d4a0",
    tag: "#f0a870",
    attribute: "#e8c87a",
    constructor: "#80c0e0",
    typeName: "#80c0e0",
    function: "#61afef",
    // 原版给 React hooks/API 的独立色；Syntect 无此 scope，寄到 functionBuiltin。
    functionBuiltin: "#e06c75",
    property: "#e8c87a",
    operator: "#d4b896",
  },
}

const COPY_STATUS_CONTENT: Record<CodeBlockCopyStatus, { text: string; label: string }> = {
  idle: { text: "复制", label: "复制代码" },
  copied: { text: "✓ 已复制", label: "代码已复制" },
  error: { text: "复制失败", label: "代码复制失败" },
}

/** 与原版 WRAPPER_STYLE_KEYS 一致：尺寸/外边距作用到外层 wrapper，其余作用到卡片。 */
const WRAPPER_STYLE_KEYS = new Set([
  "width",
  "minWidth",
  "maxWidth",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
])

function splitStyle(style: StyleDesc | undefined): { wrapper: StyleDesc; card: StyleDesc } {
  const wrapper: StyleDesc = {}
  const card: StyleDesc = {}
  if (!style) return { wrapper, card }
  for (const [key, value] of Object.entries(style)) {
    if (WRAPPER_STYLE_KEYS.has(key)) (wrapper as Record<string, unknown>)[key] = value
    else (card as Record<string, unknown>)[key] = value
  }
  return { wrapper, card }
}

/** 原版逻辑：用户给了 padding 简写 → 四边全归用户（不再自动留按钮位）；
 *  否则单侧可取用户值，缺省回落到 Less 的 20/24，copyable 时 paddingRight 96。 */
function resolvePadding(card: StyleDesc, copyable: boolean): StyleDesc {
  if (card.padding !== undefined) {
    const out: StyleDesc = { padding: card.padding }
    if (card.paddingTop !== undefined) out.paddingTop = card.paddingTop
    if (card.paddingRight !== undefined) out.paddingRight = card.paddingRight
    if (card.paddingBottom !== undefined) out.paddingBottom = card.paddingBottom
    if (card.paddingLeft !== undefined) out.paddingLeft = card.paddingLeft
    return out
  }
  return {
    paddingTop: card.paddingTop ?? 20,
    paddingRight: card.paddingRight ?? (copyable ? 96 : 24),
    paddingBottom: card.paddingBottom ?? 20,
    paddingLeft: card.paddingLeft ?? 24,
  }
}

export const CodeBlock = defineComponent({
  name: "AnimalCodeBlock",
  inheritAttrs: false,
  props: {
    code: { type: String, required: true },
    copyable: { type: Boolean, default: true },
    language: { type: String, default: "tsx" },
    showLineNumbers: { type: Boolean, default: false },
    onCopy: { type: Function as PropType<(code: string) => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    const { renderer } = useGpuix()
    const copyStatus = ref<CodeBlockCopyStatus>("idle")
    const focused = ref(false)
    let resetTimer: ReturnType<typeof setTimeout> | undefined

    onBeforeUnmount(() => clearTimeout(resetTimer))

    function handleCopy() {
      clearTimeout(resetTimer)
      try {
        if (!renderer?.writeClipboardText) throw new Error("clipboard unavailable")
        renderer.writeClipboardText(props.code)
        copyStatus.value = "copied"
        props.onCopy?.(props.code)
      } catch {
        copyStatus.value = "error"
      }
      resetTimer = setTimeout(() => {
        copyStatus.value = "idle"
      }, 2_000)
    }

    return () => {
      // class 无对应概念、style 走拆分，其余 attrs 透传到 wrapper（原版透传到 pre）。
      const { class: _class, style: attrStyle, ...restAttrs } = attrs
      const split = splitStyle(attrStyle as StyleDesc | undefined)
      // padding 键由 resolvePadding 统一裁决，避免与默认值重复来源。
      const {
        padding: _p,
        paddingTop: _pt,
        paddingRight: _pr,
        paddingBottom: _pb,
        paddingLeft: _pl,
        ...cardRest
      } = split.card

      const wrapperStyle: StyleDesc = {
        position: "relative",
        minWidth: 0,
        // margin: 1em 0（库基础字号 14px）；用户给 margin 简写则全归用户。
        ...(split.wrapper.margin === undefined
          ? { marginTop: fontSize.base, marginBottom: fontSize.base }
          : {}),
        ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
        ...split.wrapper,
      }

      const codeStyle: StyleDesc = {
        width: "100%",
        minWidth: 0,
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: CARD_BORDER,
        borderRadius: radius.card,
        fontSize: fontSize.base,
        lineHeight: CODE_LINE_HEIGHT,
        fontWeight: 600,
        color: CARD_TEXT,
        ...resolvePadding(split.card, props.copyable),
        ...cardRest,
      }

      const statusContent = COPY_STATUS_CONTENT[copyStatus.value]

      const copyButtonStyle: StyleDesc = {
        position: "absolute",
        top: 12,
        right: 12,
        minWidth: 62,
        height: 32,
        paddingLeft: 12,
        paddingRight: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: "rgba(232, 213, 188, 0.3)",
        borderRadius: radius.pill,
        backgroundColor: "rgba(61, 48, 40, 0.94)",
        color: CARD_TEXT,
        fontSize: fontSize.sm,
        fontWeight: 700,
        cursor: "pointer",
        userSelect: "none",
        // 原版 hover 的 translateY(-1px) 砍掉（无 transform），保留底色变化。
        hover: { backgroundColor: "#4b3b31" },
        ...(focused.value ? { outline: { width: 2, color: colors.primary, offset: 2 } } : {}),
      }

      return (
        <div {...restAttrs} testId={props.testId} style={wrapperStyle}>
          <code
            code={props.code}
            language={props.language}
            showLineNumbers={props.showLineNumbers}
            theme={CODE_THEME}
            style={codeStyle}
          />
          {props.copyable ? (
            <div
              role="button"
              tabIndex={0}
              aria-label={statusContent.label}
              onClick={() => handleCopy()}
              onKeyDown={activationKeys(() => handleCopy())}
              onFocus={() => (focused.value = true)}
              onBlur={() => (focused.value = false)}
              style={copyButtonStyle}
            >
              <text>{statusContent.text}</text>
            </div>
          ) : null}
        </div>
      )
    }
  },
})

export default CodeBlock
