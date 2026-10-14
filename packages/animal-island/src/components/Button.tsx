/** Button — GPUIV port of Animal Island's Vue and React buttons (MIT).
 *
 *  Fidelity notes (see issue #164):
 *  - Native relative-position motion preserves the React hover lift and
 *    hard-shadow press without changing siblings' layout.
 *  - Dashed outlines are measured SVG strokes over a transparent layout border.
 *  - Loading uses the React Donut artwork and counterclockwise 2.5s rotation
 *    baked into SVG frames; there is no native transform style.
 */

import { cloneVNode, defineComponent, h, inject, isVNode, ref, watch, type PropType, type VNodeChild } from "vue"
import { motion, type EventPayload, type StyleDesc } from "@gpuiv/vue"
import { borderWidth, colors, duration, ease, fontSize, fonts, height, radius, shadows, spacing } from "../tokens.js"
import { activationKeys } from "../interaction.js"
import { FormContextKey } from "../form/context.js"
import { ButtonLoadingIcon } from "./button-loading.js"
import { DashedBorderSurface } from "./border-decoration.js"

export type ButtonType = "primary" | "default" | "dashed" | "text" | "link"
export type ButtonSize = "small" | "middle" | "large"
export type ButtonHTMLType = "submit" | "reset" | "button"

export interface ButtonProps {
  type?: ButtonType
  size?: ButtonSize
  danger?: boolean
  ghost?: boolean
  block?: boolean
  loading?: boolean
  disabled?: boolean
  htmlType?: ButtonHTMLType
  icon?: VNodeChild
  onClick?: (event: EventPayload) => void
  testId?: string
  style?: StyleDesc
}

function forward(handler: unknown, event: EventPayload) {
  if (Array.isArray(handler)) handler.forEach(fn => forward(fn, event))
  else if (typeof handler === "function") handler(event)
}

function renderIcon(value: VNodeChild): VNodeChild {
  if (Array.isArray(value)) return value.map(renderIcon)
  if (isVNode(value)) return cloneVNode(value, { style: { ...value.props?.style, pointerEvents: "none" } })
  if (typeof value === "string" || typeof value === "number") return <text style={{ pointerEvents: "none" }}>{value}</text>
  return null
}

const sizeStyle: Record<ButtonSize, StyleDesc> = {
  small: { height: height.sm, paddingLeft: spacing.lg, paddingRight: spacing.lg, fontSize: fontSize.sm, borderRadius: radius.sm },
  middle: { height: height.middle, paddingLeft: 20, paddingRight: 20, fontSize: fontSize.base, borderRadius: radius.pill },
  large: { height: height.lg, paddingLeft: 32, paddingRight: 32, fontSize: fontSize.lg, borderRadius: radius.lg },
}

