/** TOOL CHIPS — an agent run as compact rows: tool calls with inline chips,
 *  then file-diff chips summarizing the edits. Hover a row to reveal its
 *  chevron; every row expands to show what the tool actually did, and
 *  hovering a file chip previews its diff.
 *
 *  Ported from beautiful-ui `components/primitives/ToolChips.tsx`.
 *
 *  Platform degradations vs the web original:
 *
 *  - The 700ms step script is verbatim; rows mount as the script reveals
 *    them, so mount timing IS the original's animation timing. The `fade-up`
 *    keyframe (opacity + translateY(8px)) becomes a motion.div opacity + `top`
 *    tween on `position: relative`, same 300ms `cubic-bezier(0.23,1,0.32,1)`.
 *  - Both `grid-template-rows: 0fr ↔ 1fr` drawers (the whole run, and each
 *    row's detail) become AnimateHeight measured-height tweens, the opacity
 *    fade riding on a child motion.div at the same duration (the ThinkingState
 *    pattern — AnimateHeight owns its element's motion prop). The run wrapper
 *    keeps the original's CSS default `ease`; row details keep
 *    `cubic-bezier(0.23,1,0.32,1)`. Both are 300ms.
 *  - Chevron `rotate(-90deg)` transitions become instant chevronDown ↔
 *    chevronRight glyph swaps (no transforms in GPUIV) — on the header and
 *    on open rows.
 *  - The row icon's group-hover cross-fade (tool icon out, chevron in) is a
 *    JS-tracked row hover + an instant glyph swap: GPUIV's `hover:` style
 *    cannot retarget a child, and only motion tweens interpolate. Row hover
 *    is counted on the row AND its chip: the chip's fill makes its hitbox
 *    BlockMouseExceptScroll, which hides the row hitbox behind it from GPUI's
 *    hover hit test (there is no group-hover style), so over the chip the
 *    row's own mouseEnter/Leave and `hover:` wash never fire — the row's
 *    background then comes from the JS hover state instead (same hover2
 *    colour, one event round-trip late). The diff chip's preview handlers sit
 *    on the filled chip itself for the same reason.
 *  - `pop-in` (opacity + scale 0.95) drops the scale: diff chips and the
 *    preview fade in only, same durations and the 80ms-per-chip stagger.
 *  - The diff preview was a `createPortal` fixed overlay positioned from
 *    `getBoundingClientRect`, flipping above the chip when it would not fit
 *    below. Here it is an `<anchored side="bottom" fit="switch">` child of
 *    the chip's relative wrapper — GPUI positions it at the chip and flips
 *    the anchor corner on window overflow. The original's horizontal clamp
 *    (`min(rect.left, innerWidth − 300)`) is gone: at the demo width the
 *    288px card cannot overflow horizontally. The preview opens on hover
 *    only — the original's focus/blur path needed DOM tab stops.
 *  - The "+2 more" hover underline (`decoration-transparent` →
 *    `decoration-current`) is dropped: StyleDesc has no text-decoration.
 *    The ink-3 → ink-2 color hover stays.
 *  - `tabular-nums` on the header and the +/− counts is dropped (no
 *    font-feature-settings); the mono counts already read tabular.
 *  - All `transition-colors` hovers swap instantly (no transitions outside
 *    motion), and `className` is gone with the CSS.
 *  - ARIA is minimal (`role="button"` + `aria-expanded` where the original
 *    had them); there is no DOM accessibility tree. `onOpenChange` /
 *    `onToggleRow` keep the original's callback-prop shape.
 */

import { computed, defineComponent, onBeforeUnmount, onMounted, ref, type PropType } from "vue"
import { AnimateHeight, motion } from "@gpuiv/vue"
import { ease, fonts, radius } from "../tokens.js"
import { useTheme } from "../theme.js"
import { Icon } from "../atoms/Icon.js"
import type { IconName } from "../icons.js"

export interface ToolDetailLine {
  text: string
  tone?: "add"
}

