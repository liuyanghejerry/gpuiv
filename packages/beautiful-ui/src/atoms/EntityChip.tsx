import { defineComponent, h } from "vue"
import type { StyleDesc } from "@gpuiv/vue"

export const EntityChip = defineComponent({
  name: "EntityChip",
  props: { name: { type: String, default: "" } },
  setup(props) {
    return () => h("span", { style: { display: "inline-flex", alignItems: "center", borderRadius: 6, paddingLeft: 6, paddingRight: 6, paddingTop: 1, paddingBottom: 1, backgroundColor: "var(--inset)", color: "var(--ink-2)", fontSize: 12, fontFamily: "var(--font-mono)" } }, [props.name])
  },
})
