/* ─────────────────────────────────────────────────────────
 * CHAT — interactive panel with tabs, replies, and composer.
 * ───────────────────────────────────────────────────────── */
import { defineComponent, h, ref, onMounted, onBeforeUnmount, computed, type PropType } from "vue"
import type { StyleDesc } from "@gpuiv/vue"

export type Phase = "idle" | "sent" | "reply1" | "reply2" | "done"
export interface ChatMessage { label: string; sub: string; time: string; body: string }
const MESSAGES: ChatMessage[] = [
  { label: "Sales History", sub: "Flavor Data", time: "4s", body: "Pulled 3 summers of mint chip sales for comparison." },
  { label: "Comparison", sub: "Trend Detection", time: "2s", body: "Mint chip is up 12% with stronger weekend peaks." },
]
const DEFAULT_LABELS = { initialPrompt: "Compare mint chip to last summer", placeholder: "Prompt or tag a flavor with @" }

function Section({ label, sub, time, body, resolving }: { label: string; sub: string; time: string; body: string; resolving?: boolean }) {
  return h("div", { motion: { animate: { opacity: 1, top: 0 }, initial: { opacity: 0, top: 8 }, transition: { duration: 0.4, ease: "easeOut" } } as Record<string, unknown>, style: { display: "flex", width: "100%", flexDirection: "column", gap: 6, ...(resolving ? { opacity: 0.55, filter: "blur(0.5px)", transform: "scale(0.985)", transformOrigin: "top left" } as Record<string, unknown> : {}) } }, [
    h("div", { style: { display: "flex", alignItems: "center", gap: 4, fontSize: 12, lineHeight: 1.3 } }, [
      h("span", { style: { fontWeight: 500, color: "var(--ink)" } }, [label]),
      h("span", { style: { color: "var(--ink-2)" } }, [sub]),
      h("span", { style: { color: "var(--ink)" } }, ["for ", time]),
    ]),
    h("p", { style: { fontSize: 13, lineHeight: 1.5, color: "var(--ink)" } }, [body]),
  ])
}

