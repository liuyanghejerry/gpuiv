/* ─────────────────────────────────────────────────────────
 * RECOMMENDATION CARD
 * ───────────────────────────────────────────────────────── */
import { defineComponent, h, ref, computed, type PropType } from "vue"
import { Button } from "../atoms/Button.js"
import { EntityChip } from "../atoms/EntityChip.js"
import { ValuePill } from "../atoms/ValuePill.js"

export type RecommendationOption = { key: string; body: (string | { t: string; tone: string })[]; short: string; signal: number; tone: string; label: string; cta: string; ctaVariant: "primary" | "secondary" | "ghost" | "accent" | "success" | "quiet" }
export type RecommendationLabels = { title: string; alternatives: string; otherOptions: string; accepted: string }
const DEFAULT_LABELS: RecommendationLabels = { title: "Want me to place this restock order?", alternatives: "Alternatives", otherOptions: "Other options", accepted: "Accepted" }
const OPTIONS: RecommendationOption[] = [
  { key: "high", body: ["Reorder waffle cones from ", "Cone King", " with lead time ", { t: "7 days", tone: "green" as const }], short: "Reorder from Cone King · 7-day lead", signal: 3, tone: "var(--green)", label: "High confidence", cta: "Accept", ctaVariant: "accent" },
  { key: "review", body: ["Switch vanilla to ", { t: "Vanilla Madagascar", tone: "neutral" as const }, " for peak season."], short: "Switch to Vanilla Madagascar", signal: 2, tone: "var(--orange)", label: "Needs review", cta: "Configure", ctaVariant: "primary" },
  { key: "none", body: ["Fall back to a ", { t: "full restock", tone: "neutral" as const }, " across every SKU."], short: "Full restock across every SKU", signal: 0, tone: "var(--ink-3)", label: "No signal", cta: "Accept full restock", ctaVariant: "primary" },
]

function Meter({ signal, tone }: { signal: number; tone: string }) {
  return h("span", { style: { display: "inline-flex", alignItems: "flex-end", gap: 2 } }, [0, 1, 2].map((bar) => h("span", { key: bar, style: { width: 4, borderRadius: "50%", height: 10, backgroundColor: bar < signal ? tone : "var(--line-strong)", transition: "background-color 300ms" } })))
}

export default defineComponent({
  name: "RecommendationCard",
  props: { options: { type: Array as PropType<RecommendationOption[]>, default: OPTIONS }, labels: { type: Object as PropType<Partial<RecommendationLabels>>, default: undefined } },
  setup(props) {
    const t = { ...DEFAULT_LABELS, ...(props.labels ?? {}) }
    const selected = ref(0)
    const open = ref(false)
    const accepted = ref(false)
    const active = computed(() => props.options[selected.value])
    const others = computed(() => props.options.map((o, i) => ({ o, i })).filter(({ i }) => i !== selected.value))
    return () =>
      h("div", { style: { width: "100%", maxWidth: 355, overflow: "hidden", borderRadius: 10, backgroundColor: "var(--surface)", boxShadow: "0 0 0 1px var(--line), 0 1px 2px rgba(0,0,0,0.05)" } }, [
        h("div", { style: { paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10 } }, [
          h("span", { style: { fontSize: 14, fontWeight: 500, color: "var(--ink)" } }, [t.title]),
          h("p", { style: { marginTop: 6, minHeight: 48, fontSize: 13, lineHeight: 1.6, color: "var(--ink-2)" } }, [active.value.body as unknown as ReturnType<typeof h>[]]),
        ]),
        h("div", { style: { gridTemplateRows: open.value ? 1 : 0, opacity: open.value ? 1 : 0, overflow: "hidden" } }, [
          h("div", { style: { overflow: "hidden" } }, [
            h("div", { style: { borderTop: "1px solid var(--line)", backgroundColor: "var(--surface)", paddingLeft: 8, paddingRight: 8, paddingTop: 8, paddingBottom: 8 } }, [
              h("p", { style: { paddingLeft: 6, paddingBottom: 8, fontSize: 11, fontWeight: 500, color: "var(--ink-2)" } }, [t.otherOptions]),
              ...others.value.map(({ o, i }) =>
                h("button", { key: o.key, type: "button", onClick: () => { selected.value = i; open.value = false; accepted.value = false }, style: { display: "flex", width: "100%", alignItems: "center", gap: 10, borderRadius: 8, paddingLeft: 6, paddingTop: 6, paddingBottom: 6, textAlign: "left" } }, [
                  h(Meter, { signal: o.signal, tone: o.tone }),
                  h("span", { style: { minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: "var(--ink)" } }, [o.short]),
                  h("span", { style: { flexShrink: 0, fontSize: 11, color: "var(--ink-2)" } }, [o.label]),
                ])
              ),
            ]),
          ]),
        ]),
        h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, backgroundColor: "var(--surface)", paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, borderTop: "1px solid var(--line)" } }, [
          h("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 } }, [h(Meter, { signal: active.value.signal, tone: active.value.tone }), h("span", { style: { fontSize: 12.5, fontWeight: 500, color: "var(--ink-2)" } }, [active.value.label])]),
          h("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 } }, [
            h(Button, { variant: "secondary", size: "sm", "aria-expanded": open.value, onClick: () => { open.value = !open.value }, style: { paddingLeft: 10, paddingRight: 10, fontSize: 12.5 } }, [t.alternatives]),
            h(Button, { variant: accepted.value ? "success" : active.value.ctaVariant, size: "sm", onClick: () => { accepted.value = true }, style: { paddingLeft: 10, paddingRight: 10, fontSize: 12.5 } }, [accepted.value ? t.accepted : active.value.cta]),
          ]),
        ]),
      ])
  },
})
