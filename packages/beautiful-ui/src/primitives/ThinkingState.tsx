/** THINKING STATE — expandable agent trace, four variants.
 *
 *  Ported from beautiful-ui `components/primitives/ThinkingState.tsx`:
 *
 *    Steps      step list with spinner → muted checks
 *    Reasoning  prose reasoning that expands, then settles
 *    Search     web-search trace: query + sources read
 *    Coding     tool trace: files read, edits, commands
 *
 *  The trace runs once (the `STAGES` setTimeout script is verbatim), settles,
 *  and remains expandable; `settled` fires once when the script reaches the
 *  "done" stage so embedders can sequence follow-up content.
 *
 *  Platform degradations vs the web original:
 *
 *  - The `shimmer-text` gradient sweep (`background-clip: text`) cannot clip
 *    a gradient to glyphs in GPUIV, so the active label uses the `Shimmer`
 *    atom (opacity breathing) — same trade-off as LoadingState.
 *  - The spinning ring (`border-t-ink-2` + CSS `spin`) has no rotate here, so
 *    the in-flight step shows the `Spinner` atom (dots variant) instead.
 *  - The `grid-template-rows: 0fr ↔ 1fr` drawer becomes `AnimateHeight`
 *    (measured auto-height tween, same 400ms `ease.outStrong`); the drawer's
 *    opacity fade rides on a sibling `motion.div` at the same duration, since
 *    `AnimateHeight` owns its element's motion prop.
 *  - The connecting line measured `traceRef.offsetHeight` in a layout effect
 *    and transitioned `height`. Here `useElementBounds` polls the trace
 *    column's painted height (≤100ms late, and it keeps following growth
 *    without a dependency list) and a `motion.div` tweens the line's height
 *    with the same 500ms curve.
 *  - The header chevron's `rotate(180deg)` transition becomes an instant
 *    chevronDown ↔ chevronUp glyph swap (no transforms in GPUIV).
 *  - The `fade-up`/`fade-in` CSS keyframes become `motion.div` mount
 *    animations (`opacity` + `top` on `position: relative`, same durations
 *    and 120ms-per-row stagger). Rows mount when the script reveals them, so
 *    mount timing IS the original's animation timing; the query row mounts
 *    before the drawer opens, so it re-runs its entrance through a keyed
 *    remount on every expand, like the original re-adding the animation.
 *  - The root's `min-height` 400ms transition is dropped (motion tweens only
 *    width/height/top/…, not min-height); the constraint swaps instantly.
 *  - Search rows were `<a href target="_blank">` with an `animated-underline`
 *    class. GPUIV cannot open links or underline on hover, so they are plain
 *    rows with the hover wash; `href` stays on `ThinkingRow` for parity.
 *  - The original's `key={variant}` remounts all state when the variant
 *    prop changes. Vue does not remount on a prop change: switching
 *    `variant` mid-run swaps the content but the timeline keeps running.
 *  - `tabular-nums` on the add/del counts is dropped (no
 *    font-feature-settings); the mono family already reads tabular.
 *  - `transition-colors` hovers swap instantly (no CSS transitions).
 *  - `onSettled` is the `settled` emit, per Vue convention. The header glyph
 *    override is the `icon` slot instead of a React node prop.
 */