export default defineComponent({
  name: "ChatComposer",
  props: { messages: { type: Array as PropType<ChatMessage[]>, default: MESSAGES }, suggestions: { type: Array as PropType<string[]>, default: ["Flavors", "Suppliers"] }, labels: { type: Object, default: undefined }, onSend: { type: Function as PropType<(text: string) => void>, default: undefined } },
  setup(props) {
    const l = { ...DEFAULT_LABELS, ...(props.labels ?? {}) }
    const phase = ref<Phase>("done")
    const draft = ref("")
    const submitted = ref(l.initialPrompt)
    const tab = ref(props.suggestions[0] ?? "")
    let timer: ReturnType<typeof setTimeout> | undefined
    onMounted(() => {
      const tick = () => {
        if (phase.value === "sent") timer = setTimeout(() => { phase.value = "reply1"; tick() }, 500)
        else if (phase.value === "reply1") timer = setTimeout(() => { phase.value = "reply2"; tick() }, 1400)
        else if (phase.value === "reply2") timer = setTimeout(() => { phase.value = "done"; tick() }, 1200)
      }
      tick()
    })
    onBeforeUnmount(() => clearTimeout(timer))
    const sent = computed(() => phase.value !== "idle")
    const canSend = computed(() => draft.value.trim().length > 0)
    const send = () => {
      if (!canSend.value) return
      const text = draft.value.trim()
      submitted.value = text
      props.onSend?.(text)
      draft.value = ""
      phase.value = "sent"
    }
    return () =>
      h("div", { style: { display: "flex", height: 288, width: "100%", maxWidth: 355, flexDirection: "column", flexShrink: 0, overflow: "hidden", borderRadius: 14, backgroundColor: "var(--surface)", boxShadow: "0 0 0 1px var(--line), 0 1px 2px rgba(0,0,0,0.05)" } }, [
        h("div", { style: { display: "flex", flexShrink: 0, alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line)", padding: 6 } }, [
          h("div", { style: { display: "flex", alignItems: "center" } }, [
            ...props.suggestions.map((item) =>
              h("button", { key: item, type: "button", "aria-pressed": tab.value === item, onClick: () => { tab.value = item }, style: { borderRadius: 6, paddingLeft: 8, paddingTop: 3, paddingBottom: 3, fontSize: 13, color: "var(--ink)", ...(tab.value === item ? { backgroundColor: "var(--field)" } : { opacity: 0.5 }) } }, [item])
            ),
          ]),
          h("div", { style: { display: "flex", alignItems: "center", gap: 4 } }, [
            ...[1, 2, 3].map((i) =>
              h("button", { key: i, type: "button", "aria-label": "Action", style: { display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, width: 24, height: 24, color: "var(--ink-2)" } }, [
                h("svg", { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, [
                  i === 1 ? h("path", { d: "M12 5v14M5 12h14" }) : i === 2 ? h("g", {}, [h("circle", { cx: 12, cy: 12, r: 9 }), h("path", { d: "M12 7v5l3 2" })]) : h("g", { fill: "currentColor", stroke: "none" }, [h("circle", { cx: 5, cy: 12, r: 1.8 }), h("circle", { cx: 12, cy: 12, r: 1.8 }), h("circle", { cx: 19, cy: 12, r: 1.8 })])
                ])
              ])
            ),
          ]),
        ]),
        h("div", { style: { display: "flex", minHeight: 0, flex: 1, flexDirection: "column", gap: 10, overflowY: "auto", paddingLeft: 12, paddingTop: 10, paddingBottom: 4 } }, [
          h("div", { style: { display: "flex", justifyContent: "flex-end", paddingLeft: 56 } }, [
            h("div", { motion: { animate: { opacity: sent.value ? 1 : 0, top: sent.value ? 0 : 10 }, initial: { opacity: 0, top: 10 }, transition: { duration: 0.3, ease: "easeOut" } } as Record<string, unknown>, style: { borderRadius: 12, backgroundColor: "var(--field)", paddingLeft: 12, paddingTop: 6, paddingBottom: 6, fontSize: 13, lineHeight: 1.4, color: "var(--ink)" } }, [submitted.value]),
          ]),
          props.messages[0] && (phase.value === "reply1" || phase.value === "reply2" || phase.value === "done") ? h(Section, { label: props.messages[0].label, sub: props.messages[0].sub, time: props.messages[0].time, body: props.messages[0].body }) : null,
          props.messages[1] && (phase.value === "reply2" || phase.value === "done") ? h(Section, { label: props.messages[1].label, sub: props.messages[1].sub, time: props.messages[1].time, body: props.messages[1].body, resolving: phase.value === "reply2" }) : null,
        ]),
        h("div", { style: { marginTop: "auto", flexShrink: 0, padding: 6 } }, [
          h("div", { style: { display: "flex", flexDirection: "column", gap: 8, borderRadius: 8, border: "1px solid var(--line)", backgroundColor: "var(--field)", padding: 10 } }, [
            h("input", { value: draft.value, onInput: (e: Event) => { draft.value = (e.target as HTMLInputElement).value }, onKeydown: (e: KeyboardEvent) => { if (e.key === "Enter") send() }, placeholder: l.placeholder, "aria-label": "Chat prompt", autoFocus: true, style: { minHeight: 18, backgroundColor: "transparent", fontSize: 13, lineHeight: 1.4, color: "var(--ink)", outline: "none" } }),
            h("div", { style: { display: "flex", alignItems: "center", justifyContent: "flex-end" } }, [
              h("button", { type: "button", "aria-label": "Send", disabled: !canSend.value, onClick: send, style: { display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, width: 28, height: 28, backgroundColor: canSend.value ? "var(--ink)" : "var(--line-strong)", color: canSend.value ? "var(--surface)" : "var(--ink-2)" } }, [
                h("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" }, [h("path", { d: "M12 19V5M5 12l7-7 7 7" })])
              ]),
            ]),
          ]),
        ]),
      ])
  },
})
