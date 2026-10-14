/** Tooltip — GPUIV port of animal-island-vue's `Tooltip.vue`.
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - 结构与定位: 原版用相对定位的绝对气泡 + z-index → 平台 headless Tooltip 族
 *    (`Tooltip`/`TooltipTrigger`/`TooltipContent` from '@gpuiv/vue'，deferred
 *    anchored 层，永远画在最上)。`trigger: 'click'` 原版是点击开关，headless
 *    不支持（它的 click 是“关闭”）→ 该模式改用受控 open + `FloatingLayer` 手动实现。
 *  - 气泡配色: 原版 Less 是奶油底 rgb(247,243,223) + 暖棕文字 #725d42 + 沙色
 *    2px 描边 #c4b89e（任务建议的“深棕底 #794f27 + 奶油字”与原版相反；按
 *    “视觉保真优先用 Less 精确数值”保留原版奶油底）。
 *  - 箭头: 原版 `::after` 是旋转 45° 的 8px 方块（GPUIV 无 transform）→
 *    `<svg>` 单色 tint 三角（data URL，12×6 / 6×12，45° 斜边）。带边框时两层
 *    三角堆叠：外层描边色满幅、内层奶油色向气泡方向偏移 ~2.5px（≈ borderWidth /
 *    sin45°），露出两条斜边描边，同时盖住气泡边缘的接缝（CSS 里箭头顶角也是
 *    描边色，效果一致）。island + borderless 的 14px 圆形 tail 原版就是圆 →
 *    用 `borderRadius: pill` 的 div 精确还原；island + bordered 的菱形 tail →
 *    三角近似。箭头装在气泡内一条 absolute 全宽/全高的 strip 里（超出气泡 4px、
 *    重叠 2px 遮接缝），居中对齐用 flex justifyContent，start/end 按原版
 *    Less 的 16px（上下）/ 12px（左右）、island 的 20px / 16px 内缩。
 *  - 12 种 placement → headless side/align 映射；气泡到触发器的 10px 间距 =
 *    anchored gap 6 + 箭头 4px 悬伸。
 *  - 入场/出场: 原版 opacity + translateY(4px) 0.25s 过渡 → 砍掉（deferred 层的
 *    强制不透明底衬无法随气泡一起淡出；headless 行为本就是即显即隐）。
 *  - hide 延迟 100ms → headless scheduleClose 80ms；hover 打开原本无延迟，新增
 *    `delay` prop（任务要求）透传 headless `delayDuration`。
 *  - `variant: 'island'` 的 clip-path 有机外形 → 大圆角矩形（GPUIV 无 clip-path）；
 *    `filter: drop-shadow(0 4px 14px rgba(121,79,39,0.14))` → 同参数结构化
 *    boxShadow（GPUIV 无 filter，但单阴影可表达）。
 *  - `white-space: pre-line` → <text> 直接排 `\n`（GPUIV whiteSpace 仅
 *    normal/nowrap）；`word-break: break-word` 与 `letter-spacing: 0.01em` 砍掉。
 *  - `trigger: 'hover' | 'focus'` → headless 同时挂 hover+focus 双通道（比原版
 *    单通道略宽：hover 模式下键盘聚焦也会弹出，视为可访问性增强）。
 */

import { defineComponent, h, ref, type PropType, type VNode } from "vue"
import {
  FloatingLayer,
  Tooltip as HeadlessTooltip,
  TooltipContent,
  TooltipTrigger,
  floatingRootStyle,
  type FloatingAlign,
  type FloatingSide,
  type StyleDesc,
} from "@gpuiv/vue"
import { borderWidth, colors, fontSize, fonts, radius, shadows } from "../tokens.js"
import { activationKeys } from "../interaction.js"

export type TooltipPlacement =
  | "top"
  | "top-start"
  | "top-end"
  | "bottom"
  | "bottom-start"
  | "bottom-end"
  | "left"
  | "left-start"
  | "left-end"
  | "right"
  | "right-start"
  | "right-end"

export type TooltipTriggerMode = "hover" | "focus" | "click"

/** default 标准矩形；island 不规则有机气泡 */
export type TooltipVariant = "default" | "island"

/* ── Palette (from the original Less block) ────── */

/** rgb(247, 243, 223) — @tooltip-bg */
const BUBBLE_BG = "#f7f3df"
/** @tooltip-border */
const BUBBLE_BORDER = "#c4b89e"
/** Island drop-shadow(0 4px 14px rgba(121,79,39,0.14)) as a struct. */
const ISLAND_SHADOW = { offsetX: 0, offsetY: 4, blurRadius: 14, spreadRadius: 0, color: "rgba(121, 79, 39, 0.14)" }

/* ── Arrow geometry ────────────────────────────── */

/** Triangle bounding box; 45° slanted edges like the original rotated square. */
const ARROW_LEN = 12
const ARROW_THICK = 6
/** Arrow strip overlap into the bubble — hides the border seam. */
const ARROW_OVERLAP = 2
/** Inner triangle offset toward the bubble ≈ borderWidth / sin(45°). */
const ARROW_INNER_SHIFT = 2.5
/** Island borderless tail diameter (original: 14px circle). */
const ISLAND_TAIL = 14

