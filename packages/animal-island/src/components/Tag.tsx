/** Tag — aligned with animal-island-ui's React Tag (MIT).
 * Palette, 24/32/40px sizing, variants and close/keyboard behavior are kept.
 * Dashed outlines use a measured SVG; clickable lift uses native top motion.
 * Shadow/colour changes remain immediate. Native clicks do not bubble, so
 * close controls naturally keep their press separate from the tag callback.
 */

import { defineComponent, ref, type PropType } from "vue"
import type { EventPayload, StyleDesc } from "@gpuiv/vue"
import { colors, fontSize, fonts, radius, spacing } from "../tokens.js"
import type { CardColor } from "../tokens.js"
import { activationKeys } from "../interaction.js"
import { DashedBorderSurface } from "./border-decoration.js"

export type TagSize = "small" | "medium" | "large"
export type TagVariant = "solid" | "outlined" | "dashed" | "soft"
/** Same thirteen-name palette as the original `TagColor`. */
export type TagColor = CardColor

/** Per-colour tokens from the Less custom properties. */
const tagColors: Record<Exclude<TagColor, "default">, { base: string; softBg: string; softText: string }> = {
  "app-pink": { base: "#f8a6b2", softBg: "#fce4ec", softText: "#c2185b" },
  purple: { base: "#b77dee", softBg: "#f3e5f5", softText: "#7b1fa2" },
  "app-blue": { base: "#889df0", softBg: "#e6f0ff", softText: "#1565c0" },
  "app-yellow": { base: "#f7cd67", softBg: "#fff8e1", softText: "#f9a825" },
  "app-orange": { base: "#e59266", softBg: "#fff3e0", softText: "#e65100" },
  "app-teal": { base: "#82d5bb", softBg: "#e0f2f1", softText: "#00695c" },
  "app-green": { base: "#8ac68a", softBg: "#e8f5e9", softText: "#2e7d32" },
  "app-red": { base: "#fc736d", softBg: "#ffebee", softText: "#c62828" },
  "lime-green": { base: "#d1da49", softBg: "#f1f8e9", softText: "#558b2f" },
  "yellow-green": { base: "#ecdf52", softBg: "#f9fbe7", softText: "#827717" },
  brown: { base: "#9a835a", softBg: "#efebe9", softText: "#4e342e" },
  "warm-peach-pink": { base: "#e18c6f", softBg: "#fbe9e7", softText: "#bf360c" },
}

/** Less heights 24/32/40 and paddings 10/12/16 — the size scale does not
 *  line up with the button-oriented `height` tokens, so these stay literal. */
const sizeStyle: Record<TagSize, StyleDesc> = {
  small: { height: 24, paddingLeft: 10, paddingRight: 10, fontSize: fontSize.sm },
  medium: { height: 32, paddingLeft: 12, paddingRight: 12, fontSize: fontSize.base },
  large: { height: 40, paddingLeft: 16, paddingRight: 16, fontSize: fontSize.lg },
}

function variantStyle(variant: TagVariant, color: TagColor): StyleDesc {
  if (color === "default") {
    switch (variant) {
      case "solid":
        return { backgroundColor: "#f7f3df", color: "#8f734f", borderColor: "#d4c4a8" }
      case "outlined":
      case "dashed": // solid-border approximation, see header
        return { backgroundColor: "transparent", color: "#8f734f", borderColor: "#c4b89e" }
      case "soft":
        return { backgroundColor: "#f5f0e6", color: "#8f734f", borderColor: "transparent" }
    }
  }
  const t = tagColors[color]
  switch (variant) {
    case "solid":
      return { backgroundColor: t.base, borderColor: t.base, color: "#ffffff" }
    case "outlined":
    case "dashed": // solid-border approximation, see header
      return { backgroundColor: "transparent", color: t.base, borderColor: t.base }
    case "soft":
      return { backgroundColor: t.softBg, color: t.softText, borderColor: "transparent" }
  }
}

const clickableShadow = { offsetX: 0, offsetY: 2, blurRadius: 6, spreadRadius: 0, color: "rgba(61, 52, 40, 0.12)" }

