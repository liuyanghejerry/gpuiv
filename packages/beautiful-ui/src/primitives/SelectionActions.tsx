/** SELECTION ACTIONS — a contextual AI bar floating beneath selected text.
 *
 *  Ported from beautiful-ui `components/primitives/SelectionActions.tsx`.
 *  The passage is real selectable text; the 36px pill carries a prompt input,
 *  the primary AI actions (a chevron reveals the "more" set, a typed prompt
 *  swaps them for a send button), then runs the canned rewrite machine —
 *  thinking (700ms) → word stream → Keep / Discard / Retry.
 *
 *  Platform degradations and deliberate differences from the web original:
 *
 *  - Anchor: the original measures `selection.getBoundingClientRect()` and
 *    `getClientRects()` to pin the bar beneath the selection's last line,
 *    centered on its bounds, re-running on every streaming reflow. GPUIV has
 *    no selection-bounds query — only `getSelectedText()` /
 *    `clearSelection()` and a window-level `onSelectionChange` that a
 *    component cannot subscribe to — so positioning degrades deliberately:
 *    the bar anchors under the measured passage block (`useElementBounds`
 *    poll) for the demo, and re-anchors to the POINTER position
 *    (host-relative, +8px below, clamped horizontally to the host) whenever
 *    a non-empty selection appears — on `mouseUp` live, or via a 120ms
 *    `getSelectedText()` poll that also catches programmatic selections
 *    (`dragSelect` in tests). Like the original — whose `useLayoutEffect`
 *    re-places the bar on every mode change — running an action or
 *    resetting drops the pointer anchor so the bar glides back under the
 *    passage.
 *  - Inline flow does not exist: the `<p>` + highlighted `<span>` become a
 *    `flexWrap` word row (the StreamingText pattern) with a 3.5px column
 *    gap ≈ one 13px space advance. The selection tint is a per-word chip
 *    (rounded 3) — `box-decoration-clone` per-line rounding is impossible.
 *    The light-mode tint is `accent` at 14% alpha (composited over the
 *    canvas it equals the original's `color-mix(in srgb, accent 14%,
 *    surface)`; alpha compositing also stays correct where the chips
 *    overlap the card fill).
 *  - The bar's `translate3d(anchor) translateX(-50%)` with a 320ms
 *    cubic-bezier(0.77,0,0.175,1) transform transition becomes `motion`
 *    `left`/`top` tweens at the same timing; the -50% centering uses the
 *    measured pill width, so the first paint can drift a hair before the
 *    bounds poll lands.
 *  - `pop-in` (opacity + scale 0.95→1, 220ms) merges into the visibility
 *    gate as one 220ms opacity fade — no scale in GPUIV.
 *  - The idle choreography's `max-width`/`opacity`/`transform` transitions
 *    (400ms cubic-bezier(0.23,1,0.32,1)) become `motion` `width`/`opacity`
 *    tweens on overflow-hidden clips at the same timing. The
 *    `translateX(-8px)` and `scale(0.88)` collapse nudges are dropped, and
 *    the more-menu's animated `marginLeft` snaps. Region width targets
 *    compose from an invisible absolutely-positioned measurer stack that
 *    keeps the two action rows at intrinsic width (a 0-width clip squeezes
 *    its content in Taffy, so the rows cannot be measured in place); the
 *    original's 145/262px constants stand in until the polls land.
 *  - `typingWidth` — freeze the bar at its pre-keystroke width once a
 *    prompt exists — reads the polled pill width instead of a synchronous
 *    `getBoundingClientRect()`, so it can be up to one 100ms poll stale.
 *  - The WAAPI width morph between modes (320ms, measured pre-paint) is
 *    dropped: GPUIV has no pre-paint measurement, so the bar snaps between
 *    idle/busy/result widths while each block fades in.
 *  - The busy spinner (a 1.5px ring with a spinning top border, 700ms
 *    linear) becomes the static `ringArc` glyph — no rotate (the TaskRows
 *    decision). The thinking label keeps the Shimmer atom's breathing
 *    opacity; the streaming label is plain.
 *  - StreamText's char-by-char reveal (2 chars/9ms, 6-char blur tail,
 *    blinking caret) becomes a word stream at 55ms/word (the StreamingText
 *    pace); the blur tail is dropped (no filter) and the caret is a static
 *    2×12px block fading in.
 *  - Real-selection integration (a port addition): `run()` snapshots
 *    `getSelectedText()` into `onAction(action, selectedText)` and clears
 *    the selection. The rewrite itself stays canned to the `text` prop —
 *    GPUIV has no API to replace a selected range (platform gap).
 *  - `active:scale-[0.96]` presses drop to hover color/opacity swaps; the
 *    expand chevron's `rotate(180deg)` becomes a chevronRight ↔
 *    chevronLeft glyph swap (the FineTuneCard decision); icon hovers keep
 *    their resting tint (an `<svg>` colours itself from its own style).
 *  - Enter submits through the input's `onSubmit` (GPUIV's single-line
 *    input consumes Enter before keyDown — the ApprovalCard finding); the
 *    `<form>` reduces to that handler. The placeholder keeps the native
 *    tint (`placeholder:text-ink-3` is not stylable), and roles/aria-* are
 *    passthroughs — no DOM accessibility tree.
 *  - The unused `variant` prop is accepted for gallery/registry parity.
 */

