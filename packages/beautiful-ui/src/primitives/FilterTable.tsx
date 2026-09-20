/** FILTER TABLE — status chips directly filter the task table.
 *
 *  Ported from beautiful-ui `components/primitives/FilterTable.tsx`.
 *
 *  Platform degradations vs the web original:
 *
 *  - The original puts both the chip row and the table in `overflow-x-auto`
 *    containers with a hidden scrollbar. GPUIV forbids nested scroll areas,
 *    so the grid's `1.3fr / 0.6fr / 0.95fr / 0.9fr` columns are fixed pixel
 *    widths matching the fractions at the original's 420px max width (the
 *    task column keeps flexing), and overflowing content ellipsizes
 *    (`whiteSpace: "nowrap"` + `textOverflow: "ellipsis"`) instead of
 *    scrolling.
 *  - Row expand/collapse: the original transitions `grid-template-rows`
 *    between `0fr` and `1fr`. Here each row is wrapped in a `motion.div`
 *    animating a fixed `height` (0 ↔ 36px) + `opacity`, with the same 0.3s
 *    `cubic-bezier(0.23, 1, 0.32, 1)` ease. Rows mount already at their
 *    target height (no entrance animation), matching CSS transitions, and
 *    retarget mid-animation when the filter changes again.
 *  - Status pills: the `.filter-status-*` classes derive from a per-status
 *    `--tag-base` via `color-mix()` (light: text = base 92% + ink, bg =
 *    base 20% + surface, border = base 34% + surface; dark: text = base
 *    86% + white, bg/border = base 34% + surface). Reproduced with `mix()`
 *    and the component-specific tag bases from globals.css; mixing happens
 *    in oklch instead of srgb, which is perceptually identical at these
 *    chromas.
 *  - Chip selected state is component state + a style swap (the original's
 *    `transition-[background-color,box-shadow,color] duration-200`), and
 *    row hover is the native `hover:` style (the original's
 *    `transition-colors duration-100`) — both swap instantly; GPUIV has no
 *    transitions outside `motion`.
 *  - `tabular-nums` on the date/count columns is not supported; numbers use
 *    the default figure set.
 *  - The chip counts are derived from `rows`; the original hardcodes counts
 *    that only match its demo data.
 *  - ARIA plumbing (`role="region"`, `aria-pressed`, `tabIndex`, `<button>`)
 *    is dropped — there is no DOM accessibility tree in GPUIV.
 */

import { computed, defineComponent, ref, type PropType } from "vue"
import { motion } from "@gpuiv/vue"
import { mix } from "../colors.js"
import { ease, radius } from "../tokens.js"
import { useTheme } from "../theme.js"

export type FilterTableStatus = "todo" | "progress" | "done"

export interface FilterTableRow {
  task: string
  date: string
  status: FilterTableStatus
  owner: string
}

export interface FilterTableLabels {
  columns: { task: string; date: string; status: string; owner: string }
}

const DEFAULT_ROWS: FilterTableRow[] = [
  { task: "Restock mango sorbet", date: "Dec 03", status: "todo", owner: "Mango Moon Gelato" },
  { task: "Churn black sesame", date: "Sep 22", status: "progress", owner: "Kumo Creamery" },
  { task: "Print summer menu", date: "Jan 02", status: "todo", owner: "Coral Coast Sorbet" },
  { task: "Taste-test batch 42", date: "Nov 08", status: "progress", owner: "Maple Orbit" },
  { task: "Order waffle cones", date: "Apr 14", status: "done", owner: "Aurora Scoops" },
]

const DEFAULT_LABELS: FilterTableLabels = {
  columns: { task: "Task name", date: "Date", status: "Status", owner: "Advisor" },
}

const STATUS_LABEL: Record<FilterTableStatus, string> = {
  todo: "To do",
  progress: "In Progress",
  done: "Completed",
}

/** `--tag-base` from the FilterTable block of globals.css (component-specific
 *  there, so kept as local constants here, not theme tokens). */
const STATUS_BASE: Record<FilterTableStatus, string> = {
  todo: "oklch(0.757 0.153 66.401)",
  progress: "oklch(0.671 0.118 219.351)",
  done: "oklch(0.652 0.131 162.865)",
}

const FILTERS: { key: "all" | FilterTableStatus; label: string; dot?: string }[] = [
  { key: "all", label: "All" },
  { key: "todo", label: STATUS_LABEL.todo, dot: "#f09a2f" },
  { key: "progress", label: STATUS_LABEL.progress, dot: "#16a6c7" },
  { key: "done", label: STATUS_LABEL.done, dot: "#25a878" },
]

/** Fixed row height — the original's rows measure ~36px, which makes the
 *  0fr ↔ 1fr grid collapse portable as a `height` animation. */
const ROW_HEIGHT = 36

/** Column widths matching the original grid fractions at its 420px max width
 *  (0.6 / 0.95 / 0.9 of 3.75); the task column flexes to fill the rest. */
const DATE_COL = 67
const STATUS_COL = 106
const OWNER_COL = 101

