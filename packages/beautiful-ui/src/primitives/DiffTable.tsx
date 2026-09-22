/** DIFF TABLE — a proposed edit plays once, then each changed row is the
 *  control: click it to include or exclude that addition/removal before
 *  applying.
 *
 *  Ported from beautiful-ui `components/primitives/DiffTable.tsx`.
 *
 *  The STAGE_DELAYS script runs once (unchanged): 180ms in, the removals take
 *  their red tint; 260ms later the table settles — the added row opens, the
 *  footer fades up, and every changed row becomes a toggle. Apply locks the
 *  selection and swaps the footer for the "edits applied" chip.
 *
 *  Platform degradations vs the web original:
 *
 *  - The `<table>`/`<colgroup>` (34% / 30% / 36%) becomes flex rows whose
 *    cells carry `flexGrow: 34/30/36` with `flexBasis: 0` — the same
 *    proportions as the original's `table-fixed` columns at any width.
 *  - `textDecoration: line-through` is not in GPUIV's style surface. The
 *    removed supplier's strike is an absolutely-positioned 1px line across
 *    the (possibly truncated) email, coloured `withAlpha(red, 0.5)` — the
 *    same value as the source's `color-mix(in srgb, var(--red) 50%,
 *    transparent)`.
 *  - Every `transition-[background-color,color,opacity]` (row tint, name and
 *    email colours, chip dim, included mark) swaps instantly — GPUIV has no
 *    colour transitions outside `motion`.
 *  - The included mark's `scale(0.92 ↔ 1)` is dropped (no transform in
 *    GPUIV); the fill/check swap is instant. The 3px-stroke check reuses the
 *    `checkBold` icon (3.5px), same as the TaskRows badges.
 *  - `hover:brightness-[0.985]` has no filter support; the row hover is the
 *    native `hover:` style with the base colour mixed 1.5% toward black.
 *  - The added row's `grid-template-rows: 0fr ↔ 1fr` + opacity transition
 *    becomes `AnimateHeight` (measured auto-height tween) with the opacity
 *    fade on a child `motion.div` — same 200ms `ease.outStrong` on both.
 *  - The footer's `fade-up` (opacity + translateY 8px, 180ms) becomes a
 *    `motion.div` opacity + `top` tween with the same values; the applied
 *    chip's `pop-in` (opacity + scale 0.95, 180ms) becomes an opacity-only
 *    fade (no scale).
 *  - `tabular-nums` on the name cell and the footer summary is dropped (no
 *    font-feature-settings).
 *  - Keyboard activation (`tabIndex` + Enter/Space) and the `focus-visible`
 *    ring are dropped — no DOM accessibility tree in GPUIV. `role`/`aria-*`
 *    attributes stay as inert passthrough.
 *  - The original's `variant` prop is dropped: the source component accepts
 *    but never reads it.
 *  - The added row's chip dot is hardcoded `bg-green` in the source (the
 *    `DOT` map's `Seasonal → orange` applies only to data rows); preserved
 *    via a dot-colour override on the chip helper.
 *  - JSX trap: a lone `{cond && <Icon/>}` child compiles to
 *    `children: false`, which Vue's `createVNode` stringifies into a painted
 *    "false" text run (only array children get boolean → comment
 *    normalization). The mark's check uses `{cond ? <Icon/> : null}`.
 *  - Border collapse: the original relies on `border-collapse` between the
 *    last data row and the added row. Here data rows carry the bottom border
 *    except the last, and the added row carries the top border, so both the
 *    collapsed and expanded states read as a single hairline.
 */

import { computed, defineComponent, onBeforeUnmount, onMounted, ref, type PropType } from "vue"
import { AnimateHeight, motion, type StyleDesc } from "@gpuiv/vue"
import { mix, withAlpha } from "../colors.js"
import { ease, radius } from "../tokens.js"
import { useTheme } from "../theme.js"
import { Button } from "../atoms/Button.js"
import { Icon } from "../atoms/Icon.js"