import { computed, defineComponent, onBeforeUnmount, onMounted, ref, watch, type PropType } from "vue"
import { motion, useElementBounds, useGpuix, type EventPayload, type HostNode } from "@gpuiv/vue"
import { ease, radius } from "../tokens.js"
import { withAlpha } from "../colors.js"
import { useTheme } from "../theme.js"
import { Button } from "../atoms/Button.js"
import { Icon } from "../atoms/Icon.js"
import { Shimmer } from "../atoms/Shimmer.js"
import type { IconName } from "../icons.js"

/** The passage: lead-in text, the selected `original`, and the streamed `rewrite`. */
export interface SelectionText {
  lead: string
  original: string
  rewrite: string
}

/** A single AI action offered in the bar. Omit `action` for a no-op button
 *  (e.g. Explain); `busyLabel` is the gerund shown while it runs. */
export interface SelectionAction {
  id: string
  icon: IconName
  action?: string
  busyLabel?: string
}

/** The action set: `primary` are always visible; `more` reveal on expand. */
export interface SelectionActionSet {
  primary: SelectionAction[]
  more: SelectionAction[]
}

/** Prominent copy strings. */
export interface SelectionActionsLabels {
  keep: string
  discard: string
  placeholder: string
}

const DEFAULT_TEXT: SelectionText = {
  lead: "Pistachio holds the top slot all weekend. ",
  original: "Churn it first thing Saturday so the batch has time to firm up before the afternoon rush.",
  rewrite:
    "Churn pistachio first thing Saturday so the batch has time to fully firm before the afternoon rush.",
}

const DEFAULT_LABELS: SelectionActionsLabels = {
  keep: "Keep",
  discard: "Discard",
  placeholder: "Describe edits",
}

const DEFAULT_ACTIONS: SelectionActionSet = {
  primary: [
    { id: "Explain", icon: "chatBubbleQuestion" },
    { id: "Improve", icon: "sparkles", action: "Improve", busyLabel: "Improving" },
  ],
  more: [
    { id: "Shorten", icon: "scissor", action: "Shorten", busyLabel: "Shortening" },
    { id: "Tone", icon: "smile", action: "Change tone", busyLabel: "Changing tone" },
    { id: "Grammar", icon: "textBox", action: "Fix grammar" },
  ],
}

type Mode = "idle" | "thinking" | "streaming" | "result"

/** Delay before the bar first shows (the original's 280ms). */
const SHOW_MS = 280
/** The thinking hold before the stream starts (the original's 700ms). */
const THINK_MS = 700
/** One streamed word (the StreamingText pace). */
const WORD_MS = 55
/** The poll that watches for programmatic selections (dragSelect in tests). */
const SELECTION_POLL_MS = 120
/** Prompt input width (the original's `w-[145px]`). */
const INPUT_W = 145
/** Send button slot inside its clip (the original's 30px). */
const SEND_W = 30
/** Pre-measurement stand-ins for the action rows (the original's constants). */
const PRIMARY_FALLBACK_W = 150
const MORE_FALLBACK_W = 262

