/** Card — ported from animal-island-vue Card.vue (MIT), tracked in #164.
 * Preserves palette and two-layer dot textures through measured SVG patterns.
 * Dashed borders become solid. Hover keeps a shadow without translateY; colour
 * and shadow transitions are immediate. Decoration never receives pointer hits.
 */

import { defineComponent, type PropType } from "vue"
import type { StyleDesc } from "@gpuiv/vue"
import { cardPattern, cardSolid, colors, fonts, radius, shadows, spacing } from "../tokens.js"
import type { CardColor } from "../tokens.js"
import { PatternSurface } from "../patterns.js"

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
        style.hover = { boxShadow: shadows.base }
      }

      return (
        <div
          {...attrs}
          testId={props.testId}
          style={{ ...(fonts.sans ? { fontFamily: fonts.sans } : {}), ...style, ...(attrs.style as StyleDesc | undefined) }}
        >
          {props.pattern !== "none" ? <PatternSurface pattern={props.pattern === "default" ? "default" : `dots-${props.pattern.replace(/^app-/, "")}`} radius={radius.card} /> : null}
          {slots.default?.()}
        </div>
      )
    }
  },
})

export default Card
