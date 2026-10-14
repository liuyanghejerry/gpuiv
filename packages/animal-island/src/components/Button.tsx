/** Button — GPUIV port of animal-island-vue's `Button.vue`.
 *
 *  Fidelity notes (see issue #164):
 *  - The signature 3D press (`box-shadow: 0 5px 0` + `translateY(2px)` on
 *    active) keeps the hard-shadow swap; the translate is dropped (GPUIV has
 *    no transforms).
 *  - `dashed` renders a solid border (no border styles in GPUIV).
 *  - `loading` drops the animated repeating-gradient stripes; it keeps the
 *    teal fill + 4px border and shows pulsing dots via the native Spinner.
 */

import { defineComponent, inject, ref, type PropType } from "vue"
import { Spinner, type EventPayload, type StyleDesc } from "@gpuiv/vue"
import { borderWidth, colors, fontSize, fonts, height, radius, shadows, spacing } from "../tokens.js"
import { activationKeys } from "../interaction.js"
import { FormContextKey } from "../form/context.js"

export type ButtonType = "primary" | "default" | "dashed" | "text" | "link"
export type ButtonSize = "small" | "middle" | "large"
export type ButtonHTMLType = "submit" | "reset" | "button"

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
    icon: { type: String, default: undefined },
    onClick: { type: Function as PropType<(e: EventPayload) => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const focused = ref(false)
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
        // Striped-motion approximation: solid teal + thick light border.
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

      return (
        <div
          {...attrs}
          role="button"
          tabIndex={props.disabled ? -1 : ((attrs.tabIndex as number | undefined) ?? 0)}
          aria-disabled={props.disabled || undefined}
          testId={props.testId}
          onFocus={() => (focused.value = true)}
          onBlur={() => (focused.value = false)}
          onClick={inactive ? undefined : activate}
          onKeyDown={inactive ? undefined : activationKeys(activate)}
          style={{ ...(fonts.sans ? { fontFamily: fonts.sans } : {}), ...style }}
        >
          {props.loading ? <Spinner size={14} color="#ffffff" /> : props.icon ? <text>{props.icon}</text> : slots.icon?.()}
          {slots.default?.()}
        </div>
      )
    }
  },
})

export default Button