export interface ToolStep {
  /** Key into the step glyph table (think / write / run / read); unknown
   *  names fall back to the `sparkle` glyph. */
  icon: string
  label: string
  chip: string
  mono: boolean
  detailMono: boolean
  detail: ToolDetailLine[]
}

export interface ToolDiff {
  file: string
  add: number
  del: number
}

export interface ToolDiffLine {
  text: string
  tone: "add" | "del" | "ctx"
}

export interface ToolChipsLabels {
  header: string
  more: string
}

const DEFAULT_LABELS: ToolChipsLabels = {
  header: "4 tool calls, 2 messages",
  more: "+2 more",
}

const DEFAULT_STEPS: ToolStep[] = [
  {
    icon: "think", label: "Thinking", chip: "Planning the churn schedule…", mono: false, detailMono: false,
    detail: [
      { text: "Weekend demand carries pistachio, so it churns first." },
      { text: "Batch capacity leaves two evening freezer windows." },
    ],
  },
  {
    icon: "write", label: "Write 204 lines", chip: "ChurnSchedule.tsx", mono: true, detailMono: true,
    detail: [
      { text: "+ const windows = slots.filter((s) => s.temp <= -12)", tone: "add" },
      { text: "+ return schedule(windows, { hero: \"pistachio\" })", tone: "add" },
    ],
  },
  {
    icon: "run", label: "Rebuild and verify", chip: "npm run freeze", mono: true, detailMono: true,
    detail: [
      { text: "✓ built in 1.2s" },
      { text: "✓ 34 checks passed" },
    ],
  },
  {
    icon: "read", label: "Read image", chip: "flavor-chart.png", mono: true, detailMono: false,
    detail: [
      { text: "1280 × 720 · line chart, three summers." },
      { text: "Mint chip trends up 12% through July." },
    ],
  },
]

const DEFAULT_DIFFS: ToolDiff[] = [
  { file: "flavors.css", add: 13, del: 0 },
  { file: "ChurnSchedule.tsx", add: 74, del: 41 },
  { file: "menu.ts", add: 8, del: 2 },
]

const DEFAULT_DIFF_LINES: Record<string, ToolDiffLine[]> = {
  "flavors.css": [
    { text: ".scoop-card {", tone: "ctx" },
    { text: "  gap: 14px;", tone: "del" },
    { text: "  gap: 12px;", tone: "add" },
    { text: "  container-type: inline-size;", tone: "add" },
    { text: "}", tone: "ctx" },
  ],
  "ChurnSchedule.tsx": [
    { text: "const slots = coldSlots(week);", tone: "ctx" },
    { text: "const windows = slots;", tone: "del" },
    { text: "const windows = slots.filter(", tone: "add" },
    { text: "  (s) => s.temp <= -12,", tone: "add" },
    { text: ");", tone: "add" },
  ],
  "menu.ts": [
    { text: "export const hero = \"mint-chip\";", tone: "del" },
    { text: "export const hero = \"pistachio\";", tone: "add" },
  ],
}

/** Milliseconds between row reveals — the original's `STEP_MS`, unchanged. */
const STEP_MS = 700


const STEP_ICONS: Record<string, IconName> = {
  think: "sparkle",
  write: "pencil",
  run: "terminal",
  read: "file",
}

