/* ─────────────────────────────────────────────────────────
 * SEARCH — command search with live filtering.
 * ───────────────────────────────────────────────────────── */
import { defineComponent, h, ref, type PropType } from "vue"
import { Menu } from "../menu.js"

export type SearchItem = string
export type SearchListLabels = { placeholder: string; ariaLabel: string; emptyTitle: string; emptyHint: string }
const DEFAULT_ITEMS: SearchItem[] = ["Forecast summer demand", "Find waffle cone suppliers", "Compare seasonal flavors", "Draft flavor launch plan", "Check cold-chain status", "Audit sugar costs", "Retire low sellers"]
const DEFAULT_LABELS: SearchListLabels = { placeholder: "Search flavors…", ariaLabel: "Search flavors", emptyTitle: "No results found", emptyHint: "Adjust your search to try again" }

export default defineComponent({
  name: "SearchList",
  props: { items: { type: Array as PropType<SearchItem[]>, default: DEFAULT_ITEMS }, labels: { type: Object as PropType<Partial<SearchListLabels>>, default: undefined } },
  setup(props) {
    const query = ref("")
    const copy = { ...DEFAULT_LABELS, ...(props.labels ?? {}) }
    const results = query.value ? props.items.filter((i) => i.toLowerCase().includes(query.value.toLowerCase())) : props.items.slice(0, 5)
    const empty = query.value.length > 2 && results.length === 0
    return () =>
      h("div", { style: { display: "flex", minHeight: 248, width: "100%", maxWidth: 280, flexDirection: "column", alignItems: "stretch" } }, [
        h("div", { style: { borderRadius: 10, backgroundColor: "var(--surface)", boxShadow: "0 0 0 1px var(--line), 0 2px 6px rgba(0,0,0,0.08)", overflow: "hidden" } }, [
          h("div", { style: { display: "flex", height: 40, alignItems: "center", gap: 8, borderBottom: "1px solid var(--line)", paddingLeft: 12 } }, [
            h("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "var(--ink-3)", strokeWidth: 2, strokeLinecap: "round", style: { flexShrink: 0 } }, [h("circle", { cx: 11, cy: 11, r: 7 }), h("path", { d: "M21 21l-4.3-4.3" })]),
            h("input", { value: query.value, onInput: (e: Event) => { query.value = (e.target as HTMLInputElement).value }, placeholder: copy.placeholder, "aria-label": copy.ariaLabel, style: { minWidth: 0, flex: 1, backgroundColor: "transparent", fontSize: 13, color: "var(--ink)", outline: "none" } }),
            query.value ? h("button", { "aria-label": "Clear search", onClick: () => { query.value = "" }, style: { display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", width: 24, height: 24, color: "var(--ink-3)" } }, [h("svg", { width: 11, height: 11, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" }, [h("path", { d: "M18 6L6 18M6 6l12 12" })])]) : null,
          ]),
          empty ? h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, paddingLeft: 16, paddingRight: 16, paddingTop: 32, paddingBottom: 32 } }, [
            h("span", { style: { display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, width: 32, height: 32, backgroundColor: "var(--inset)", color: "var(--ink-2)", boxShadow: "0 0 0 1px var(--line)" } }, [h("svg", { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" }, [h("circle", { cx: 11, cy: 11, r: 7 }), h("path", { d: "M21 21l-4.3-4.3" })])]),
            h("span", { style: { fontSize: 13, fontWeight: 500, color: "var(--ink)" } }, [copy.emptyTitle]),
            h("span", { style: { fontSize: 12, color: "var(--ink-2)" } }, [copy.emptyHint]),
          ]) : h("div", { style: { padding: 4 } }, [
            h(Menu, { items: results.map((item) => ({ id: item, label: item })), itemStyle: { height: 32, paddingLeft: 8, fontSize: 13, color: "var(--ink)", cursor: "pointer", borderRadius: 6 }, activeItemStyle: { backgroundColor: "var(--hover)", borderRadius: 6 } }),
          ]),
        ]),
      ])
  },
})
