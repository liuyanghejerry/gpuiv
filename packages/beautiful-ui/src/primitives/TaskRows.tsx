/** TASK ROWS — task list with a scripted status run and expandable details.
 *
 *  Ported from beautiful-ui `components/primitives/TaskRows.tsx`.
 *
 *  The TICKS script runs once (unchanged): rows enter staggered, the
 *  "index" row auto-expands at 1500ms and collapses at 3900ms as the
 *  "sequence" row flips pending → Failed (+ retry glyph) → Completed at
 *  5300ms. After the run, every row stays clickable to toggle its details.
 *
 *  Platform degradations vs the web original:
 *
 *  - The spinner ring's `spin` rotation (an SVG arc orbiting the track) has
 *    no rotate in GPUIV. The ring track is a bordered div and the active
 *    state stacks the static `ringArc` glyph (the same 28% dash sweep) in
 *    `ink3` on top — it reads as "in flight" but does not orbit.
 *  - The badge `pop-in` (opacity + scale 0.95 → 1, 300ms) becomes an
 *    opacity-only `motion.div` fade (no scale in GPUIV), same duration and
 *    `ease.outStrong` curve.
 *  - The status pill `fade-in` (200ms, CSS `ease-out`) becomes a
 *    `motion.div` opacity fade with the same values. The `retry` glyph in
 *    the failed pill no longer spins (no rotate).
 *  - The chevron's `rotate(180deg)` transition becomes an instant
 *    chevronDown ↔ chevronUp glyph swap.
 *  - Row entrances (`fade-up`: opacity + translateY 8px, 450ms, 80ms
 *    stagger) and detail-line entrances (300ms, 120 + j·100ms delays)
 *    become `motion.div` opacity + `top` tweens on the same curves. Detail
 *    lines re-run their entrance through a keyed remount on every open,
 *    like the original re-adding its CSS animation.
 *  - The `grid-template-rows: 0fr ↔ 1fr` drawer becomes `AnimateHeight`
 *    (measured auto-height tween, same 300ms `ease.outStrong`); the drawer's
 *    opacity fade rides on a child `motion.div` at the same duration, since
 *    `AnimateHeight` owns its element's motion prop.
 *  - `transition-[border-radius,background-color] duration-300`: the card
 *    borderRadius (22 ↔ 14) is a real `motion.div` tween; the hover
 *    background swaps instantly via the native `hover:` style (no colour
 *    transitions outside motion).
 *  - `tabular-nums` on amounts/metas/step numerals is dropped (no
 *    font-feature-settings); the meta column uses the mono family.
 *  - The `<button>` becomes a div with `role="button"` + `aria-expanded`
 *    passthrough — there is no DOM accessibility tree in GPUIV.
 *  - `onToggleRow` stays a callback prop (the codebase's `onSend`/`onCopy`
 *    convention) instead of a Vue emit.
 */

import { computed, defineComponent, onBeforeUnmount, onMounted, ref, type PropType } from "vue"
import { AnimateHeight, motion } from "@gpuiv/vue"
import { ease, fonts, radius } from "../tokens.js"
import { useTheme } from "../theme.js"
import { Icon } from "../atoms/Icon.js"

/** One detail line shown when a task row is expanded. */
export interface TaskDetail {
  label: string
  meta: string
}

/** A single task row.
 *  - "done"     → green check badge + completed pill (static)
 *  - "running"  → active spinner showing `step`, no pill (static)
 *  - "sequence" → script-driven: pending spinner → failed → completed
 */
export interface TaskRow {
  key: string
  label: string
  amount: string
  status: "done" | "running" | "sequence"
  step?: number
  details: TaskDetail[]
}

export interface TaskRowsLabels {
  completed: string
  failed: string
}

const DEFAULT_LABELS: TaskRowsLabels = {
  completed: "Completed",
  failed: "Failed",
}

/* Milliseconds per stage — the original's script, unchanged:
 *   0ms    rows enter staggered (80ms apart)
 *   1500ms the "index" row auto-expands
 *   3900ms it collapses; the "sequence" row flips to Failed + retry
 *   5300ms the "sequence" row resolves to Completed            */
const TICKS = [600, 900, 2400, 1400, 2400, 600]