export const ToolChips = defineComponent({
  name: "BuiToolChips",
  props: {
    /** Accepted for gallery/registry parity; ToolChips has no visual variants. */
    variant: { type: String, default: undefined },
    steps: { type: Array as PropType<ToolStep[]>, default: () => DEFAULT_STEPS },
    diffs: { type: Array as PropType<ToolDiff[]>, default: () => DEFAULT_DIFFS },
    diffLines: { type: Object as PropType<Record<string, ToolDiffLine[]>>, default: () => DEFAULT_DIFF_LINES },
    labels: { type: Object as PropType<Partial<ToolChipsLabels>>, default: undefined },
    onOpenChange: { type: Function as PropType<(open: boolean) => void>, default: undefined },
    onToggleRow: { type: Function as PropType<(label: string, open: boolean) => void>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    const copy = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }))

    const open = ref(true)
    const openRows = ref<Set<string>>(new Set())
    /** Row under the pointer — drives the icon ↔ chevron swap (no group-hover).
     *  A row's chip paints its own fill, which makes its hitbox
     *  BlockMouseExceptScroll: GPUI's hit test then stops reporting the row
     *  hitbox behind it as hovered, so the row's own mouseEnter/Leave never
     *  fire while the pointer is over the chip. Enter/leave are counted on
     *  BOTH the row and the chip instead — order-independent when moving
     *  between them (chip enter can land before row leave). The same
     *  blocking halves CLICKS, so the chip carries its own onClick —
     *  the original chip sits inside the row `<button>`. */
    const hoveredRow = ref<string | null>(null)
    const hoverCounts = new Map<string, number>()
    const rowEnter = (label: string) => {
      hoverCounts.set(label, (hoverCounts.get(label) ?? 0) + 1)
      hoveredRow.value = label
    }
    const rowLeave = (label: string) => {
      const count = (hoverCounts.get(label) ?? 0) - 1
      if (count <= 0) {
        hoverCounts.delete(label)
        if (hoveredRow.value === label) hoveredRow.value = null
      } else {
        hoverCounts.set(label, count)
      }
    }
    /** File whose diff preview is open, null when none. */
    const preview = ref<string | null>(null)

    /* The step script — one timeout in flight at a time, re-armed on every
     * advance, exactly like the original's useEffect chain. */
    const step = ref(0)
    const total = computed(() => props.steps.length + 1) // rows, then diff chips
    let stepTimer: ReturnType<typeof setTimeout> | undefined
    const advance = () => {
      if (step.value >= total.value) return
      stepTimer = setTimeout(() => {
        step.value += 1
        advance()
      }, STEP_MS)
    }
    onMounted(advance)
    onBeforeUnmount(() => {
      if (stepTimer !== undefined) clearTimeout(stepTimer)
    })

    const toggleRow = (label: string) => {
      const next = new Set(openRows.value)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      openRows.value = next
      props.onToggleRow?.(label, next.has(label))
    }

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const isOpen = open.value

      const diffPreview = (file: string) => {
        const diff = props.diffs.find((d) => d.file === file)
        const lines = props.diffLines[file] ?? []
        return (
          <anchored
            side="bottom"
            align="start"
            gap={6}
            fit="switch"
            motion={{
              initial: { opacity: 0 },
              animate: { opacity: 1 },
              transition: { duration: 0.16, ease: ease.outStrong },
            }}
            style={{
              width: 288,
              overflow: "hidden",
              borderRadius: radius.card,
              backgroundColor: t.surface,
              ...shadows.overlay,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottomWidth: 1,
                borderColor: t.line,
                paddingLeft: 10,
                paddingRight: 10,
                paddingTop: 6,
                paddingBottom: 6,
                fontFamily: fonts.mono,
                fontSize: 11,
              }}
            >
              <div style={{ minWidth: 0, color: t.ink2, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{file}</div>
              {diff && (
                <div style={{ display: "flex", flexShrink: 0, whiteSpace: "nowrap" }}>
                  <div style={{ color: t.green, whiteSpace: "nowrap" }}>{`+${diff.add}`}</div>
                  {diff.del > 0 && <div style={{ color: t.red, whiteSpace: "nowrap" }}>{` −${diff.del}`}</div>}
                </div>
              )}
            </div>
            <div style={{ paddingTop: 4, paddingBottom: 4, fontFamily: fonts.mono, fontSize: 11, lineHeight: 19.8 }}>
              {lines.map((line, index) => (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    gap: 8,
                    paddingLeft: 10,
                    paddingRight: 10,
                    ...(line.tone === "add"
                      ? { backgroundColor: t.greenTint, color: t.green }
                      : line.tone === "del"
                        ? { backgroundColor: t.redTint, color: t.red }
                        : { color: t.ink2 }),
                  }}
                >
                  <div style={{ width: 12, flexShrink: 0, userSelect: "none" }}>
                    {line.tone === "add" ? "+" : line.tone === "del" ? "−" : " "}
                  </div>
                  <div style={{ minWidth: 0, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{line.text}</div>
                </div>
              ))}
            </div>
          </anchored>
        )
      }

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 220,
            width: "100%",
            maxWidth: 320,
            paddingBottom: 4,
          }}
        >
          {/* collapsed run header */}
          <div
            role="button"
            aria-expanded={isOpen}
            onClick={() => {
              open.value = !open.value
              props.onOpenChange?.(open.value)
            }}
            style={{
              display: "flex",
              alignItems: "center",
              alignSelf: "flex-start",
              marginLeft: -6,
              marginRight: -6,
              gap: 6,
              borderRadius: radius.control,
              paddingLeft: 6,
              paddingRight: 6,
              paddingTop: 4,
              paddingBottom: 4,
              fontSize: 12.5,
              color: t.ink2,
              cursor: "pointer",
              hover: { backgroundColor: t.hover2 },
            }}
          >
            <Icon name={isOpen ? "chevronDown" : "chevronRight"} size={12} color={t.ink2} />
            {copy.value.header}
          </div>

          {/* tool call rows + diff chips, collapsible as one drawer */}
          <AnimateHeight
            height={isOpen ? "auto" : 0}
            duration={0.3}
            ease="ease"
            style={{ marginLeft: -4, marginRight: -4 }}
          >
            <motion.div
              initial={false}
              animate={{ opacity: isOpen ? 1 : 0 }}
              transition={{ duration: 0.3, ease: "ease" }}
              style={{ paddingLeft: 6, paddingRight: 6, paddingBottom: 4 }}
            >
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                {props.steps.slice(0, step.value).map((row) => {
                  const rowOpen = openRows.value.has(row.label)
                  const showChevron = rowOpen || hoveredRow.value === row.label
                  return (
                    <motion.div
                      key={row.label}
                      initial={{ opacity: 0, top: 8 }}
                      animate={{ opacity: 1, top: 0 }}
                      transition={{ duration: 0.3, ease: ease.outStrong }}
                      style={{ position: "relative" }}
                    >
                      <div
                        role="button"
                        testId={`toolchips-row-${row.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                        aria-expanded={rowOpen}
                        onClick={() => toggleRow(row.label)}
                        onMouseEnter={() => rowEnter(row.label)}
                        onMouseLeave={() => rowLeave(row.label)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          height: 28,
                          minWidth: 0,
                          marginLeft: -3,
                          marginRight: -3,
                          gap: 8,
                          borderRadius: radius.control,
                          paddingLeft: 3,
                          paddingRight: 3,
                          cursor: "pointer",
                          // The native hover wash paints instantly over the
                          // row's unfilled parts; the JS-driven fill covers
                          // the area the chip's blocking hitbox hides.
                          ...(hoveredRow.value === row.label ? { backgroundColor: t.hover2 } : {}),
                          hover: { backgroundColor: t.hover2 },
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            width: 16,
                            height: 16,
                            flexShrink: 0,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {showChevron ? (
                            <Icon name={rowOpen ? "chevronDown" : "chevronRight"} size={12} color={t.ink3} />
                          ) : (
                            <Icon name={STEP_ICONS[row.icon] ?? "sparkle"} size={13} color={t.ink3} />
                          )}
                        </div>
                        <div style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 500, color: t.ink, whiteSpace: "nowrap" }}>
                          {row.label}
                        </div>
                        <div
                          onClick={() => toggleRow(row.label)}
                          onMouseEnter={() => rowEnter(row.label)}
                          onMouseLeave={() => rowLeave(row.label)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            height: 22,
                            flexGrow: 1,
                            minWidth: 0,
                            borderRadius: radius.chip,
                            backgroundColor: t.field,
                            paddingLeft: 6,
                            paddingRight: 6,
                            cursor: "pointer",
                            ...shadows.hairline,
                            hover: { backgroundColor: t.hover2 },
                          }}
                        >
                          <div
                            style={{
                              minWidth: 0,
                              fontSize: 11.5,
                              color: t.ink2,
                              whiteSpace: "nowrap",
                              textOverflow: "ellipsis",
                              ...(row.mono ? { fontFamily: fonts.mono } : {}),
                            }}
                          >
                            {row.chip}
                          </div>
                        </div>
                      </div>

                      {/* expanded detail */}
                      <AnimateHeight height={rowOpen ? "auto" : 0} duration={0.3} ease={ease.outStrong}>
                        <motion.div
                          initial={false}
                          animate={{ opacity: rowOpen ? 1 : 0 }}
                          transition={{ duration: 0.3, ease: ease.outStrong }}
                        >
                          <div
                            style={{
                              marginTop: 2,
                              marginBottom: 4,
                              marginLeft: 8,
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                              borderLeftWidth: 1,
                              borderColor: t.line,
                              paddingTop: 2,
                              paddingBottom: 2,
                              paddingLeft: 14,
                            }}
                          >
                            {row.detail.map((line) => (
                              <div
                                key={line.text}
                                style={{
                                  minWidth: 0,
                                  fontSize: 11.5,
                                  lineHeight: 18.4,
                                  whiteSpace: "nowrap",
                                  textOverflow: "ellipsis",
                                  ...(row.detailMono ? { fontFamily: fonts.mono } : {}),
                                  color: line.tone === "add" ? t.green : t.ink2,
                                }}
                              >
                                {line.text}
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      </AnimateHeight>
                    </motion.div>
                  )
                })}
              </div>

              {/* file-diff chips */}
              {step.value >= total.value && (
                <div
                  style={{
                    marginTop: 10,
                    display: "flex",
                    flexDirection: "row",
                    flexWrap: "wrap",
                    maxWidth: "100%",
                    gap: 6,
                    borderTopWidth: 1,
                    borderColor: t.line,
                    paddingTop: 10,
                  }}
                >
                  {props.diffs.map((d, i) => (
                    <div
                      key={d.file}
                      style={{ position: "relative", display: "flex", maxWidth: "100%" }}
                    >
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.25, delay: i * 0.08, ease: ease.outStrong }}
                        style={{ display: "flex", maxWidth: "100%" }}
                      >
                        {/* The hover handlers live on the filled chip itself:
                         *  its BlockMouseExceptScroll hitbox hides everything
                         *  painted before it from GPUI's hover hit test. */}
                        <div
                          role="button"
                          aria-expanded={preview.value === d.file}
                          aria-label={`Show diff for ${d.file}`}
                          onMouseEnter={() => {
                            preview.value = d.file
                          }}
                          onMouseLeave={() => {
                            if (preview.value === d.file) preview.value = null
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            height: 28,
                            maxWidth: "100%",
                            gap: 8,
                            borderRadius: radius.chip,
                            backgroundColor: t.surface,
                            paddingLeft: 8,
                            paddingRight: 8,
                            cursor: "pointer",
                            ...shadows.btn,
                            hover: { backgroundColor: t.hover },
                          }}
                        >
                          <div
                            style={{
                              minWidth: 0,
                              fontFamily: fonts.mono,
                              fontSize: 11.5,
                              color: t.ink,
                              whiteSpace: "nowrap",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {d.file}
                          </div>
                          <div style={{ flexShrink: 0, fontFamily: fonts.mono, fontSize: 11.5, color: t.green, whiteSpace: "nowrap" }}>{`+${d.add}`}</div>
                          {d.del > 0 && (
                            <div style={{ flexShrink: 0, fontFamily: fonts.mono, fontSize: 11.5, color: t.red, whiteSpace: "nowrap" }}>{`−${d.del}`}</div>
                          )}
                        </div>
                      </motion.div>
                      {preview.value === d.file && diffPreview(d.file)}
                    </div>
                  ))}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3, delay: props.diffs.length * 0.08, ease: ease.out }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      height: 28,
                      borderRadius: radius.chip,
                      paddingLeft: 6,
                      paddingRight: 6,
                      fontFamily: fonts.mono,
                      fontSize: 11.5,
                      color: t.ink3,
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                      hover: { color: t.ink2 },
                    }}
                  >
                    {copy.value.more}
                  </motion.div>
                </div>
              )}
            </motion.div>
          </AnimateHeight>
        </div>
      )
    }
  },
})
