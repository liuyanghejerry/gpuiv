/** Monospace token chip. */
import { defineComponent, h, type PropType } from "vue"
import type { StyleDesc } from "@gpuiv/vue"

type Tone = "neutral" | "accent" | "orange"
const tones: Record<Tone, Record<string, unknown>> = {
  neutral: { backgroundColor: "var(--inset)", color: "var(--ink-2)" },
  accent: { backgroundColor: "var(--accentTint)", color: "var(--accentInk)" },
  orange: { backgroundColor: "var(--orangeTint)", color: "var(--orange)" },
}

export const Chip = defineComponent({
  name: "Chip",
  props: { tone: { type: String as PropType<Tone>, default: "neutral" }, children: { type: [String, Array] as PropType<string | unknown[]>, default: "" } },
  setup(props, { attrs, slots }) {
    return () => h("code", { ...attrs, style: { display: "inline", borderRadius: 6, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1, ...tones[props.tone] } }, [slots.default?.()])
  },
})