/** Region collapse/expand — the original's 400ms cubic-bezier(0.23,1,0.32,1). */
const REGION_TRANSITION = { duration: 0.4, ease: ease.outStrong }
/** Anchor glide — the original's 320ms cubic-bezier(0.77,0,0.175,1). */
const ANCHOR_TRANSITION = { duration: 0.32, ease: ease.inOutStrong }
/** Mode-block entry + the merged pop-in/visibility fade. */
const FADE_TRANSITION = { duration: 0.22, ease: ease.outStrong }
/** CSS `ease-out` — the caret fade. */
const EASE_OUT = [0, 0, 0.58, 1] as [number, number, number, number]

export const SelectionActions = defineComponent({
  name: "BuiSelectionActions",
  props: {
    /** Accepted for gallery/registry parity; not used by this bar. */
    variant: { type: String as PropType<string>, default: undefined },
    /** The passage shown above the bar. */
    text: { type: Object as PropType<Partial<SelectionText>>, default: undefined },
    /** The AI actions offered in the bar. */
    actions: { type: Object as PropType<SelectionActionSet>, default: () => DEFAULT_ACTIONS },
    /** Prominent copy strings. */
    labels: { type: Object as PropType<Partial<SelectionActionsLabels>>, default: undefined },
    /** Called with the action name and the text it will operate on (the
     *  selection at run time, null when none) whenever an edit is run. */
    onAction: {
      type: Function as PropType<(action: string, selectedText: string | null) => void>,
      default: undefined,
    },
  },
  setup(props) {
    const theme = useTheme()
    const { renderer } = useGpuix()

    const passage = computed<SelectionText>(() => ({ ...DEFAULT_TEXT, ...props.text }))
    const copy = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }))

    const shown = ref(false)
    const mode = ref<Mode>("idle")
    const action = ref("Improve")
    const prompt = ref("")
    const typingWidth = ref<number | null>(null)
    const expanded = ref(false)
    /** Pointer-anchored position, host-relative; null until the user selects. */
    const userAnchor = ref<{ x: number; y: number } | null>(null)
    const streamCount = ref(0)

    const hostRef = ref<HostNode | null>(null)
    const passageRef = ref<HostNode | null>(null)
    const barRef = ref<HostNode | null>(null)
    const primaryRowRef = ref<HostNode | null>(null)
    const moreRowRef = ref<HostNode | null>(null)
    const host = useElementBounds(hostRef)
    const passageBox = useElementBounds(passageRef)
    const bar = useElementBounds(barRef)
    const primaryRow = useElementBounds(primaryRowRef)
    const moreRow = useElementBounds(moreRowRef)

    /** Last pointer position, host-relative — where a new selection anchors. */
    let lastPointer: { x: number; y: number } | null = null
    let lastSelection: string | null = null
    let showTimer: ReturnType<typeof setTimeout> | undefined
    let thinkTimer: ReturnType<typeof setTimeout> | undefined
    let streamTimer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setInterval> | undefined

    const clearThink = () => {
      if (thinkTimer !== undefined) {
        clearTimeout(thinkTimer)
        thinkTimer = undefined
      }
    }
    const clearStream = () => {
      if (streamTimer !== undefined) {
        clearTimeout(streamTimer)
        streamTimer = undefined
      }
    }

    const readSelection = (): string | null => {
      try {
        return renderer?.getSelectedText?.() ?? null
      } catch {
        return null
      }
    }

    const placeAtPointer = () => {
      if (lastPointer === null) return
      userAnchor.value = { x: Math.round(lastPointer.x), y: Math.round(lastPointer.y + 8) }
    }

    /** Whether the pointer currently sits inside the pill — mouseUps on the
     *  bar itself must not re-anchor the bar under itself. */
    const pointerInsideBar = () => {
      const box = host.bounds.value
      const pill = bar.bounds.value
      if (lastPointer === null || box === null || pill === null) return false
      const x = lastPointer.x + box.x
      const y = lastPointer.y + box.y
      return x >= pill.x && x <= pill.x + pill.width && y >= pill.y && y <= pill.y + pill.height
    }

    const notePointer = (event: EventPayload) => {
      const box = host.bounds.value
      if (box === null || event.x === undefined || event.y === undefined) return
      lastPointer = { x: event.x - box.x, y: event.y - box.y }
    }

    const scheduleStream = () => {
      const total = rewriteWords.value.length
      if (streamCount.value >= total) {
        mode.value = "result"
        return
      }
      streamTimer = setTimeout(() => {
        streamTimer = undefined
        streamCount.value += 1
        scheduleStream()
      }, WORD_MS)
    }

    const leadWords = computed(() => passage.value.lead.trim().split(/\s+/))
    const originalWords = computed(() => passage.value.original.split(" "))
    const rewriteWords = computed(() => passage.value.rewrite.split(" "))

    watch(mode, (next) => {
      clearThink()
      clearStream()
      if (next === "thinking") {
        thinkTimer = setTimeout(() => {
          thinkTimer = undefined
          mode.value = "streaming"
        }, THINK_MS)
      } else if (next === "streaming") {
        streamCount.value = 0
        scheduleStream()
      }
    })

    /* Freeze the bar at its pre-keystroke width once a prompt exists, so the
     * collapsing actions do not shrink it under the caret (the original's
     * typingWidth, measured from the polled pill bounds). */
    watch(prompt, (next, prev) => {
      if (!prev.trim() && next.trim()) {
        const width = bar.bounds.value?.width
        typingWidth.value = width != null && width > 0 ? Math.ceil(width) : null
      } else if (!next.trim()) {
        typingWidth.value = null
      }
    })

    const run = (nextAction: string) => {
      const selection = readSelection()
      if (selection !== null && selection.length > 0) {
        renderer?.clearSelection?.()
        lastSelection = null
      }
      action.value = nextAction
      expanded.value = false
      userAnchor.value = null
      mode.value = "thinking"
      props.onAction?.(nextAction, selection)
    }

    const reset = () => {
      expanded.value = false
      prompt.value = ""
      typingWidth.value = null
      action.value = "Improve"
      streamCount.value = 0
      userAnchor.value = null
      mode.value = "idle"
    }

    onMounted(() => {
      showTimer = setTimeout(() => {
        showTimer = undefined
        shown.value = true
      }, SHOW_MS)
      /* Window-level selectionChange is not component-subscribable, so a
       * light poll re-anchors the bar for selections made without a mouseUp
       * through this host (dragSelect in tests, selections from elsewhere). */
      pollTimer = setInterval(() => {
        const selection = readSelection()
        if (selection === lastSelection) return
        lastSelection = selection
        if (selection !== null && selection.length > 0) placeAtPointer()
      }, SELECTION_POLL_MS)
    })
    onBeforeUnmount(() => {
      if (showTimer !== undefined) clearTimeout(showTimer)
      if (pollTimer !== undefined) clearInterval(pollTimer)
      clearThink()
      clearStream()
    })

    /* All geometry below lives in `computed`s keyed on host-RELATIVE
     * differences: a scroll or window move translates every bounds reading
     * equally, so the computed outputs do not change and the component does
     * not re-render while the user scrolls the page. Computing these inline
     * in the render function re-rendered on every bounds poll tick during
     * scroll, and the bar's own tween re-arming on each new reading kept the
     * frame loop hot even at rest. */
    const anchored = computed(() => {
      const user = userAnchor.value
      if (user !== null) return user
      const box = host.bounds.value
      const paragraph = passageBox.bounds.value
      if (box === null || paragraph === null) return null
      return {
        x: Math.round(paragraph.x - box.x + paragraph.width / 2),
        y: Math.round(paragraph.y - box.y + paragraph.height + 8),
      }
    })
    const barPosition = computed(() => {
      const a = anchored.value
      let left = 0
      let top = 0
      if (a !== null) {
        top = a.y
        const pillWidth = bar.bounds.value?.width
        let x = a.x - (pillWidth ?? 0) / 2
        const box = host.bounds.value
        if (box !== null) {
          const maxLeft = Math.max(box.width - (pillWidth ?? 0) - 4, 4)
          x = Math.min(Math.max(x, 4), maxLeft)
        }
        left = Math.round(x)
      }
      return { left, top }
    })
    const regionTargets = computed(() => {
      const primaryW = primaryRow.bounds.value?.width
      const moreW = moreRow.bounds.value?.width
      const primaryWidth = primaryW != null && primaryW > 0 ? primaryW : PRIMARY_FALLBACK_W
      const moreWidth = moreW != null && moreW > 0 ? moreW : MORE_FALLBACK_W
      /* Region targets composed from the measured rows: dividers (1px +
       * margins), the 2px row gaps, and the 28px chevron — P + 50 collapsed,
       * P + M + 41 expanded (the leading divider hides when expanded). */
      const isExpanded = expanded.value
      const hasPrompt = prompt.value.trim().length > 0
      const typing = typingWidth.value
      return {
        actions: hasPrompt ? 0 : isExpanded ? primaryWidth + moreWidth + 41 : primaryWidth + 50,
        input: isExpanded ? 0 : hasPrompt && typing !== null ? Math.max(typing - 40, 60) : INPUT_W,
        more: moreWidth,
      }
    })

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const isDark = theme.isDark.value
      const tint = isDark ? t.accentTint : withAlpha(t.accent, 0.14)

      const busy = mode.value === "thinking" || mode.value === "streaming"
      const hasPrompt = prompt.value.trim().length > 0
      const visible = shown.value && anchored.value !== null
      const { left: barLeft, top: barTop } = barPosition.value
      const { actions: actionsTarget, input: inputTarget } = regionTargets.value
      const busyLabelMap: Record<string, string> = {}
      for (const item of [...props.actions.primary, ...props.actions.more]) {
        if (item.action !== undefined && item.busyLabel !== undefined) busyLabelMap[item.action] = item.busyLabel
      }
      const busyLabel = busyLabelMap[action.value] ?? "Editing"

      const shownSelectionWords =
        mode.value === "idle" || mode.value === "thinking"
          ? originalWords.value
          : mode.value === "result"
            ? rewriteWords.value
            : rewriteWords.value.slice(0, streamCount.value)

      const divider = (color: string, margin: number) => (
        <div style={{ width: 1, height: 16, flexShrink: 0, backgroundColor: color, marginLeft: margin, marginRight: margin }} />
      )

      /* GPUIV events do not bubble, so the pointer handlers ride on every
       * word div — the only elements actually hit inside the passage. The
       * mouseDown + mouseMove pair also arms pointer capture per word, so
       * lastPointer keeps tracking a drag that leaves the word's box. */
      const wordEvents = {
        onMouseDown: notePointer,
        onMouseMove: notePointer,
        onMouseUp: (event: EventPayload) => {
          notePointer(event)
          const selection = readSelection()
          if (selection !== null && selection.length > 0 && !pointerInsideBar()) placeAtPointer()
        },
      }
      const wordStyle = { fontSize: 13, lineHeight: 21, color: t.ink }

      const actionButton = (item: SelectionAction, prefix = "sa") => (
        <Button
          key={item.id}
          variant="quiet"
          size="xs"
          testId={`${prefix}-action-${item.id}`}
          onClick={item.action !== undefined ? () => run(item.action!) : undefined}
          style={{ fontWeight: 400, flexShrink: 0 }}
        >
          <Icon name={item.icon} size={14} color={t.ink} />
          {item.id}
        </Button>
      )

      return (
        <div style={{ width: "100%", maxWidth: 460 }}>
          <div ref={hostRef} style={{ position: "relative", paddingBottom: 48 }}>
            {/* passage — one wrapping word row; selection words carry the tint */}
            <div
              ref={passageRef}
              testId="sa-passage"
              style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 3.5, userSelect: "text", cursor: "text" }}
            >
              {leadWords.value.map((word, i) => (
                <div key={`lead-${i}`} {...wordEvents} style={wordStyle}>
                  {word}
                </div>
              ))}
              {shownSelectionWords.map((word, i) => (
                <div
                  key={`sel-${i}`}
                  {...wordEvents}
                  style={{ ...wordStyle, borderRadius: 3, backgroundColor: tint }}
                >
                  {word}
                </div>
              ))}
              {mode.value === "streaming" && streamCount.value < rewriteWords.value.length && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15, ease: EASE_OUT }}
                  style={{ width: 2, height: 12, borderRadius: 1, backgroundColor: t.ink }}
                />
              )}
            </div>

            {/* the floating bar — left/top glide, then the opacity gate */}
            <motion.div
              initial={false}
              animate={{ left: barLeft, top: barTop }}
              transition={ANCHOR_TRANSITION}
              style={{ position: "absolute", left: 0, top: 0, pointerEvents: visible ? ("auto" as const) : ("none" as const) }}
            >
              <motion.div initial={false} animate={{ opacity: visible ? 1 : 0 }} transition={FADE_TRANSITION}>
                <div
                  ref={barRef}
                  testId="sa-bar"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                    height: 36,
                    padding: 4,
                    overflow: "hidden",
                    borderRadius: radius.pill,
                    backgroundColor: t.surface,
                    userSelect: "none",
                    ...shadows.overlay,
                    ...(typingWidth.value !== null ? { width: typingWidth.value } : {}),
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      flexShrink: 0,
                      ...(typingWidth.value !== null ? { width: typingWidth.value - 8 } : {}),
                    }}
                  >
                    {busy ? (
                      <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={FADE_TRANSITION} style={{ display: "flex", flexShrink: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, height: 28, paddingLeft: 10, paddingRight: 10, fontSize: 12.5, color: t.ink2 }}>
                          <Icon name="ringArc" size={12} color={t.ink2} />
                          {mode.value === "thinking" ? <Shimmer>{`${busyLabel}…`}</Shimmer> : <div>{`${busyLabel}…`}</div>}
                        </div>
                      </motion.div>
                    ) : mode.value === "result" ? (
                      <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={FADE_TRANSITION} style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                        <div
                          role="button"
                          testId="sa-keep"
                          onClick={reset}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            height: 28,
                            flexShrink: 0,
                            paddingLeft: 10,
                            paddingRight: 10,
                            borderRadius: radius.pill,
                            backgroundColor: t.ink,
                            color: t.canvas,
                            fontSize: 12.5,
                            cursor: "pointer",
                            ...shadows.hairline,
                            hover: { opacity: 0.9 },
                          }}
                        >
                          <Icon name="check" size={14} color={t.canvas} />
                          {copy.value.keep}
                        </div>
                        <Button variant="quiet" size="xs" testId="sa-discard" onClick={reset} style={{ fontWeight: 400, flexShrink: 0 }}>
                          <Icon name="x" size={14} color={t.ink} />
                          {copy.value.discard}
                        </Button>
                        {divider(t.line, 2)}
                        <div
                          role="button"
                          aria-label="Try again"
                          testId="sa-retry"
                          onClick={() => {
                            run(action.value)
                          }}
                          style={{
                            display: "flex",
                            width: 28,
                            height: 28,
                            flexShrink: 0,
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: radius.pill,
                            cursor: "pointer",
                            hover: { backgroundColor: t.hover2 },
                          }}
                        >
                          <Icon name="retrySoft" size={14} color={t.ink3} />
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={FADE_TRANSITION} style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                        {/* prompt input region */}
                        <div testId="sa-clip-input" style={{ flexShrink: 0 }}>
                          <motion.div
                            animate={{ width: inputTarget, opacity: expanded.value ? 0 : 1 }}
                            transition={REGION_TRANSITION}
                            style={{ overflow: "hidden" }}
                          >
                          <div style={{ display: "flex", height: 28, width: inputTarget > 0 ? inputTarget : INPUT_W, flexShrink: 0 }}>
                            <input
                              value={prompt.value}
                              placeholder={copy.value.placeholder}
                              aria-label={copy.value.placeholder}
                              testId="sa-prompt"
                              onChange={(event: EventPayload) => {
                                prompt.value = event.value ?? ""
                              }}
                              onSubmit={() => {
                                run(prompt.value.trim() || "Improve")
                              }}
                              style={{ width: "100%", height: 28, fontSize: 12.5, color: t.ink, paddingLeft: 12, paddingRight: 10 }}
                            />
                          </div>
                        </motion.div>
                        </div>

                        {/* actions region */}
                        <div testId="sa-clip-actions" style={{ flexShrink: 0 }}>
                          <motion.div
                            animate={{ width: actionsTarget, opacity: hasPrompt ? 0 : 1 }}
                            transition={REGION_TRANSITION}
                            style={{ overflow: "hidden" }}
                          >
                          <div style={{ display: "flex", alignItems: "center", gap: 2, height: 28, flexShrink: 0 }}>
                            {!expanded.value ? divider(t.lineStrong, 4) : null}
                            <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                              {props.actions.primary.map((item) => actionButton(item))}
                            </div>
                            <div testId="sa-clip-more" style={{ flexShrink: 0, marginLeft: expanded.value ? 2 : 0 }}>
                              <motion.div
                                animate={{ width: expanded.value ? regionTargets.value.more : 0, opacity: expanded.value ? 1 : 0 }}
                                transition={REGION_TRANSITION}
                                style={{ overflow: "hidden" }}
                              >
                              <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                                {props.actions.more.map((item) => actionButton(item))}
                              </div>
                              </motion.div>
                            </div>
                            {divider(t.line, 2)}
                            <div
                              role="button"
                              aria-label={expanded.value ? "Show fewer actions" : "Show more actions"}
                              aria-expanded={expanded.value}
                              testId="sa-expand"
                              onClick={() => {
                                expanded.value = !expanded.value
                              }}
                              style={{
                                display: "flex",
                                width: 28,
                                height: 28,
                                flexShrink: 0,
                                alignItems: "center",
                                justifyContent: "center",
                                borderRadius: radius.pill,
                                cursor: "pointer",
                                hover: { backgroundColor: t.hover },
                              }}
                            >
                              <Icon name={expanded.value ? "chevronLeft" : "chevronRight"} size={14} color={t.ink} />
                            </div>
                          </div>
                          </motion.div>
                        </div>

                        {/* send region */}
                        <div testId="sa-clip-send" style={{ flexShrink: 0 }}>
                          <motion.div
                            animate={{ width: hasPrompt ? SEND_W : 0, opacity: hasPrompt ? 1 : 0 }}
                            transition={REGION_TRANSITION}
                            style={{ overflow: "hidden" }}
                          >
                          <div style={{ display: "flex", justifyContent: "center", width: SEND_W }}>
                            <div
                              role="button"
                              aria-label="Send edit instruction"
                              testId="sa-send"
                              onClick={() => {
                                if (hasPrompt) run(prompt.value.trim())
                              }}
                              style={{
                                display: "flex",
                                width: 28,
                                height: 28,
                                alignItems: "center",
                                justifyContent: "center",
                                borderRadius: radius.pill,
                                backgroundColor: t.ink,
                                cursor: "pointer",
                                hover: { opacity: 0.9 },
                              }}
                            >
                              <Icon name="arrowUp" size={16} color={t.surface} />
                            </div>
                          </div>
                          </motion.div>
                        </div>

                        {/* Intrinsic-width measurer for the two action rows.
                            The clips squeeze their content while collapsed, so
                            the region targets cannot be measured in place;
                            this invisible absolute stack always lays the rows
                            out at full width (column + flex-start keeps each
                            row at its own content width — block children
                            would stretch to the widest sibling). */}
                        <div
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            opacity: 0,
                            pointerEvents: "none",
                          }}
                          aria-hidden="true"
                        >
                          <div ref={primaryRowRef} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                            {props.actions.primary.map((item) => actionButton(item, "sam"))}
                          </div>
                          <div ref={moreRowRef} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                            {props.actions.more.map((item) => actionButton(item, "sam"))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </div>
      )
    }
  },
})