/** One existing table row; `removed` rows are the proposed deletions. */
export interface DiffTableRow {
  key: string
  id: string
  dept: string
  email: string
  removed: boolean
}

/** The proposed addition, revealed when the table settles. */
export interface DiffAddedRow {
  key: string
  id: string
  dept: string
  email: string
}

export interface DiffTableLabels {
  title: string
  hint: string
  columns: { flavor: string; category: string; supplier: string }
  /** Footer summary, e.g. "2 removals · 1 addition". */
  summary: (removals: number, additions: number) => string
  /** Apply-button label, e.g. "Apply 3 changes". */
  apply: (changes: number) => string
  /** Applied chip label, e.g. "3 edits applied". */
  applied: (edits: number) => string
}

const ROWS: DiffTableRow[] = [
  { key: "rocky", id: "Rocky Road", dept: "Classic", email: "aurora-scoops", removed: true },
  { key: "bubblegum", id: "Bubblegum", dept: "Retro", email: "kumo-creamery", removed: true },
  { key: "mint", id: "Mint Chip", dept: "Classic", email: "maple-orbit", removed: false },
]

const ADDED_ROW: DiffAddedRow = { key: "pistachio", id: "Pistachio", dept: "Seasonal", email: "maple-orbit" }

const DEFAULT_LABELS: DiffTableLabels = {
  title: "Proposed menu cleanup",
  hint: "Click changed rows to toggle",
  columns: { flavor: "Flavor", category: "Category", supplier: "Supplier" },
  summary: (removals, additions) =>
    `${removals} ${removals === 1 ? "removal" : "removals"} · ${additions} ${additions === 1 ? "addition" : "additions"}`,
  apply: (changes) => `Apply ${changes} ${changes === 1 ? "change" : "changes"}`,
  applied: (edits) => `${edits} ${edits === 1 ? "edit" : "edits"} applied`,
}

/* The original's script, unchanged: 0 plain · 1 removals tinted · 2 settled. */
const STAGE_DELAYS = [180, 260]

/* The original's colgroup percentages (34% / 30% / 36%), as flex-grow ratios. */
const RATIOS = [34, 30, 36] as const

