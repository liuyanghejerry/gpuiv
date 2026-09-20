/** Monospace token chip — for code values like `updated_at`.
 *  Ported from beautiful-ui `components/atoms/Chip.tsx`. */

import { defineComponent, type PropType } from "vue"
import { fonts, radius } from "../tokens.js"
import { useTheme } from "../theme.js"

export type ChipTone = "neutral" | "accent" | "orange"

export const Chip = defineComponent({
  name: "BuiChip",
  props: {
    tone: { type: String as PropType<ChipTone>, default: "neutral" },
  },
  setup(props, { slots }) {
    const theme = useTheme()
    return () => {
      const t = theme.tokens.value
      const tones: Record<ChipTone, { backgroundColor: string; color: string }> = {
        neutral: { backgroundColor: t.inset, color: t.ink2 },
        accent: { backgroundColor: t.accentTint, color: t.accentInk },
        orange: { backgroundColor: t.orangeTint, color: t.orange },
      }
      return (
        <div
          style={{
            display: "flex",
            borderRadius: radius.chip,
            paddingLeft: 6,
            paddingRight: 6,
            paddingTop: 2,
            paddingBottom: 2,
            fontFamily: fonts.mono,
            fontSize: 12,
            ...tones[props.tone],
          }}
        >
          {slots.default?.()}
        </div>
      )
    }
  },
})