export const Tag = defineComponent({
  name: "AnimalTag",
  inheritAttrs: false,
  props: {
    size: { type: String as PropType<TagSize>, default: "medium" },
    variant: { type: String as PropType<TagVariant>, default: "soft" },
    color: { type: String as PropType<TagColor>, default: "default" },
    closable: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    onClick: { type: Function as PropType<(e: EventPayload) => void>, default: undefined },
    onClose: { type: Function as PropType<(e: EventPayload) => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const focused = ref(false)
    const closeFocused = ref(false)
    const hovered = ref(false)

    return () => {
      // The original derives interactivity from a registered click listener;
      // here that is the presence of the `onClick` callback prop.
      const interactive = !!props.onClick && !props.disabled

      const style: StyleDesc = {
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: spacing.xs,
        lineHeight: sizeStyle[props.size].fontSize,
        fontWeight: 600,
        borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: "transparent",
        userSelect: "none",
        whiteSpace: "nowrap",
        cursor: props.disabled ? "not-allowed" : interactive ? "pointer" : "default",
        ...sizeStyle[props.size],
        ...variantStyle(props.variant, props.color),
          ...(interactive ? { hover: { boxShadow: clickableShadow } } : {}),
        ...(attrs.style as StyleDesc | undefined),
        ...(focused.value && interactive
          ? { outline: { width: 2, color: colors.warning, offset: 2 } }
          : {}),
      }

      if (props.disabled) {
        style.opacity = 0.5
        style.pointerEvents = "none"
      }
      const dashedColor = style.borderColor ?? "#c4b89e"
      if (props.variant === "dashed") style.borderColor = "transparent"
      const forward = (name: string, event: EventPayload) => {
        const callbacks = attrs[name]
        for (const callback of Array.isArray(callbacks) ? callbacks : [callbacks]) if (typeof callback === "function") callback(event)
      }

      const close = (e: EventPayload) => {
        if (!props.disabled) props.onClose?.(e)
      }

      return (
        <div
          {...attrs}
          role={interactive ? "button" : undefined}
          tabIndex={interactive ? ((attrs.tabIndex as number | undefined) ?? 0) : undefined}
          aria-disabled={props.disabled || undefined}
          testId={props.testId}
          onFocus={() => (focused.value = true)}
          onBlur={() => (focused.value = false)}
          onMouseEnter={(event: EventPayload) => { hovered.value = true; forward("onMouseEnter", event) }}
          onMouseLeave={(event: EventPayload) => { hovered.value = false; forward("onMouseLeave", event) }}
          motion={interactive && typeof style.top !== "string" ? { initial: false, animate: { top: (typeof style.top === "number" ? style.top : 0) + (hovered.value ? -1 : 0) }, transition: { duration: 0.2, ease: "ease" } } : undefined}
          onClick={interactive ? (e: EventPayload) => props.onClick?.(e) : undefined}
          onKeyDown={interactive ? activationKeys((e) => props.onClick?.(e)) : undefined}
          style={{ ...(fonts.sans ? { fontFamily: fonts.sans } : {}), ...style }}
        >
          {props.variant === "dashed" ? <DashedBorderSurface color={String(dashedColor)} width={style.borderWidth ?? 1.5} radius={style.borderRadius ?? radius.pill} /> : null}
          {slots.default?.()}
          {props.closable ? (
            <div
              role="button"
              aria-label="close"
              tabIndex={props.disabled ? -1 : 0}
              onClick={close}
              onKeyDown={activationKeys(close)}
              onFocus={() => (closeFocused.value = true)}
              onBlur={() => (closeFocused.value = false)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginLeft: 2,
                marginRight: -4,
                width: 16,
                height: 16,
                borderRadius: 8,
                fontSize: 14,
                lineHeight: 14,
                backgroundColor: "rgba(149, 143, 143, 0.08)",
                cursor: props.disabled ? "not-allowed" : "pointer",
                hover: { backgroundColor: "rgba(0, 0, 0, 0.18)" },
                ...(closeFocused.value && !props.disabled
                  ? { outline: { width: 2, color: colors.warning, offset: 2 } }
                  : {}),
              }}
            >
              <text>×</text>
            </div>
          ) : null}
        </div>
      )
    }
  },
})

export type TagProps = Omit<InstanceType<typeof Tag>["$props"], "style"> & { style?: StyleDesc }

export default Tag
