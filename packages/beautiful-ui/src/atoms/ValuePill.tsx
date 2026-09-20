import { defineComponent, h, type PropType } from "vue"
import type { StyleDesc } from "@gpuiv/vue"

type ValuePillTone = "green" | "orange" | "neutral"
const tones: Record<ValuePillTone, Record<string, unknown>> = {
  green: { backgroundColor: "var(--greenTint)", color: "var(--green)" },
  orange: { backgroundColor: "var(--orangeTint)", color: "var(--orange)" },
  neutral: { backgroundColor: "var(--inset)", color: "var(--ink-2)" },
}

export const ValuePill = defineComponent({
  name: "ValuePill",
  props: { tone: { type: String as PropType<ValuePillTone>, default: "neutral" }, children: { type: [String, Array] as PropType<string | unknown[]>, default: "" } },
  setup(props, { attrs, slots }) {
    return () => h("span", { ...attrs, style: { display: "inline-flex", alignItems: "center", borderRadius: 8, paddingLeft: 7, paddingRight: 7, height: 23, fontSize: 13, fontWeight: 500, lineHeight: 1, ...tones[props.tone] } }, [slots.default?.()])
  },
})