type ArrowDirection = "up" | "down" | "left" | "right"

const TRIANGLE: Record<ArrowDirection, { viewBox: string; d: string }> = {
  down: { viewBox: "0 0 12 6", d: "M0 0L12 0L6 6Z" },
  up: { viewBox: "0 0 12 6", d: "M0 6L12 6L6 0Z" },
  right: { viewBox: "0 0 6 12", d: "M0 0L6 6L0 12Z" },
  left: { viewBox: "0 0 6 12", d: "M6 0L0 6L6 12Z" },
}

const arrowUrlCache = new Map<ArrowDirection, string>()

/** `data:image/svg+xml;base64,…` triangle, tinted through `style.color`. */
function triangleUrl(direction: ArrowDirection): string {
  const cached = arrowUrlCache.get(direction)
  if (cached !== undefined) return cached
  const { viewBox, d } = TRIANGLE[direction]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><path d="${d}" fill="#000"/></svg>`
  const url = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`
  arrowUrlCache.set(direction, url)
  return url
}

const SIDE_ARROW: Record<FloatingSide, ArrowDirection> = {
  top: "down",
  bottom: "up",
  left: "right",
  right: "left",
}

function parsePlacement(placement: TooltipPlacement): { side: FloatingSide; align: FloatingAlign } {
  const [side, align] = placement.split("-") as [FloatingSide, FloatingAlign | undefined]
  return { side, align: align ?? "center" }
}

/** The arrow strip: absolutely positioned inside the bubble, overhanging
 *  `ARROW_THICK - ARROW_OVERLAP` px past the bubble edge. */
function arrowStrip(props: {
  side: FloatingSide
  align: FloatingAlign
  bordered: boolean
  variant: TooltipVariant
}): VNode {
  const { side, align, bordered, variant } = props
  const horizontal = side === "top" || side === "bottom"
  // Original Less edge insets: default 16px (top/bottom-start) & 12px
  // (left/right-start); island relaxes to 20px / 16px.
  const edgeInset = variant === "island" ? (horizontal ? 20 : 16) : horizontal ? 16 : 12

  const strip: StyleDesc = { position: "absolute", display: "flex" }
  if (align === "center") strip.justifyContent = "center"
  else if (align === "start") {
    strip.justifyContent = "flex-start"
    if (horizontal) strip.paddingLeft = edgeInset
    else strip.paddingTop = edgeInset
  } else {
    strip.justifyContent = "flex-end"
    if (horizontal) strip.paddingRight = edgeInset
    else strip.paddingBottom = edgeInset
  }

  const circleTail = variant === "island" && !bordered
  const thick = circleTail ? ISLAND_TAIL : ARROW_THICK
  const overhang = thick - ARROW_OVERLAP
  if (side === "top") Object.assign(strip, { left: 0, right: 0, bottom: -overhang, height: thick })
  else if (side === "bottom") Object.assign(strip, { left: 0, right: 0, top: -overhang, height: thick })
  else if (side === "left") Object.assign(strip, { top: 0, bottom: 0, right: -overhang, width: thick, flexDirection: "column" })
  else Object.assign(strip, { top: 0, bottom: 0, left: -overhang, width: thick, flexDirection: "column" })

  if (circleTail) {
    return (
      <div style={strip}>
        <div style={{ width: ISLAND_TAIL, height: ISLAND_TAIL, borderRadius: radius.pill, backgroundColor: BUBBLE_BG, flexShrink: 0 }} />
      </div>
    )
  }

  const direction = SIDE_ARROW[side]
  const box: StyleDesc = {
    position: "relative",
    width: horizontal ? ARROW_LEN : ARROW_THICK,
    height: horizontal ? ARROW_THICK : ARROW_LEN,
    flexShrink: 0,
  }
  const triangleStyle: StyleDesc = { width: "100%", height: "100%" }

  if (!bordered) {
    return (
      <div style={strip}>
        <div style={box}>
          <svg src={triangleUrl(direction)} style={{ ...triangleStyle, color: BUBBLE_BG }} />
        </div>
      </div>
    )
  }

  // Bordered: an outer border-coloured triangle plus an inner bubble-coloured
  // one shifted toward the bubble, exposing the two slanted border edges and
  // covering the seam where the arrow meets the bubble border.
  const innerShift: StyleDesc =
    direction === "down"
      ? { top: -ARROW_INNER_SHIFT, left: 0 }
      : direction === "up"
        ? { top: ARROW_INNER_SHIFT, left: 0 }
        : direction === "right"
          ? { left: -ARROW_INNER_SHIFT, top: 0 }
          : { left: ARROW_INNER_SHIFT, top: 0 }
  return (
    <div style={strip}>
      <div style={box}>
        <svg src={triangleUrl(direction)} style={{ ...triangleStyle, color: BUBBLE_BORDER }} />
        <svg src={triangleUrl(direction)} style={{ ...triangleStyle, position: "absolute", ...innerShift, color: BUBBLE_BG }} />
      </div>
    </div>
  )
}

