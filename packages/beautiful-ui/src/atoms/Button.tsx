/** Pill-shaped action button — the design system's core button style.
 *
 *  Ported from beautiful-ui `components/atoms/Button.tsx`. Degradations:
 *  `active:scale-[0.96]` becomes an opacity dip (GPUIV has no transform
 *  animation), the inset highlight on filled variants is dropped (single
 *  boxShadow), and the `transition` is GPUIV's native hover/active swap.
 */

import { defineComponent, type PropType } from "vue"
import type { StyleDesc } from "@gpuiv/vue"
import { radius } from "../tokens.js"
import { useTheme } from "../theme.js"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "accent" | "success" | "quiet"
export type ButtonSize = "xs" | "sm" | "md"

export const Button = defineComponent({
  name: "BuiButton",
  props: {
    variant: { type: String as PropType<ButtonVariant>, default: "secondary" },
    size: { type: String as PropType<ButtonSize>, default: "md" },
    disabled: { type: Boolean, default: false },
    /** Declared so TSX callers can pass it; forwarded to the root element. */
    onClick: { type: Function as PropType<() => void>, default: undefined },
    /** Automation handle; forwarded to the root element. */
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const theme = useTheme()
    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const variantStyle: Record<ButtonVariant, StyleDesc> = {
        primary: { backgroundColor: t.ink, color: t.canvas, hover: { opacity: 0.9 } },
        secondary: { backgroundColor: t.surface, color: t.ink, ...shadows.btn, hover: { backgroundColor: t.inset } },
        ghost: { backgroundColor: t.hover2, color: t.ink, hover: { backgroundColor: t.lineStrong } },
        accent: { backgroundColor: t.accent, color: "#ffffff", hover: { backgroundColor: t.accentInk } },
        success: { backgroundColor: t.green, color: "#ffffff", hover: { opacity: 0.95 } },
        quiet: { color: t.ink, hover: { backgroundColor: t.hover } },
      }
      const sizeStyle: Record<ButtonSize, StyleDesc> = {
        xs: { height: 28, paddingLeft: 10, paddingRight: 10, fontSize: 12, gap: 4 },
        sm: { height: 27, paddingLeft: 12, paddingRight: 12, fontSize: 13, gap: 6 },
        md: { paddingLeft: 16, paddingRight: 16, paddingTop: 9, paddingBottom: 9, fontSize: 14, gap: 8 },
      }
      const style: StyleDesc = {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.pill,
        userSelect: "none",
        cursor: props.disabled ? "default" : "pointer",
        fontWeight: 500,
        ...sizeStyle[props.size],
        ...variantStyle[props.variant],
        ...(attrs.style as StyleDesc | undefined),
      }
      if (props.disabled) {
        style.opacity = 0.5
        style.pointerEvents = "none"
      }
      return (
        <div
          {...attrs}
          role="button"
          aria-disabled={props.disabled || undefined}
          testId={props.testId}
          onClick={props.disabled ? undefined : props.onClick}
          style={style}
        >
          {slots.default?.()}
        </div>
      )
    }
  },
})