const TASK_ROWS: TaskRow[] = [
  {
    key: "verify",
    label: "Verified vendor records",
    amount: "12 suppliers",
    status: "done",
    details: [
      { label: "Matched tax and contact IDs", meta: "12/12" },
      { label: "Flagged stale records", meta: "0" },
    ],
  },
  {
    key: "index",
    label: "Build reorder task list",
    amount: "7 SKUs",
    status: "running",
    step: 2,
    details: [
      { label: "Reading POS export", meta: "3 files" },
      { label: "Scoring stockout risk", meta: "68%" },
    ],
  },
  {
    key: "draft",
    label: "Draft supplier emails",
    amount: "2 messages",
    status: "sequence",
    step: 3,
    details: [
      { label: "Cone supplier follow-up", meta: "draft" },
      { label: "Pistachio reorder note", meta: "draft" },
    ],
  },
]

/** CSS `ease-out` — the status pill's fade-in curve. */
const EASE_OUT = [0, 0, 0.58, 1] as [number, number, number, number]

export const TaskRows = defineComponent({
  name: "BuiTaskRows",
  props: {
    /** "Capsules" (default, separated cards) or "List" (one bordered card). */
    variant: { type: String, default: "Capsules" },
    rows: { type: Array as PropType<TaskRow[]>, default: () => TASK_ROWS },
    labels: { type: Object as PropType<Partial<TaskRowsLabels>>, default: undefined },
    onToggleRow: { type: Function as PropType<(key: string, open: boolean) => void>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()

    /* The TICKS script — the original's useTick. One timeout is in flight
     * at a time; advancing past the last stage leaves none pending. */
    const tick = ref(0)
    let tickTimer: ReturnType<typeof setTimeout> | undefined
    const advance = () => {
      if (tick.value >= TICKS.length - 1) return
      tickTimer = setTimeout(() => {
        tick.value += 1
        advance()
      }, TICKS[tick.value])
    }
    onMounted(advance)
    onBeforeUnmount(() => {
      if (tickTimer !== undefined) clearTimeout(tickTimer)
    })

    /** null per row = follow the script; the first click pins it manually. */
    const manualOpen = ref<Record<string, boolean>>({})

    const copy = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }))
    /** The "sequence" row's scripted phase. */
    const sequencePhase = computed<"pending" | "failed" | "done">(() =>
      tick.value < 3 ? "pending" : tick.value === 3 ? "failed" : "done",
    )

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const list = props.variant === "List"
      const phase = sequencePhase.value

      /** Track ring + (static) sweep arc + step numeral — the original's
       *  SpinnerRing, minus the orbit. */
      const spinnerRing = (step: number | undefined, active: boolean) => (
        <div style={{ position: "relative", width: 24, height: 24, flexShrink: 0 }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 24,
              height: 24,
              borderRadius: 12,
              borderWidth: 2,
              borderColor: t.line,
            }}
          />
          {active && (
            <div style={{ position: "absolute", top: 0, left: 0, width: 24, height: 24 }}>
              <Icon name="ringArc" size={24} color={t.ink3} />
            </div>
          )}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10.5,
              fontWeight: 600,
              color: t.ink,
            }}
          >
            {step}
          </div>
        </div>
      )

      /** Filled status badge — pop-in degraded to an opacity fade. */
      const badge = (tone: "red" | "green") => (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: ease.outStrong }}
          style={{
            display: "flex",
            width: 22,
            height: 22,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 11,
            backgroundColor: tone === "red" ? t.red : t.green,
          }}
        >
          <Icon name={tone === "red" ? "xBold" : "checkBold"} size={tone === "red" ? 12 : 13} color="#ffffff" />
        </motion.div>
      )

      const badgeFor = (row: TaskRow) => {
        if (row.status === "done") return badge("green")
        if (row.status === "running") return spinnerRing(row.step, true)
        return phase === "pending" ? spinnerRing(row.step, false) : phase === "failed" ? badge("red") : badge("green")
      }

      /** Status pill. `fade` marks the scripted appearances (the original's
       *  fade-in); the static done-row pill mounts unfaded, as there. */
      const pill = (tone: "red" | "green", fade: boolean, withRetry: boolean) => {
        const color = tone === "red" ? t.red : t.green
        const body = (
          <>
            {tone === "red" ? copy.value.failed : copy.value.completed}
            {withRetry && <Icon name="retry" size={12} color={color} />}
          </>
        )
        const style = {
          display: "flex",
          alignItems: "center",
          gap: withRetry ? 6 : 0,
          height: 22,
          flexShrink: 0,
          borderRadius: radius.pill,
          backgroundColor: tone === "red" ? t.redTint : t.greenTint,
          paddingLeft: 8,
          paddingRight: 8,
          fontSize: 11.5,
          fontWeight: 500,
          color,
        } as const
        return fade ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: EASE_OUT }} style={style}>
            {body}
          </motion.div>
        ) : (
          <div style={style}>{body}</div>
        )
      }

      const pillFor = (row: TaskRow) => {
        if (row.status === "done") return pill("green", false, false)
        if (row.status === "running") return null
        return phase === "failed" ? pill("red", true, true) : phase === "done" ? pill("green", true, false) : null
      }

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            maxWidth: 440,
            ...(list
              ? {
                  gap: 0,
                  alignSelf: "flex-start",
                  overflow: "hidden",
                  borderRadius: radius.card,
                  backgroundColor: t.surface,
                  ...shadows.card,
                }
              : { gap: 8, minHeight: 196 }),
          }}
        >
          {props.rows.map((row, i) => {
            const open = manualOpen.value[row.key] ?? (row.key === "index" && tick.value === 2)
            const isLast = i === props.rows.length - 1
            return (
              <motion.div
                key={row.key}
                initial={{ opacity: 0, top: 8 }}
                animate={{ opacity: 1, top: 0 }}
                transition={{ duration: 0.45, delay: i * 0.08, ease: ease.outStrong }}
                style={{ position: "relative", alignSelf: "stretch" }}
              >
                <motion.div
                  animate={{ borderRadius: list ? 0 : open ? 14 : 22 }}
                  transition={{ duration: 0.3, ease: ease.outStrong }}
                  style={{
                    overflow: "hidden",
                    ...(list
                      ? { ...(isLast ? {} : { borderBottomWidth: 1, borderColor: t.line }) }
                      : { backgroundColor: t.surface, ...shadows.card }),
                    hover: { backgroundColor: t.inset },
                  }}
                >
                  {/* row header */}
                  <div
                    role="button"
                    aria-expanded={open}
                    onClick={() => {
                      manualOpen.value = { ...manualOpen.value, [row.key]: !open }
                      props.onToggleRow?.(row.key, !open)
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      width: "100%",
                      height: 44,
                      gap: 10,
                      paddingLeft: 10,
                      paddingRight: 10,
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        width: 24,
                        height: 24,
                        flexShrink: 0,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {badgeFor(row)}
                    </div>
                    <div
                      style={{
                        minWidth: 0,
                        flexGrow: 1,
                        fontSize: 13,
                        fontWeight: 500,
                        color: t.ink,
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {row.label}
                    </div>
                    <div style={{ flexShrink: 0, fontSize: 12.5, color: t.ink2 }}>{row.amount}</div>
                    {pillFor(row)}
                    <div
                      aria-hidden="true"
                      style={{
                        display: "flex",
                        width: 28,
                        height: 28,
                        flexShrink: 0,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 14,
                        marginLeft: -8,
                      }}
                    >
                      <Icon name={open ? "chevronUp" : "chevronDown"} size={15} color={t.ink3} />
                    </div>
                  </div>

                  {/* dropdown detail — same expandable grammar as ThinkingState */}
                  <AnimateHeight height={open ? "auto" : 0} duration={0.3} ease={ease.outStrong}>
                    <motion.div
                      initial={false}
                      animate={{ opacity: open ? 1 : 0 }}
                      transition={{ duration: 0.3, ease: ease.outStrong }}
                    >
                      <div style={{ display: "flex", gap: 10, paddingLeft: 10, paddingRight: 10, marginBottom: 10 }}>
                        <div aria-hidden="true" style={{ width: 24, flexShrink: 0, alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <div style={{ width: 1, flexGrow: 1, backgroundColor: t.line }} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1, minWidth: 0 }}>
                          {row.details.map((d, j) => (
                            <motion.div
                              key={`${d.label}-${open ? "open" : "closed"}`}
                              initial={open ? { opacity: 0, top: 4 } : false}
                              animate={{ opacity: 1, top: 0 }}
                              transition={{ duration: 0.3, delay: 0.12 + j * 0.1, ease: ease.outStrong }}
                              style={{
                                position: "relative",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                              }}
                            >
                              <div style={{ fontSize: 12, color: t.ink2 }}>{d.label}</div>
                              <div style={{ fontFamily: fonts.mono, fontSize: 11.5, color: t.ink3 }}>{d.meta}</div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  </AnimateHeight>
                </motion.div>
              </motion.div>
            )
          })}
        </div>
      )
    }
  },
})