export const DiffTable = defineComponent({
  name: "BuiDiffTable",
  props: {
    rows: { type: Array as PropType<DiffTableRow[]>, default: () => ROWS },
    addedRow: { type: Object as PropType<DiffAddedRow>, default: () => ADDED_ROW },
    labels: { type: Object as PropType<Partial<DiffTableLabels>>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()

    /* The stage script — the original's useStage. One timeout is in flight
     * at a time; advancing past the last stage leaves none pending. */
    const stage = ref(0)
    let stageTimer: ReturnType<typeof setTimeout> | undefined
    const advance = () => {
      if (stage.value >= STAGE_DELAYS.length) return
      stageTimer = setTimeout(() => {
        stage.value += 1
        advance()
      }, STAGE_DELAYS[stage.value])
    }
    onMounted(advance)
    onBeforeUnmount(() => {
      if (stageTimer !== undefined) clearTimeout(stageTimer)
    })

    /** Inclusion per edit, keyed like the original's `edits` state — every
     *  proposed change starts included. Initialised once, as there. */
    const initialEdits: Record<string, boolean> = {}
    for (const row of props.rows) if (row.removed) initialEdits[row.key] = true
    initialEdits[props.addedRow.key] = true
    const edits = ref<Record<string, boolean>>(initialEdits)
    const accepted = ref(false)

    const toggleEdit = (key: string) => {
      edits.value = { ...edits.value, [key]: !edits.value[key] }
    }

    const copy = computed<DiffTableLabels>(() => ({
      ...DEFAULT_LABELS,
      ...props.labels,
      columns: { ...DEFAULT_LABELS.columns, ...props.labels?.columns },
    }))
    const removals = computed(() => props.rows.filter((row) => row.removed && edits.value[row.key]).length)
    const additions = computed(() => (edits.value[props.addedRow.key] ? 1 : 0))

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const tinted = stage.value >= 1
      const settled = stage.value >= 2

      /** The original's `DOT` map (unknown departments fall to ink3). */
      const dotColor = (dept: string) => (dept === "Classic" ? t.accent : dept === "Seasonal" ? t.orange : t.ink3)

      /** One table cell at the colgroup proportion. */
      const cell = (index: 0 | 1 | 2): StyleDesc => ({
        display: "flex",
        alignItems: "center",
        flexGrow: RATIOS[index],
        flexBasis: 0,
        minWidth: 0,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 10,
        paddingBottom: 10,
      })

      const truncText = (text: string, style: StyleDesc) => (
        <div style={{ minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis", ...style }}>{text}</div>
      )

      const deptChip = (dept: string, chipBg: string, faded: boolean, dot?: string) => (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 22,
            flexShrink: 0,
            borderRadius: radius.pill,
            backgroundColor: chipBg,
            paddingLeft: 8,
            paddingRight: 8,
            opacity: faded ? 0.55 : 1,
            ...shadows.hairline,
          }}
        >
          <div style={{ width: 6, height: 6, flexShrink: 0, borderRadius: 3, backgroundColor: dot ?? dotColor(dept) }} />
          <div style={{ fontSize: 11.5, fontWeight: 500, color: t.ink2 }}>{dept}</div>
        </div>
      )

      /** The original's IncludedMark — scale transition dropped. */
      const includedMark = (included: boolean, tone: "red" | "green") => (
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            width: 18,
            height: 18,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 5,
            ...(included
              ? { backgroundColor: tone === "red" ? t.red : t.green }
              : { backgroundColor: t.inset, ...shadows.hairline }),
          }}
        >
          {included ? <Icon name="checkBold" size={11} color="#ffffff" /> : null}
        </div>
      )

      /** Supplier cell: email (struck through when the removal is included)
       *  plus the include/exclude mark. */
      const supplierCell = (opts: { email: string; out: boolean; color: string; included: boolean; tone: "red" | "green"; showMark: boolean; fontSize: number }) => (
        <div style={{ ...cell(2), justifyContent: "space-between", gap: 8 }}>
          <div style={{ position: "relative", minWidth: 0 }}>
            {truncText(opts.email, { fontSize: opts.fontSize, lineHeight: 18, color: opts.color })}
            {opts.out && (
              <div
                aria-hidden="true"
                style={{ position: "absolute", left: 0, right: 0, top: 9, height: 1, backgroundColor: withAlpha(t.red, 0.5) }}
              />
            )}
          </div>
          {opts.showMark && includedMark(opts.included, opts.tone)}
        </div>
      )

      const addedIncluded = !!edits.value[props.addedRow.key]

      return (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: 380 }}>
          <div
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              borderRadius: radius.card,
              backgroundColor: t.surface,
              ...shadows.card,
            }}
          >
            {/* card bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingTop: 10,
                paddingBottom: 10,
                paddingLeft: 12,
                paddingRight: 12,
                borderBottomWidth: 1,
                borderColor: t.line,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 500, color: t.ink }}>{copy.value.title}</div>
              {settled && !accepted.value && <div style={{ fontSize: 11, color: t.ink3 }}>{copy.value.hint}</div>}
            </div>

            {/* header */}
            <div style={{ display: "flex", borderBottomWidth: 1, borderColor: t.line }}>
              {([copy.value.columns.flavor, copy.value.columns.category, copy.value.columns.supplier] as const).map((h, i) => (
                <div key={h} style={{ ...cell(i as 0 | 1 | 2), fontSize: 12, fontWeight: 500, color: t.ink3, whiteSpace: "nowrap" }}>
                  {h}
                </div>
              ))}
            </div>

            {/* data rows */}
            {props.rows.map((row, i) => {
              const included = !!edits.value[row.key]
              const out = row.removed && tinted && included
              const interactive = row.removed && settled && !accepted.value
              const baseBg = out ? t.redTint : t.surface
              return (
                <div
                  key={row.key}
                  role={row.removed ? "checkbox" : undefined}
                  aria-selected={row.removed ? included : undefined}
                  onClick={interactive ? () => toggleEdit(row.key) : undefined}
                  style={{
                    display: "flex",
                    ...(i === props.rows.length - 1 ? {} : { borderBottomWidth: 1, borderColor: t.line }),
                    backgroundColor: out ? t.redTint : undefined,
                    cursor: interactive ? "pointer" : undefined,
                    ...(interactive ? { hover: { backgroundColor: mix(baseBg, "#000000", 1.5) } } : {}),
                  }}
                >
                  <div style={{ ...cell(0), fontSize: 13, fontWeight: 500 }}>
                    {truncText(row.id, { color: out ? t.red : t.ink, lineHeight: 18 })}
                  </div>
                  <div style={cell(1)}>{deptChip(row.dept, t.inset, out)}</div>
                  {supplierCell({ email: row.email, out, color: out ? t.red : t.ink2, included, tone: "red", showMark: row.removed && settled, fontSize: 12.5 })}
                </div>
              )
            })}

            {/* added row — the original's 0fr ↔ 1fr grid collapse */}
            <AnimateHeight height={settled ? "auto" : 0} duration={0.2} ease={ease.outStrong}>
              <motion.div initial={false} animate={{ opacity: settled ? 1 : 0 }} transition={{ duration: 0.2, ease: ease.outStrong }}>
                <div
                  role="checkbox"
                  aria-checked={addedIncluded}
                  aria-label={`Include adding ${props.addedRow.id}`}
                  onClick={accepted.value ? undefined : () => toggleEdit(props.addedRow.key)}
                  style={{
                    display: "flex",
                    borderTopWidth: 1,
                    borderColor: t.line,
                    backgroundColor: addedIncluded ? t.greenTint : undefined,
                    cursor: accepted.value ? undefined : "pointer",
                    ...(accepted.value
                      ? {}
                      : { hover: { backgroundColor: mix(addedIncluded ? t.greenTint : t.surface, "#000000", 1.5) } }),
                  }}
                >
                  <div style={{ ...cell(0), fontSize: 13, fontWeight: 500 }}>
                    {truncText(props.addedRow.id, { color: addedIncluded ? t.green : t.ink3, lineHeight: 18 })}
                  </div>
                  <div style={cell(1)}>{deptChip(props.addedRow.dept, t.surface, false, t.green)}</div>
                  {supplierCell({ email: props.addedRow.email, out: false, color: addedIncluded ? t.green : t.ink3, included: addedIncluded, tone: "green", showMark: true, fontSize: 13 })}
                </div>
              </motion.div>
            </AnimateHeight>

            {/* footer — the summary follows the row-level selection */}
            {settled && (
              <motion.div
                initial={{ opacity: 0, top: 8 }}
                animate={{ opacity: 1, top: 0 }}
                transition={{ duration: 0.18, ease: ease.outStrong }}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  minHeight: 44,
                  padding: 10,
                  borderTopWidth: 1,
                  borderColor: t.line,
                }}
              >
                {accepted.value ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.18, ease: ease.outStrong }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      borderRadius: radius.pill,
                      backgroundColor: t.greenTint,
                      paddingTop: 4,
                      paddingBottom: 4,
                      paddingLeft: 4,
                      paddingRight: 10,
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: t.green,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        width: 18,
                        height: 18,
                        flexShrink: 0,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 9,
                        backgroundColor: t.green,
                      }}
                    >
                      <Icon name="checkBold" size={11} color="#ffffff" />
                    </div>
                    {copy.value.applied(removals.value + additions.value)}
                  </motion.div>
                ) : (
                  <>
                    <div style={{ fontSize: 11.5, color: t.ink3 }}>{copy.value.summary(removals.value, additions.value)}</div>
                    <Button
                      variant="accent"
                      size="sm"
                      style={{ fontSize: 12 }}
                      disabled={removals.value + additions.value === 0}
                      onClick={() => {
                        accepted.value = true
                      }}
                    >
                      {copy.value.apply(removals.value + additions.value)}
                    </Button>
                  </>
                )}
              </motion.div>
            )}
          </div>
        </div>
      )
    }
  },
})
