/* ─────────────────────────────────────────────────────────
 * FILTER TABLE — status chips filter the task table.
 * ───────────────────────────────────────────────────────── */
import { defineComponent, h, ref, type PropType } from "vue"
import { Menu } from "../menu.js"

type Status = "todo" | "progress" | "done"
export type TableRow = { task: string; date: string; status: Status; owner: string }
export type FilterTableLabels = { columns: { task: string; date: string; status: string; owner: string } }
const FILTERS = [
  { key: "all" as const, label: "All", count: 5 },
  { key: "todo" as const, label: "To do", dot: "#f09a2f", count: 2 },
  { key: "progress" as const, label: "In Progress", dot: "#16a6c7", count: 2 },
  { key: "done" as const, label: "Completed", dot: "#25a878", count: 1 },
]
const ROWS: TableRow[] = [
  { task: "Restock mango sorbet", date: "Dec 03", status: "todo", owner: "Mango Moon Gelato" },
  { task: "Churn black sesame", date: "Sep 22", status: "progress", owner: "Kumo Creamery" },
  { task: "Print summer menu", date: "Jan 02", status: "todo", owner: "Coral Coast Sorbet" },
  { task: "Taste-test batch 42", date: "Nov 08", status: "progress", owner: "Maple Orbit" },
  { task: "Order waffle cones", date: "Apr 14", status: "done", owner: "Aurora Scoops" },
]
const DEFAULT_LABELS: FilterTableLabels = { columns: { task: "Task name", date: "Date", status: "Status", owner: "Advisor" } }
const PILLS: Record<Status, Record<string, unknown>> = { todo: { backgroundColor: "var(--inset)", color: "var(--ink-2)" }, progress: { backgroundColor: "var(--inset)", color: "var(--ink-2)" }, done: { backgroundColor: "var(--greenTint)", color: "var(--green)" } }

export default defineComponent({
  name: "FilterTable",
  props: { rows: { type: Array as PropType<TableRow[]>, default: ROWS }, labels: { type: Object as PropType<Partial<FilterTableLabels>>, default: undefined } },
  setup(props) {
    const filter = ref<"all" | Status>("all")
    const copy = { ...DEFAULT_LABELS, ...(props.labels ?? {}) }
    return () =>
      h("div", { style: { width: "100%", maxWidth: 390 } }, [
        h("div", { style: { display: "flex", marginLeft: -4, marginBottom: 4, alignItems: "center", gap: 4, overflowX: "auto", paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4, scrollbarWidth: "none" } }, [
          ...FILTERS.map((f) => {
            const active = filter.value === f.key
            return h("button", { key: f.key, type: "button", "aria-pressed": active, onClick: () => { filter.value = f.key }, style: { display: "inline-flex", height: 26, alignItems: "center", gap: 6, borderRadius: 999, paddingLeft: 10, paddingRight: 10, fontSize: 12, fontWeight: 500, ...(active ? { backgroundColor: "var(--surface)", color: "var(--ink)", boxShadow: "0 0 0 1px var(--line-strong)" } : { color: "var(--ink-2)" }) } }, [
              f.dot ? h("span", { style: { width: 6, height: 6, borderRadius: "50%", backgroundColor: f.dot } }) : null,
              f.label,
              h("span", { style: { borderRadius: 4, paddingLeft: 4, paddingRight: 4, fontSize: 10.5, fontVariantNumeric: "tabular-nums", ...(active ? { backgroundColor: "var(--field)", color: "var(--ink-2)" } : { color: "var(--ink-2)" }) } }, [String(f.count)]),
            ])
          }),
        ]),
        h("div", { role: "region", tabIndex: 0, "aria-label": "Scrollable task table", style: { overflowX: "auto", borderRadius: 10, backgroundColor: "var(--surface)", boxShadow: "0 0 0 1px var(--line), 0 1px 2px rgba(0,0,0,0.05)", scrollbarWidth: "none" } }, [
          h("div", { style: { minWidth: 420 } }, [
            h("div", { style: { display: "grid", gridTemplateColumns: "1.3fr 0.6fr 0.95fr 0.9fr", borderBottom: "1px solid var(--grid-line)", fontSize: 12.5, fontWeight: 500, color: "var(--ink-2)" } }, [
              h("span", { style: { borderRight: "1px solid var(--grid-line)", paddingLeft: 12, paddingTop: 8, paddingBottom: 8 } }, [copy.columns.task]),
              h("span", { style: { borderRight: "1px solid var(--grid-line)", paddingLeft: 12, paddingTop: 8, paddingBottom: 8 } }, [copy.columns.date]),
              h("span", { style: { borderRight: "1px solid var(--grid-line)", paddingLeft: 12, paddingTop: 8, paddingBottom: 8 } }, [copy.columns.status]),
              h("span", { style: { paddingLeft: 12, paddingTop: 8, paddingBottom: 8 } }, [copy.columns.owner]),
            ]),
            ...ROWS.map((row) => {
              const shown = filter.value === "all" || row.status === filter.value
              return h("div", { key: row.task, style: { display: "grid", gridTemplateRows: shown ? 1 : 0, opacity: shown ? 1 : 0, overflow: "hidden" } }, [
                h("div", { style: { overflow: "hidden" } }, [
                  h("div", { style: { display: "grid", gridTemplateColumns: "1.3fr 0.6fr 0.95fr 0.9fr", borderBottom: "1px solid var(--grid-line)", fontSize: 13 } }, [
                    h("span", { style: { display: "inline-flex", alignItems: "center", minWidth: 0, borderRight: "1px solid var(--grid-line)", paddingLeft: 12, paddingTop: 8, paddingBottom: 8 } }, [h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500, color: "var(--ink)" } }, [row.task])]),
                    h("span", { style: { display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", borderRight: "1px solid var(--grid-line)", paddingLeft: 12, paddingTop: 8, paddingBottom: 8, color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" } }, [row.date]),
                    h("span", { style: { display: "inline-flex", alignItems: "center", borderRight: "1px solid var(--grid-line)", paddingLeft: 12, paddingTop: 8, paddingBottom: 8 } }, [
                      h("span", { style: { display: "inline-flex", alignItems: "center", height: 23, borderRadius: 8, border: "1px solid var(--line)", paddingLeft: 7, paddingRight: 7, fontSize: 13, fontWeight: 500, ...PILLS[row.status] } }, [row.status === "todo" ? "To do" : row.status === "progress" ? "In Progress" : "Completed"]),
                    ]),
                    h("span", { style: { display: "inline-flex", alignItems: "center", minWidth: 0, paddingLeft: 12, paddingTop: 8, paddingBottom: 8, color: "var(--ink-2)" } }, [h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, [row.owner])]),
                  ]),
                ]),
              ])
            }),
          ]),
        ]),
      ])
  },
})
