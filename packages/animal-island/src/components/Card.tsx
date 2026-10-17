/** Card — ported from animal-island-vue Card.vue (MIT), tracked in #164.
 * Preserves palette and two-layer dot textures through measured SVG patterns.
 * Dashed borders use measured SVG strokes. React's opt-in hover lift uses a
 * native top tween; dashed cards only change border colour. Decoration never
 * receives pointer hits.
 */

import { defineComponent, ref, type PropType } from "vue"
import type { EventPayload, StyleDesc } from "@gpuiv/vue"
import { cardPattern, cardSolid, colors, fonts, radius, spacing } from "../tokens.js"
import type { CardColor } from "../tokens.js"
import { PatternSurface } from "../patterns.js"
import { DashedBorderSurface } from "./border-decoration.js"
import { ColorSurface } from "./surface-motion.js"

export type { CardColor } from "../tokens.js"
export type CardType = "default" | "dashed"
/** `none` = no pattern; `default` = the cream dotted card; a colour name
 *  paints that colour's dotted card independent of the `color` prop. */
export type CardPattern = "none" | "default" | Exclude<CardColor, "default">

/** `--pattern-default` row: cream tint + `#d4c4a8` border + warm ink
 *  (dots are supplied by PatternSurface). `cardPattern` in tokens only carries
 *  the twelve coloured rows. */
const defaultPattern = { bg: "#f7f3df", border: "#d4c4a8", text: colors.warmSoft }

export const Card = defineComponent({
  name: "AnimalCard",
  inheritAttrs: false,
  props: {
    type: { type: String as PropType<CardType>, default: "default" },
    color: { type: String as PropType<CardColor>, default: "default" },
    pattern: { type: String as PropType<CardPattern>, default: "none" },
    hoverable: { type: Boolean, default: false },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const hovered = ref(false)
    return () => {
      const style: StyleDesc = {
        position: "relative",
        fontWeight: 500,
        borderRadius: radius.card,
        paddingTop: spacing.lg,
        paddingBottom: spacing.lg,
        paddingLeft: spacing.xl,
        paddingRight: spacing.xl,
      }

      // Layer order mirrors the Less source order: type → color → pattern,
      // each later layer overriding the earlier one for the fields it sets.
      if (props.type === "dashed") {
        style.borderWidth = 2
        style.borderColor = "#e8dcc8"
        style.backgroundColor = "#faf8f2"
      } else {
        style.backgroundColor = "#f7f3df"
        style.color = colors.warmSoft
      }

      if (props.color !== "default") {
        const solid = cardSolid[props.color]
        style.backgroundColor = solid.bg
        style.color = solid.text
      }

      if (props.pattern !== "none") {
        const p = props.pattern === "default" ? defaultPattern : cardPattern[props.pattern]
        style.backgroundColor = p.bg
        style.color = p.text
        style.borderWidth = 1.5
        style.borderColor = p.border
      }

      if (props.hoverable) {
        style.cursor = "pointer"
      }

      const custom = attrs.style as StyleDesc | undefined
      const dashed = props.type === "dashed" && props.pattern === "none"
      const dashedColor = custom?.borderColor ?? (hovered.value && props.hoverable ? "#d4c4a8" : style.borderColor ?? "#e8dcc8")
      if (dashed) style.borderColor = "transparent"
      const finalStyle: StyleDesc = { ...(fonts.sans ? { fontFamily: fonts.sans } : {}), ...style, ...custom }
      if (dashed) finalStyle.borderColor = "transparent"
      const forward = (name: string, event: EventPayload) => {
        const callbacks = attrs[name]
        for (const callback of Array.isArray(callbacks) ? callbacks : [callbacks]) if (typeof callback === "function") callback(event)
      }

      return (
        <ColorSurface
          {...attrs}
          testId={props.testId}
          onMouseEnter={(event: EventPayload) => { hovered.value = true; forward("onMouseEnter", event) }}
          onMouseLeave={(event: EventPayload) => { hovered.value = false; forward("onMouseLeave", event) }}
          motion={props.hoverable && props.type !== "dashed" && typeof custom?.top !== "string" ? { initial: false, animate: { top: (typeof custom?.top === "number" ? custom.top : 0) + (hovered.value ? -2 : 0) }, transition: { duration: 0.3, ease: "ease" } } : undefined}
          style={finalStyle}
          transition={{ duration: 0.3, ease: "ease" }}
        >
          {{ default: () => [
            dashed ? <DashedBorderSurface color={String(dashedColor)} width={finalStyle.borderWidth} radius={finalStyle.borderRadius ?? radius.card} transition={{ duration: 0.3, ease: "ease" }} /> : null,
            props.pattern !== "none" ? <PatternSurface pattern={props.pattern === "default" ? "default" : `card-dots-${props.pattern.replace(/^app-/, "")}`} radius={radius.card} /> : null,
            slots.default?.()
          ] }}
        </ColorSurface>
      )
    }
  },
})

export type CardProps = Omit<InstanceType<typeof Card>["$props"], "style"> & { style?: StyleDesc }

export default Card
