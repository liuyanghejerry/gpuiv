import { defineComponent, h } from "vue"
import { Collapsible, CollapsiblePanel, CollapsibleTrigger, createApp } from "@gpuiv/vue"

export const CollapsibleExample = defineComponent({
  setup() {
    return () => h("div", { style: { width: "100%", height: "100%", padding: 24, gap: 16,
      display: "flex", flexDirection: "column", backgroundColor: "#111827", color: "#e5e7eb" } }, [
      h("text", { style: { fontSize: 24, fontWeight: 700 } }, "Connection settings"),
      h("text", "Click a heading or use Enter / Space. The server field keeps its value."),
      h(Collapsible, { defaultOpen: true }, { default: () => [
        h(CollapsibleTrigger, { testId: "connection", "aria-label": "Connection",
          style: (state: { open: boolean }) => ({ padding: 14, backgroundColor: state.open ? "#1e3a5f" : "#1f2937", cursor: "pointer" }),
        }, { default: (state: { open: boolean }) => h("text", `${state.open ? "−" : "+"} Connection`) }),
        h(CollapsiblePanel, { keepMounted: true, testId: "connection-panel" }, { default: () => h("div", { style: { padding: 16, gap: 12 } }, [
          h("text", "Server address"), h("input", { testId: "server", placeholder: "https://api.example.com", style: { height: 40 } }),
        ]) }),
      ] }),
      h(Collapsible, {}, { default: () => [
        h(CollapsibleTrigger, { testId: "advanced", style: { padding: 14, backgroundColor: "#1f2937", cursor: "pointer" } }, { default: () => "Advanced" }),
        h(CollapsiblePanel, {}, { default: () => h("div", { style: { padding: 16 } }, h("text", "Retry failed requests up to three times.")) }),
      ] }),
    ])
  },
})

if (import.meta.main) createApp(CollapsibleExample, { width: 620, height: 420, focus: process.env.GPUIX_BACKGROUND !== "1" })