function bubbleStyle(variant: TooltipVariant, bordered: boolean): StyleDesc {
  const font: StyleDesc = fonts.sans ? { fontFamily: fonts.sans } : {}
  if (variant === "island") {
    return {
      ...font,
      position: "relative",
      maxWidth: 280,
      paddingTop: 12,
      paddingBottom: 12,
      paddingLeft: 20,
      paddingRight: 20,
      backgroundColor: BUBBLE_BG,
      borderRadius: 20, // organic clip-path blob → generous rounded rect
      borderWidth: bordered ? borderWidth : 0,
      borderColor: BUBBLE_BORDER,
      boxShadow: ISLAND_SHADOW,
      color: colors.warmSoft,
      fontSize: fontSize.sm,
      fontWeight: 600,
      lineHeight: fontSize.sm * 1.55,
      textAlign: "center",
    }
  }
  return {
    ...font,
    position: "relative",
    maxWidth: 240,
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 12,
    paddingRight: 12,
    backgroundColor: BUBBLE_BG,
    borderRadius: radius.sm, // @border-radius-sm = 16
    borderWidth: bordered ? borderWidth : 0,
    borderColor: BUBBLE_BORDER,
    boxShadow: shadows.base, // @shadow-base
    color: colors.warmSoft, // #725d42
    fontSize: fontSize.sm, // @font-size-sm = 12
    fontWeight: 500,
    lineHeight: fontSize.sm * 1.5,
  }
}

export const Tooltip = defineComponent({
  name: "AnimalTooltip",
  inheritAttrs: false,
  props: {
    /** 提示内容，`\n` 换行；title 插槽可提供更丰富的内容（插槽优先） */
    title: { type: String, default: undefined },
    /** title 的别名（title 优先），对齐 antd 系命名 */
    content: { type: String, default: undefined },
    /** 位置 */
    placement: { type: String as PropType<TooltipPlacement>, default: "top" },
    /** 触发方式 */
    trigger: { type: String as PropType<TooltipTriggerMode>, default: "hover" },
    /** 视觉风格 */
    variant: { type: String as PropType<TooltipVariant>, default: "default" },
    /** 是否显示边框 */
    bordered: { type: Boolean, default: true },
    /** hover 打开延迟（毫秒），透传 headless delayDuration */
    delay: { type: Number, default: 0 },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    // `trigger: 'click'` state — the headless Tooltip closes on click instead
    // of toggling, so this mode drives a FloatingLayer by hand.
    const clickOpen = ref(false)
    const toggleClick = () => { clickOpen.value = !clickOpen.value }

    // The bubble visuals ride on the floating layer's own `style`: the inner
    // content div defaults to an opaque #1A1A1A fill, so styling a child div
    // instead would leave dark square corners peeking behind the rounded
    // bubble. The layer also mirrors borderRadius onto the anchored surface.
    const bubbleChildren = () => [
      slots.title ? slots.title() : <text>{props.title ?? props.content ?? ""}</text>,
      arrowStrip({
        side: parsePlacement(props.placement).side,
        align: parsePlacement(props.placement).align,
        bordered: props.bordered,
        variant: props.variant,
      }),
    ]

    return () => {
      const { side, align } = parsePlacement(props.placement)
      // 6px anchored gap + 4px arrow overhang = the original 10px tooltip-gap.
      const sideOffset = 6
      const style = bubbleStyle(props.variant, props.bordered)

      if (props.trigger === "click") {
        return (
          <div {...attrs} testId={props.testId} style={floatingRootStyle(attrs.style as StyleDesc | undefined)}>
            <div role="button" aria-label={props.title ?? props.content} tabIndex={0} onClick={toggleClick} onKeyDown={activationKeys(toggleClick)}
              testId={props.testId ? `${props.testId}-trigger` : undefined}>
              {slots.default?.()}
            </div>
            {clickOpen.value ? (
              <FloatingLayer {...{ role: "tooltip", testId: props.testId ? `${props.testId}-content` : undefined }} side={side} align={align} sideOffset={sideOffset} style={style}>
                {{ default: bubbleChildren }}
              </FloatingLayer>
            ) : null}
          </div>
        )
      }

      // h() rather than JSX: TooltipContent declares no props (everything is
      // attrs), so TSX rejects side/align/sideOffset; the platform's own
      // tooltip.tsx reaches for h(FloatingLayer, …) for the same reason.
      return h(
        HeadlessTooltip,
        { ...(attrs as Record<string, unknown>), testId: props.testId, delayDuration: props.delay },
        [
          h(TooltipTrigger, null, slots.default),
          h(TooltipContent, { side, align, sideOffset, style }, bubbleChildren),
        ]
      )
    }
  },
})

export default Tooltip
