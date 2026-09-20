/* ─────────────────────────────────────────────────────────
 * CONTEXT CARDS — retrieved chunks enter once, then remain.
 * ───────────────────────────────────────────────────────── */
import { defineComponent, h, ref, onMounted, type PropType } from "vue"
import type { StyleDesc } from "@gpuiv/vue"

export interface ContextChunk { title: string; chars: string; body: string; source: string; badge: string; tone: string }
export interface ContextCardsLabels { header: string; count: string }
const DEFAULT_LABELS: ContextCardsLabels = { header: "All chunks", count: "32" }
const DEFAULT_CHUNKS: ContextChunk[] = [
  { title: "Vendor onboarding rule", chars: "290 characters", body: "Cold-chain certification must be verified before a new dairy can be added to the reorder workflow.", source: "Dairy Onboarding SOP.pdf", badge: "PDF", tone: "var(--red)" },
  { title: "Seasonal demand row", chars: "1,250 characters", body: "Q4 velocity table: pistachio +18%, vanilla +6%, rocky road -11%; retire flavors below 40 scoops weekly.", source: "Sales Velocity Export.csv", badge: "CSV", tone: "var(--green)" },
]

export default defineComponent({
  name: "ContextCards",
  props: { chunks: { type: Array as PropType<ContextChunk[]>, default: DEFAULT_CHUNKS }, labels: { type: Object as PropType<Partial<ContextCardsLabels>>, default: undefined } },
  setup(props) {
    const chipsShown = ref(false)
    const copy = { ...DEFAULT_LABELS, ...(props.labels ?? {}) }
    onMounted(() => { setTimeout(() => { chipsShown.value = true }, 700) })
    return () =>
      h("div", { style: { display: "flex", width: "100%", maxWidth: 355, flexDirection: "column", gap: 8 } }, [
        h("div", { style: { display: "flex", alignItems: "center", gap: 8, paddingLeft: 2 } }, [
          h("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--ink)" } }, [copy.header]),
          h("span", { style: { display: "inline-flex", alignItems: "center", borderRadius: 6, backgroundColor: "var(--inset)", paddingLeft: 6, paddingRight: 6, fontSize: 11.5, fontWeight: 500, color: "var(--ink-2)", boxShadow: "0 0 0 1px var(--line)", fontVariantNumeric: "tabular-nums" } }, [copy.count]),
        ]),
        ...props.chunks.map((chunk, i) =>
          h("div", { key: chunk.title, motion: { animate: { opacity: 1, top: 0 }, initial: { opacity: 0, top: 8 }, transition: { duration: 0.4, delay: i * 0.1, ease: "easeOut" } } as Record<string, unknown>, style: { overflow: "hidden", borderRadius: 10, backgroundColor: "var(--surface)", boxShadow: "0 0 0 1px var(--line), 0 1px 2px rgba(0,0,0,0.05)" } }, [
            h("div", { style: { display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--line)", paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6 } }, [
              h("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 13, fontWeight: 500, color: "var(--ink)" } }, [
                h("svg", { width: 11, height: 11, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", style: { flexShrink: 0 } }, [h("path", { d: "M4 6h16M4 12h16M4 18h10" })]),
                h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, [chunk.title]),
              ]),
              h("span", { style: { marginLeft: "auto", flexShrink: 0, fontSize: 12, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" } }, [chunk.chars]),
            ]),
            h("p", { style: { paddingLeft: 12, paddingTop: 8, paddingBottom: 4, fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-2)" } }, [chunk.body]),
            h("div", { style: { paddingLeft: 12, paddingBottom: 12 } }, [
              h("span", {
                style: {
                  display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, backgroundColor: "var(--inset)", paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6,
                  fontSize: 12, fontWeight: 500, color: "var(--ink-2)", boxShadow: "0 0 0 1px var(--line-strong)",
                  opacity: chipsShown.value ? 1 : 0, transform: chipsShown.value ? "scale(1)" : "scale(0.95)",
                  transition: "opacity 300ms cubic-bezier(0.23,1,0.32,1)", transitionDelay: `${i * 80}ms`,
                } as Record<string, unknown>,
              }, [
                h("span", { style: { display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: chunk.tone, fontSize: 7, fontWeight: 700, color: "#fff", width: 14, height: 14 } }, [chunk.badge]),
                chunk.source,
                h("svg", { width: 9, height: 9, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, [h("path", { d: "M7 17L17 7M7 7h10v10" })]),
              ]),
            ]),
          ])
        ),
      ])
  },
})