export const Button = defineComponent({
  name: "AnimalButton",
  inheritAttrs: false,
  props: {
    type: { type: String as PropType<ButtonType>, default: "default" },
    size: { type: String as PropType<ButtonSize>, default: "middle" },
    danger: { type: Boolean, default: false },
    ghost: { type: Boolean, default: false },
    block: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    htmlType: { type: String as PropType<ButtonHTMLType>, default: "button" },
    icon: { type: [String, Number, Boolean, Object, Array] as PropType<VNodeChild>, default: undefined },
    onClick: { type: Function as PropType<(e: EventPayload) => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const focused = ref(false)
    const hovered = ref(false)
    const pressed = ref(false)
    watch(() => props.disabled || props.loading, inactive => {
      if (inactive) { hovered.value = false; pressed.value = false }
    })
    const formContext = inject(FormContextKey, undefined)
    const activate = (e: EventPayload) => {
      if (props.disabled || props.loading) return
      props.onClick?.(e)
      if (props.htmlType === "submit") formContext?.value.form.submit()
      if (props.htmlType === "reset") formContext?.value.reset?.(e)
    }

    return () => {
      const c = colors
      const inactive = props.disabled || props.loading

      let variant: StyleDesc
      switch (props.type) {
        case "primary":
          variant = {
            color: c.warm,
            backgroundColor: c.cream,
            borderColor: c.cream,
            boxShadow: shadows.hard,
            hover: { boxShadow: shadows.hardHover },
            active: { boxShadow: shadows.hardActive },
          }
          break
        case "text":
          variant = {
            color: c.text,
            backgroundColor: "transparent",
            borderColor: "transparent",
            boxShadow: undefined,
            hover: { backgroundColor: c.bgSecondary },
            active: { backgroundColor: "#e9ddc6" },
          }
          break
        case "link":
          variant = {
            color: c.primary,
            backgroundColor: "transparent",
            borderColor: "transparent",
            boxShadow: undefined,
            hover: { color: c.primaryHover, opacity: 0.85 },
            active: { color: c.primaryActive },
          }
          break
        // Both variants share their palette. The original only changes
        // hover/active shadow for `default`; `dashed` retains the base shadow.
        case "dashed":
        case "default":
        default:
          variant = {
            color: c.text,
            backgroundColor: c.bg,
            borderColor: c.border,
            hover: { color: c.primary, borderColor: c.primary, ...(props.type === "dashed" ? {} : { boxShadow: shadows.base }) },
            active: { color: c.primaryActive, borderColor: c.primaryActive, ...(props.type === "dashed" ? {} : { boxShadow: shadows.sm }) },
          }
          break
      }

      // Follow the Less cascade: type, danger, then ghost. These modifiers
      // compose rather than choosing mutually exclusive branches.
      if (props.danger) {
        if (props.type === "primary") {
          Object.assign(variant, {
            color: "#ffffff", backgroundColor: c.error, borderColor: c.error,
            boxShadow: shadows.hardError,
            hover: { ...variant.hover, backgroundColor: c.errorHover, borderColor: c.errorHover, boxShadow: shadows.hardErrorHover },
            active: { ...variant.active, backgroundColor: c.errorActive, borderColor: c.errorActive, boxShadow: shadows.hardErrorActive },
          })
        } else if (props.type === "text" || props.type === "link") {
          variant.color = "#ffffff"
          variant.hover = { ...variant.hover, color: "#ffffff" }
          variant.active = { ...variant.active, color: "#ffffff" }
        } else {
          variant.color = c.error
          variant.borderColor = c.error
          variant.hover = { ...variant.hover, color: c.error, borderColor: c.errorHover }
          variant.active = { ...variant.active, color: c.error, borderColor: c.errorActive }
        }
      }
      if (props.ghost) {
        variant.backgroundColor = "transparent"
        variant.boxShadow = undefined
        if (props.type === "primary") {
          variant.color = c.primary
          // More-specific hover/active rules still supply their original
          // shadows. Ghost-primary changes the hover ink/fill/border only.
          variant.hover = { ...variant.hover, color: c.primaryHover, borderColor: c.primaryHover, backgroundColor: "rgba(25, 200, 185, 0.08)" }
        }
      }

      const style: StyleDesc = {
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.sm,
        fontWeight: 600,
        whiteSpace: "nowrap",
        userSelect: "none",
        borderWidth,
        borderColor: "transparent",
        boxShadow: shadows.sm,
        cursor: props.disabled ? "not-allowed" : inactive ? "default" : "pointer",
        ...(props.block ? { width: "100%" } : {}),
        ...sizeStyle[props.size],
        ...variant,
        ...(attrs.style as StyleDesc | undefined),
        ...(focused.value && !props.disabled
          ? { outline: { width: 2, color: c.primary, offset: 2 } }
          : {}),
      }

      if (props.loading) {
        // Original React loading palette, with a rotating Donut below.
        style.backgroundColor = "#0ec4b6"
        style.borderColor = "#4de2da"
        style.borderWidth = 4
        style.color = "#ffffff"
        style.boxShadow = undefined
        delete style.hover
        delete style.active
      }
      if (props.disabled) {
        style.opacity = 0.5
        style.boxShadow = undefined
        delete style.hover
        delete style.active
      }
      if (inactive) style.pointerEvents = "none"

      const lifts = props.type === "primary" || props.type === "default" || props.type === "dashed"
      const offset = inactive || !lifts ? 0 : pressed.value ? (props.type === "primary" ? 2 : 0) : hovered.value ? -1 : 0
      // Vue style bindings may carry pixel strings before host normalization.
      // Derive the lift from that value and leave other units to the host.
      const authoredTop: unknown = style.top
      const top = typeof authoredTop === "number" ? authoredTop
        : authoredTop === undefined ? 0
        : typeof authoredTop === "string" && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(authoredTop.trim())
          ? Number.parseFloat(authoredTop) : null
      const keyboardActivate = activationKeys(activate)
      const dashed = props.type === "dashed" && !props.loading
      const borderInk = (pressed.value ? style.active?.borderColor : hovered.value ? style.hover?.borderColor : undefined) ?? style.borderColor ?? "transparent"
      if (dashed) {
        style.borderColor = "transparent"
        if (style.hover) style.hover = { ...style.hover, borderColor: "transparent" }
        if (style.active) style.active = { ...style.active, borderColor: "transparent" }
      }

      return h(motion.div, {
          ...attrs,
          role: "button",
          tabIndex: props.disabled ? -1 : ((attrs.tabIndex as number | undefined) ?? 0),
          "aria-disabled": inactive || undefined,
          testId: props.testId,
          onFocus: (event: EventPayload) => { focused.value = true; forward(attrs.onFocus, event) },
          onBlur: (event: EventPayload) => { focused.value = false; pressed.value = false; forward(attrs.onBlur, event) },
          onMouseEnter: (event: EventPayload) => { if (!inactive) hovered.value = true; forward(attrs.onMouseEnter, event) },
          onMouseLeave: (event: EventPayload) => { hovered.value = false; pressed.value = false; forward(attrs.onMouseLeave, event) },
          onMouseDown: (event: EventPayload) => { if (!inactive && (event.button === undefined || event.button === 0)) pressed.value = true; forward(attrs.onMouseDown, event) },
          onMouseUp: (event: EventPayload) => { pressed.value = false; forward(attrs.onMouseUp, event) },
          onClick: inactive ? undefined : activate,
          onKeyDown: (event: EventPayload) => {
            forward(attrs.onKeyDown, event)
            if (inactive) return
            if (event.key === "enter" || event.key === "space") pressed.value = true
            keyboardActivate(event)
          },
          onKeyUp: (event: EventPayload) => { if (event.key === "enter" || event.key === "space") pressed.value = false; forward(attrs.onKeyUp, event) },
          initial: false,
          animate: top === null ? {} : { top: top + offset },
          transition: { duration: duration.base, ease },
          style: { ...(fonts.sans ? { fontFamily: fonts.sans } : {}), ...style },
        }, { default: () => [
          dashed ? h(DashedBorderSurface, { color: borderInk, width: typeof style.borderWidth === "number" ? style.borderWidth : borderWidth, radius: typeof style.borderRadius === "number" ? style.borderRadius : radius.pill }) : null,
          props.loading ? h(ButtonLoadingIcon, { testId: props.testId ? `${props.testId}-loading-icon` : undefined }) : renderIcon(props.icon ?? slots.icon?.()),
          slots.default?.(),
        ] })
    }
  },
})

export default Button