export const FilterTable = defineComponent({
  name: "BuiFilterTable",
  props: {
    rows: { type: Array as PropType<FilterTableRow[]>, default: () => DEFAULT_ROWS },
    labels: { type: Object as PropType<Partial<FilterTableLabels>>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    const filter = ref<"all" | FilterTableStatus>("all")
    const copy = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }))
    const counts = computed<Record<"all" | FilterTableStatus, number>>(() => {
      const c = { all: props.rows.length, todo: 0, progress: 0, done: 0 }
      for (const row of props.rows) c[row.status] += 1
      return c
    })

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const dark = theme.isDark.value

      const pill = (status: FilterTableStatus) => {
        const base = STATUS_BASE[status]
        return dark
          ? {
              color: mix(base, "#ffffff", 14),
              backgroundColor: mix(base, t.surface, 66),
              borderColor: mix(base, t.surface, 66),
            }
          : {
              color: mix(base, t.ink, 8),
              backgroundColor: mix(base, t.surface, 80),
              borderColor: mix(base, t.surface, 66),
            }
      }

      const headerCell = (label: string, width: number | "grow", last = false) => (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            ...(width === "grow" ? { flexGrow: 1, minWidth: 0 } : { width, flexShrink: 0 }),
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 8,
            paddingBottom: 8,
            fontSize: 12.5,
            fontWeight: 500,
            color: t.ink2,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            ...(last ? {} : { borderRightWidth: 1, borderColor: t.gridLine }),
          }}
        >
          {label}
        </div>
      )

      const textCell = (text: string, width: number | "grow", opts: { last?: boolean; weight?: number; color: string }) => (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            ...(width === "grow" ? { flexGrow: 1, minWidth: 0 } : { width, flexShrink: 0 }),
            paddingLeft: 12,
            paddingRight: 12,
            ...(opts.last ? {} : { borderRightWidth: 1, borderColor: t.gridLine }),
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: opts.weight ?? 400,
              color: opts.color,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {text}
          </div>
        </div>
      )

      return (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: 420 }}>
          {/* filter chips */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
            {FILTERS.map((f) => {
              const active = filter.value === f.key
              return (
                <div
                  key={f.key}
                  onClick={() => {
                    filter.value = f.key
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexShrink: 0,
                    height: 26,
                    borderRadius: radius.pill,
                    paddingLeft: 10,
                    paddingRight: 10,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    ...(active
                      ? { backgroundColor: t.surface, color: t.ink, ...shadows.btn }
                      : { color: t.ink2, hover: { backgroundColor: t.hover } }),
                  }}
                >
                  {f.dot ? (
                    <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: f.dot, flexShrink: 0 }} />
                  ) : null}
                  {f.label}
                  <div
                    style={{
                      borderRadius: 4,
                      paddingLeft: 4,
                      paddingRight: 4,
                      fontSize: 10.5,
                      fontWeight: 500,
                      ...(active ? { backgroundColor: t.field, color: t.ink2 } : { color: t.ink3 }),
                    }}
                  >
                    {counts.value[f.key]}
                  </div>
                </div>
              )
            })}
          </div>

          {/* table */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              borderRadius: radius.card,
              backgroundColor: t.surface,
              ...shadows.card,
            }}
          >
            {/* header */}
            <div style={{ display: "flex", borderBottomWidth: 1, borderColor: t.gridLine }}>
              {headerCell(copy.value.columns.task, "grow")}
              {headerCell(copy.value.columns.date, DATE_COL)}
              {headerCell(copy.value.columns.status, STATUS_COL)}
              {headerCell(copy.value.columns.owner, OWNER_COL, true)}
            </div>

            {props.rows.map((row) => {
              const shown = filter.value === "all" || row.status === filter.value
              const p = pill(row.status)
              return (
                <motion.div
                  key={row.task}
                  animate={{ height: shown ? ROW_HEIGHT : 0, opacity: shown ? 1 : 0 }}
                  transition={{ duration: 0.3, ease: ease.outStrong }}
                  style={{ overflow: "hidden" }}
                >
                  <div
                    style={{
                      display: "flex",
                      height: ROW_HEIGHT,
                      borderBottomWidth: 1,
                      borderColor: t.gridLine,
                      hover: { backgroundColor: t.hover },
                    }}
                  >
                    {textCell(row.task, "grow", { weight: 500, color: t.ink })}
                    {textCell(row.date, DATE_COL, { color: t.ink2 })}
                    {/* status pill */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        width: STATUS_COL,
                        flexShrink: 0,
                        paddingLeft: 12,
                        paddingRight: 12,
                        borderRightWidth: 1,
                        borderColor: t.gridLine,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          flexShrink: 0,
                          height: 23,
                          borderRadius: radius.control,
                          paddingLeft: 7,
                          paddingRight: 7,
                          borderWidth: 1,
                          borderColor: p.borderColor,
                          backgroundColor: p.backgroundColor,
                          fontSize: 13,
                          fontWeight: 500,
                          color: p.color,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {STATUS_LABEL[row.status]}
                      </div>
                    </div>
                    {textCell(row.owner, OWNER_COL, { last: true, color: t.ink2 })}
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      )
    }
  },
})
