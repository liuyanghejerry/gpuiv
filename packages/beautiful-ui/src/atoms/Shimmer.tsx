/** Shimmering label — signals the agent is processing. */
import { defineComponent, h, type PropType } from "vue"
import { useShimmer } from "../motion.js"

export const Shimmer = defineComponent({
  name: "Shimmer",
  props: { children: { type: [String, Array] as PropType<string | ReturnType<typeof h>[]>, default: "" }, size: { type: Number, default: 13 } },
  setup(props) {
    const progress = useShimmer(1800)
    return () => h("span", { style: { display: "inline-block", fontSize: props.size, fontWeight: 500, color: "var(--ink-3)", opacity: 0.5 + 0.5 * progress.value, background: "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)", backgroundSize: "200% 100%" } }, [props.children as ReturnType<typeof h>[]])
  },
})