import { computed, defineComponent, onBeforeUnmount, onMounted, ref, watch, type PropType } from "vue"
import { AnimateHeight, motion, Spinner, useElementBounds, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { ease, fonts, radius } from "../tokens.js"
import { useTheme, type Theme } from "../theme.js"
import { Shimmer } from "../atoms/index.js"
import { Icon } from "../atoms/Icon.js"

export type ThinkingStateVariant = "Steps" | "Reasoning" | "Search" | "Coding"

export interface ThinkingRow {
  primary: string
  secondary?: string
  /** Secondary text in the mono family (tool calls). */
  mono?: boolean
  /** Diff counters on Coding rows; `del` renders only alongside `add`. */
  add?: number
  del?: number
  /** Kept for parity with the web original; GPUIV cannot open links. */
  href?: string
}

interface ThinkingVariantContent {
  active: string
  done: string
  rows: ThinkingRow[]
  query?: string
}

/** Milliseconds per stage — the original's script, unchanged. */
const STAGES = [800, 600, 1800, 2600, 1600]

/** The last `working` stage; at stage 3 the trace shows all rows. */
const DONE_STAGE = 3

const VARIANTS: Record<ThinkingStateVariant, ThinkingVariantContent> = {
  Steps: {
    active: "Thinking",
    done: "Thought for 4 seconds",
    rows: [
      { primary: "Reading flavor briefs" },
      { primary: "Scanning supplier lists" },
      { primary: "Comparing tasting notes", secondary: "6 flavors" },
      { primary: "Writing the scoop report" },
    ],
  },
  Reasoning: {
    active: "Thinking",
    done: "Thought for 4 seconds",
    rows: [
      { primary: "Summer demand spikes for stone-fruit flavors — peach and apricot lead." },
      { primary: "I should check cone inventory before promoting a waffle-bowl special." },
    ],
  },
  Search: {
    active: "Searching the web",
    done: "Searched the web",
    query: "best waffle cone supplier",
    rows: [
      { primary: "Joy Cone", secondary: "joycone.com", href: "https://joycone.com/fs_products/waffle-cones/" },
      { primary: "WebstaurantStore", secondary: "webstaurantstore.com", href: "https://www.webstaurantstore.com/ice-cream-shop-supplies.html" },
      { primary: "The Konery", secondary: "thekonery.com", href: "https://www.thekonery.com/" },
    ],
  },
  Coding: {
    active: "Running tools",
    done: "Ran 3 tools",
    rows: [
      { primary: "Read", secondary: "flavors.ts", mono: true },
      { primary: "Edit", secondary: "ChurnSchedule.tsx", mono: true, add: 74, del: 41 },
      { primary: "Run", secondary: "npm run freeze", mono: true },
    ],
  },
}

/** CSS `ease-out` — the fade-in curve (the fade-ups use `ease.outStrong`). */
const EASE_OUT = [0, 0, 0.58, 1] as [number, number, number, number]

/** Search source dots cycle accent → orange → green (`TONES` in the source). */
function searchTones(theme: Theme): string[] {
  const t = theme.tokens.value
  return [t.accent, t.orange, t.green]
}

export const ThinkingState = defineComponent({
  name: "BuiThinkingState",
  props: {
    /** Which trace to run. Default "Steps"; unknown values fall back to it. */
    variant: { type: String as PropType<ThinkingStateVariant>, default: "Steps" },
    /** Override the built-in trace rows (keeps the primitive reusable). */
    rows: { type: Array as PropType<ThinkingRow[]>, default: undefined },
    /** Override the in-progress header label. */
    active: { type: String, default: undefined },
    /** Override the settled header label. */
    done: { type: String, default: undefined },
  },
  emits: {
    /** Fired once, when the scripted trace reaches its settled stage. */
    settled: () => true,
  },
  setup(props, { emit, slots }) {
    const theme = useTheme()

    /* The STAGES script — useSequence from the original. One timeout is in
     * flight at a time; advancing past the last stage leaves none pending. */
    const stage = ref(0)
    let stageTimer: ReturnType<typeof setTimeout> | undefined
    const advance = () => {
      if (stage.value >= STAGES.length - 1) return
      stageTimer = setTimeout(() => {
        stage.value += 1
        advance()
      }, STAGES[stage.value])
    }
    onMounted(advance)
    onBeforeUnmount(() => {
      if (stageTimer !== undefined) clearTimeout(stageTimer)
    })

    /** null = follow the script; the first header click pins it manually. */
    const manualExpanded = ref<boolean | null>(null)
    const selectedTool = ref<string | null>(null)

    const base = computed(() => VARIANTS[props.variant] ?? VARIANTS.Steps)
    const content = computed<ThinkingVariantContent>(() => ({
      ...base.value,
      rows: props.rows ?? base.value.rows,
      active: props.active ?? base.value.active,
      done: props.done ?? base.value.done,
    }))
    const autoExpanded = computed(() => stage.value >= 1 && stage.value < 4)
    const expanded = computed(() => manualExpanded.value ?? autoExpanded.value)
    const working = computed(() => stage.value < DONE_STAGE)
    const visible = computed(() =>
      stage.value < 2 ? 0 : stage.value === 2 ? Math.min(2, content.value.rows.length) : content.value.rows.length,
    )

    /* Let embedders sequence content after the trace settles — once only. */
    let settledEmitted = false
    watch(working, (isWorking) => {
      if (isWorking || settledEmitted) return
      settledEmitted = true
      emit("settled")
    })

    /* The connecting line follows the trace column's painted height. The
     * 100ms poll replaces the original's offsetHeight re-measure on every
     * stage; growth between polls is caught one tick later. */
    const traceRef = ref<HostNode | null>(null)
    const { bounds: traceBounds } = useElementBounds(traceRef)

    return () => {
      const t = theme.tokens.value
      const v = content.value
      const isExpanded = expanded.value
      const isWorking = working.value
      const shown = visible.value
      const lineHeight = traceBounds.value ? Math.max(0, traceBounds.value.height - 2) : 0

      const rowShell = (interactive: boolean, selected = false): StyleDesc => ({
        display: "flex",
        alignItems: "center",
        minHeight: 28,
        width: "100%",
        gap: 8,
        borderRadius: 6,
        paddingLeft: 6,
        paddingRight: 6,
        paddingTop: 2,
        paddingBottom: 2,
        ...(interactive ? { cursor: "pointer" as const } : {}),
        ...(selected ? { backgroundColor: t.inset } : {}),
        ...(interactive && !selected ? { hover: { backgroundColor: t.hover } } : {}),
      })

      const rowContent = (row: ThinkingRow, i: number) => (
        <>
          {props.variant === "Search" && (
            <div
              style={{
                display: "flex",
                width: 14,
                height: 14,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 7,
                backgroundColor: searchTones(theme)[i % 3],
              }}
            >
              <Icon name="globe" size={9} color="#ffffff" />
            </div>
          )}
          {props.variant === "Steps" && (
            <div
              style={{
                display: "flex",
                width: 15,
                height: 14,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {i < shown - 1 || !isWorking ? (
                <Icon name="check" size={14} color={t.ink3} />
              ) : (
                <Spinner size={3} color={t.ink2} label="Working" />
              )}
            </div>
          )}
          <div
            style={{
              minWidth: 0,
              flexShrink: 1,
              fontSize: 12.5,
              ...(props.variant === "Reasoning"
                ? { color: t.ink2, lineHeight: 18 }
                : { fontWeight: 500, color: t.ink, whiteSpace: "nowrap" as const, textOverflow: "ellipsis" as const }),
            }}
          >
            {row.primary}
          </div>
          {row.secondary !== undefined && (
            <div
              style={{
                flexShrink: 0,
                fontSize: 11.5,
                color: t.ink3,
                ...(row.mono ? { fontFamily: fonts.mono } : {}),
              }}
            >
              {row.secondary}
            </div>
          )}
          {row.add !== undefined && (
            <div style={{ display: "flex", gap: 4, flexShrink: 0, fontFamily: fonts.mono, fontSize: 11 }}>
              <div style={{ color: t.green }}>+{row.add}</div>
              <div style={{ color: t.red }}>−{row.del}</div>
            </div>
          )}
        </>
      )

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            maxWidth: 380,
            ...(isWorking || isExpanded ? { minHeight: 176 } : {}),
          }}
        >
          {/* header — shared across variants */}
          <div
            role="button"
            aria-expanded={isExpanded}
            onClick={() => {
              manualExpanded.value = !(manualExpanded.value ?? autoExpanded.value)
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              alignSelf: "flex-start",
              marginLeft: -6,
              marginRight: -6,
              borderRadius: radius.control,
              paddingLeft: 6,
              paddingRight: 6,
              paddingTop: 4,
              paddingBottom: 4,
              cursor: "pointer",
              hover: { backgroundColor: t.hover2 },
            }}
          >
            {slots.icon ? (
              slots.icon()
            ) : (
              <Icon name="sparkle" size={16} color={isWorking ? t.ink2 : t.ink3} />
            )}
            {isWorking ? (
              <Shimmer>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", color: t.ink2 }}>{v.active}</div>
              </Shimmer>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.35, ease: EASE_OUT }}
              >
                <div role="status" style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", color: t.ink2 }}>
                  {v.done}
                </div>
              </motion.div>
            )}
            <Icon name={isExpanded ? "chevronUp" : "chevronDown"} size={14} color={t.ink3} />
          </div>

          {/* expandable trace */}
          <AnimateHeight height={isExpanded ? "auto" : 0} duration={0.4} ease={ease.outStrong}>
            <motion.div
              initial={false}
              animate={{ opacity: isExpanded ? 1 : 0 }}
              transition={{ duration: 0.4, ease: ease.outStrong }}
            >
              {/* No padding on the positioning context: the line's `left: 3`
               *  must resolve against the same edge the rows' paddingLeft
               *  starts from, so the indent lives one div deeper. */}
              <div style={{ position: "relative", marginTop: 4, marginLeft: 5 }}>
                <motion.div
                  animate={{ height: lineHeight }}
                  transition={{ duration: 0.5, ease: ease.outStrong }}
                  style={{
                    position: "absolute",
                    left: 3,
                    top: -8,
                    width: 1,
                    backgroundColor: t.line,
                    pointerEvents: "none",
                  }}
                />
                <div style={{ paddingLeft: 16 }}>
                  <div
                    ref={traceRef}
                    style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 4, paddingBottom: 4 }}
                  >
                    {v.query !== undefined && (
                      <motion.div
                        key={isExpanded ? "query-open" : "query-closed"}
                        initial={isExpanded ? { opacity: 0, top: 4 } : false}
                        animate={{ opacity: 1, top: 0 }}
                        transition={{ duration: 0.3, ease: ease.outStrong }}
                        style={{
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                          height: 24,
                          gap: 8,
                          paddingLeft: 6,
                          paddingRight: 6,
                        }}
                      >
                        <Icon name="search" size={14} color={t.ink3} />
                        <div style={{ fontSize: 12.5, color: t.ink2 }}>{v.query}</div>
                      </motion.div>
                    )}
                    {v.rows.slice(0, shown).map((row, i) => (
                      <motion.div
                        key={row.primary}
                        initial={{ opacity: 0, top: 5 }}
                        animate={{ opacity: 1, top: 0 }}
                        transition={{ duration: 0.32, delay: i * 0.12, ease: ease.outStrong }}
                        style={{ position: "relative" }}
                      >
                        {props.variant === "Coding" ? (
                          <div
                            role="button"
                            aria-pressed={selectedTool.value === row.primary}
                            onClick={() => {
                              selectedTool.value = selectedTool.value === row.primary ? null : row.primary
                            }}
                            style={rowShell(true, selectedTool.value === row.primary)}
                          >
                            {rowContent(row, i)}
                          </div>
                        ) : (
                          <div
                            style={rowShell(props.variant === "Search")}
                          >
                            {rowContent(row, i)}
                          </div>
                        )}
                      </motion.div>
                    ))}
                    {props.variant === "Search" && stage.value >= DONE_STAGE && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3, ease: EASE_OUT }}
                      >
                        <div style={{ fontSize: 12, color: t.ink3 }}>+7 more</div>
                      </motion.div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimateHeight>
        </div>
      )
    }
  },
})
