/** Pill-shaped button — the app's core button style. */
import { defineComponent, h, type PropType } from "vue"
import { radius, shadowBtn } from "../tokens.js"
import type { StyleDesc } from "@gpuiv/vue"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "accent" | "success" | "quiet"
export type ButtonSize = "xs" | "sm" | "md"

function sizeStyle(size: ButtonSize): Record<string, unknown> {
  if (size === "xs") return { height: 28, borderRadius: radius.pill, paddingLeft: 10, paddingRight: 10, fontSize: 12, fontWeight: 400 }
  if (size === "sm") return { height: 27, borderRadius: radius.pill, paddingLeft: 12, paddingRight: 12, fontSize: 13, fontWeight: 400 }
  return { paddingLeft: 16, paddingTop: 9, paddingBottom: 9, fontSize: 14, borderRadius: radius.pill, fontWeight: 400 }
}

export const Button = defineComponent({
  name: "Button",
  props: {
    variant: { type: String as PropType<ButtonVariant>, default: "secondary" },
    size: { type: String as PropType<ButtonSize>, default: "md" },
    disabled: { type: Boolean, default: false },
    "aria-expanded": { type: Boolean, default: undefined as boolean | undefined },
  },
  setup(props, { attrs, slots }) {
    return () => {
      const variantStyle: Record<string, Record<string, unknown>> = {
        primary: { backgroundColor: "var(--ink)", color: "var(--canvas)", hover: { opacity: 0.9 } },
        secondary: { backgroundColor: "var(--surface)", color: "var(--ink)", boxShadow: shadowBtn, hover: { backgroundColor: "var(--inset)" } },
        ghost: { color: "var(--ink)", hover: { backgroundColor: "var(--hover)" } },
        accent: { backgroundColor: "var(--accent)", color: "#fff", hover: { backgroundColor: "var(--accentInk)" } },
        success: { backgroundColor: "var(--green)", color: "#fff", hover: { opacity: 0.95 } },
        quiet: { color: "var(--ink)", hover: { backgroundColor: "var(--hover)" } },
      }
      const v = variantStyle[props.variant] ?? variantStyle.secondary
      const style: Record<string, unknown> = {
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        userSelect: "none", transition: "opacity 150ms ease-out", cursor: "pointer", fontWeight: 500,
        ...sizeStyle(props.size), ...v,
      }
      if (props.disabled) { style.opacity = 0.5; style.pointerEvents = "none" }
      return h("button", { ...attrs, disabled: props.disabled || undefined, "aria-expanded": props["aria-expanded"], style }, [slots.default?.()])
    }
  },
})
