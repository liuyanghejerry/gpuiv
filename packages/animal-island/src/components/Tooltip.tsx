/** Tooltip — aligned with animal-island-ui's React Tooltip (MIT).
 * Twelve placements use deferred FloatingLayer. Hover, focus and click each
 * have their own trigger callbacks, composed onto the actual child because
 * native input does not bubble. Dismissal keeps React's 100ms grace period.
 * Island bubbles draw the original normalized SVG outline; their native
 * content is not clipped to that outline. The deferred layer uses rectangular
 * occlusion; native opacity/top/left tween the complete surface over 0.25s.
 * The 4px entrance offset follows the side, toward the trigger. Arrow triangles stand
 * in for rotated CSS squares; borderless island tails remain circles.
 */

import { cloneVNode, defineComponent, onBeforeUnmount, ref, watch, type PropType, type VNode, type VNodeChild } from "vue"
import {
  FloatingLayer,
  floatingRootStyle,
  type EventPayload,
  type FloatingAlign,
  type FloatingSide,
  type StyleDesc,
} from "@gpuiv/vue"
import { borderWidth, colors, ease, fontSize, fonts, radius, shadows } from "../tokens.js"
import { contentLabel, renderContent } from "./content.js"
import { OrganicSurface } from "./organic-surface.js"
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
/** Current React name; the prior native TooltipTriggerMode alias is retained. */
export type TooltipTrigger = TooltipTriggerMode

/** default 标准矩形；island 不规则有机气泡 */
export type TooltipVariant = "default" | "island"

/* ── Palette (from the original Less block) ────── */

/** rgb(247, 243, 223) — @tooltip-bg */
const BUBBLE_BG = "#f7f3df"
/** @tooltip-border */
const BUBBLE_BORDER = "#c4b89e"
/** React's filter follows the irregular silhouette, not the native rectangle. */
const ISLAND_SHADOWS = [{ offsetX: 0, offsetY: 4, stdDeviation: 14, color: "#794f27", opacity: 0.14 }]

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
      backgroundColor: "transparent",
      borderRadius: 0,
      borderWidth: 0,
      borderColor: BUBBLE_BORDER,
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
    title: { type: [String, Number, Object, Array, Boolean] as PropType<VNodeChild>, default: undefined },
    /** title 的别名（title 优先），对齐 antd 系命名 */
    content: { type: [String, Number, Object, Array, Boolean] as PropType<VNodeChild>, default: undefined },
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
    const open = ref(false)
    let showTimer: ReturnType<typeof setTimeout> | undefined
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    function cancelTimers() { clearTimeout(showTimer); clearTimeout(hideTimer) }
    function show() {
      cancelTimers()
      if (props.trigger === "hover" && props.delay > 0) showTimer = setTimeout(() => { open.value = true }, props.delay)
      else open.value = true
    }
    function hide() {
      clearTimeout(showTimer)
      clearTimeout(hideTimer)
      hideTimer = setTimeout(() => { open.value = false }, 100)
    }
    function toggle() { cancelTimers(); open.value = !open.value }
    onBeforeUnmount(cancelTimers)
    watch(() => props.trigger, () => { cancelTimers(); open.value = false })
    const bubbleChildren = () => [
      props.variant === "island" ? <OrganicSurface color={BUBBLE_BG} borderColor={props.bordered ? BUBBLE_BORDER : undefined} shadows={ISLAND_SHADOWS} /> : null,
      slots.title ? slots.title() : renderContent(props.title ?? props.content ?? ""),
      arrowStrip({ side: parsePlacement(props.placement).side, align: parsePlacement(props.placement).align, bordered: props.bordered, variant: props.variant }),
    ]
    function invoke(callbacks: unknown, event: EventPayload) {
      for (const callback of Array.isArray(callbacks) ? callbacks : [callbacks]) if (typeof callback === "function") callback(event)
    }

    return () => {
      const { side, align } = parsePlacement(props.placement)
      // React moves the hidden bubble 4px toward its trigger. Animate the
      // complete deferred surface, including its fill and tail, without
      // changing anchored placement or the trigger's layout.
      const horizontal = side === "left" || side === "right"
      const offset = side === "top" || side === "left" ? 4 : -4
      const entrance = {
        initial: { opacity: 0, ...(horizontal ? { left: offset } : { top: offset }) },
        animate: { opacity: 1, ...(horizontal ? { left: 0 } : { top: 0 }) },
        transition: { duration: 0.25, ease },
      }
      const handlers: Record<string, (event: EventPayload) => void> = props.trigger === "hover"
        ? { onMouseEnter: show, onMouseLeave: hide }
        : props.trigger === "focus" ? { onFocus: show, onBlur: hide }
        : { onClick: toggle, onKeyDown: activationKeys(toggle) }
      handlers.onKeyDown = props.trigger === "click" ? (event) => {
        if (event.key === "escape") { cancelTimers(); open.value = false }
        else activationKeys(toggle)(event)
      } : (event) => { if (event.key === "escape") { cancelTimers(); open.value = false } }
      const children = slots.default?.() ?? []
      // Native events do not bubble through a button's hitbox. Attach trigger
      // callbacks to the actual child, like React.cloneElement, and compose its
      // existing handlers. The wrapper handles plain text / multi-node slots.
      const child = children.length === 1 ? children[0] : null
      const renderedChildren = child ? [(() => {
        const extra: Record<string, unknown> = {}
        for (const [name, handler] of Object.entries(handlers)) extra[name] = (event: EventPayload) => {
          // Button-like components dispatch onClick for Enter/Space themselves.
          // Their keyboard callback must only add Escape dismissal.
          if (name === "onKeyDown" && props.trigger === "click" && typeof child.type !== "string") {
            if (event.key === "escape") { cancelTimers(); open.value = false }
          } else handler(event)
          invoke(child.props?.[name], event)
        }
        const clone = cloneVNode(child, extra)
        // cloneVNode merges listener arrays; the composed callback above has
        // already included the original, so keep one callable per event prop.
        Object.assign(clone.props!, extra)
        return clone
      })()] : children
      const label = props.title ?? props.content
      return <div {...attrs} testId={props.testId} style={floatingRootStyle(attrs.style as StyleDesc | undefined)}>
        <div role={props.trigger === "click" ? "button" : undefined}
          tabIndex={props.trigger === "focus" || props.trigger === "click" ? 0 : undefined}
          aria-label={contentLabel(label)}
          testId={props.testId ? `${props.testId}-trigger` : undefined} {...handlers}>
          {renderedChildren}
        </div>
        {open.value ? <FloatingLayer {...{ role: "tooltip", testId: props.testId ? `${props.testId}-content` : undefined,
          motion: entrance, ...(props.trigger === "hover" ? { onMouseEnter: show, onMouseLeave: hide } : {}) }}
          side={side} align={align} sideOffset={6} style={bubbleStyle(props.variant, props.bordered)}>
          {{ default: bubbleChildren }}
        </FloatingLayer> : null}
      </div>
    }
  },
})

export type TooltipProps = Omit<InstanceType<typeof Tooltip>["$props"], "style"> & { style?: StyleDesc }

export default Tooltip
