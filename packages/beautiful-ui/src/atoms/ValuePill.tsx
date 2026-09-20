/** Inline value badge — a plain value set off in prose.
 *  Ported from beautiful-ui `components/atoms/ValuePill.tsx`; the tonal ring
 *  (`color-mix(tone 28%, transparent)`) is computed with `withAlpha`. */

import { defineComponent, type PropType } from "vue"
import { withAlpha } from "../colors.js"
import { radius } from "../tokens.js"
import { useTheme } from "../theme.js"

export type ValuePillTone = "neutral" | "green" | "orange" | "red" | "accent"

export const ValuePill = defineComponent({
  name: "BuiValuePill",
  props: {
    tone: { type: String as PropType<ValuePillTone>, default: "neutral" },
  },
  setup(props, { slots }) {
    const theme = useTheme()
    return () => {
      const t = theme.tokens.value
      const tones: Record<ValuePillTone, { backgroundColor: string; color: string; ring: string }> = {
        neutral: { backgroundColor: t.field, color: t.ink2, ring: t.line },
        green: { backgroundColor: t.greenTint, color: t.green, ring: withAlpha(t.green, 0.28) },
        orange: { backgroundColor: t.orangeTint, color: t.orange, ring: withAlpha(t.orange, 0.28) },
        red: { backgroundColor: t.redTint, color: t.red, ring: withAlpha(t.red, 0.28) },
        accent: { backgroundColor: t.accentTint, color: t.accentInk, ring: withAlpha(t.accent, 0.28) },
      }
      const tone = tones[props.tone]
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderRadius: radius.pill,
            paddingLeft: 6,
            paddingRight: 6,
            fontSize: 12,
            fontWeight: 500,
            backgroundColor: tone.backgroundColor,
            color: tone.color,
            borderWidth: 1,
            borderColor: tone.ring,
          }}
        >
          {slots.default?.()}
        </div>
      )
    }
  },
})
