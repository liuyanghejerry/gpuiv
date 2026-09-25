/** APPROVAL CARD — human-in-the-loop questions, one at a time.
 *
 *  Ported from beautiful-ui `components/primitives/ApprovalCard.tsx`.
 *  The question stack slides vertically (the card's height tweens to fit),
 *  the step counter rolls like an odometer, and the footer keeps the pill
 *  actions — a quiet Skip and an accent Continue. Single-choice answers
 *  auto-advance after 480ms; multi-select waits.
 *
 *  Platform degradations and deliberate differences from the web original:
 *
 *  - The stack slide's `translate3d(0, -trackY, 0)` + measured
 *    `offsetTop`/`offsetHeight` become per-question height reports from
 *    `useElementBounds` (painted bounds, polled at ≤100ms) feeding `motion`
 *    `top`/`height` tweens on the same 360ms cubic-bezier(0.22,1,0.36,1).
 *    trackY is derived as Σ earlier heights + 26px gaps. Like the
 *    original's `ready` gate, only the active question mounts until its
 *    first measurement lands; a question change inside that first paint
 *    window swaps instantly instead of sliding, then self-heals.
 *  - The odometer's per-character translateY columns become per-character
 *    `top` tweens inside 12px overflow-hidden clip cells (same 350ms
 *    cubic-bezier(0.4,0,0.2,1), same 400ms roll window). Unchanged
 *    character runs render as single text nodes so the counter's spacing
 *    stays natural. `tabular-nums` and the −0.05em verticalAlign nudge are
 *    dropped (no font-feature-settings / vertical-align in GPUIV), so a
 *    changing digit's width can jitter a hair mid-roll.
 *  - The radio dot's `scale(0 ↔ 1)` transition is an instant show/hide (no
 *    transform animation), as is every `transition-colors` — hover states
 *    swap via the native `hover:` style.
 *  - The card entrance (`fade-up`: opacity + translateY 8px, 380ms) becomes
 *    a `motion` opacity + `top` tween; the sent row's `pop-in` (opacity +
 *    scale 0.95 → 1, 260ms) becomes an opacity-only fade.
 *  - The off-state ring's `shadow-[inset_0_0_0_1.5px]` becomes a 1.5px
 *    `lineStrong` border (no inset shadows in GPUIV).
 *  - The nav chevrons and dismiss X keep `ink3` on hover: an `<svg>` tints
 *    only from its own `color`, so the original's `hover:text-ink` cannot
 *    reach the glyph (same constraint as SearchList).
 *  - Enter in the custom-answer input is wired through `onSubmit` — GPUIV's
 *    single-line input consumes Enter before `keyDown` (same as SearchList).
 *    The `<label>`'s click-to-focus becomes a row `onClick` →
 *    `focusElement`.
 *  - Inactive questions get `pointerEvents: "none"` instead of roving
 *    `tabIndex`; option rows are not keyboard-activatable (the footer
 *    pills/nav remain clickable), and `aria-live` is dropped — there is no
 *    DOM accessibility tree, roles/aria-* are a passthrough only.
 *  - `prefers-reduced-motion` is not read (no media-query hook in GPUIV);
 *    the slide and roll always animate.
 *  - The original's unused `variant` prop is dropped.
 */

import { computed, defineComponent, onBeforeUnmount, ref, watch, type PropType } from "vue"
import { motion, useElementBounds, useGpuix, type EventPayload, type HostNode } from "@gpuiv/vue"
import { ease, radius } from "../tokens.js"
import { useTheme } from "../theme.js"
import { Button } from "../atoms/Button.js"
import { GlideMenuItem, GlideMenuRoot } from "../atoms/GlideMenu.js"
import { Icon } from "../atoms/Icon.js"

export type ApprovalQuestion = {
  q: string
  type: "radio" | "check"
  options: string[]
}

const QUESTIONS: ApprovalQuestion[] = [
  {
    q: "How many flavors should we launch?",
    type: "radio",
    options: ["Three (core line)", "Five (full case)", "Just one hero"],
  },
  {
    q: "Which mix-ins should we stock?",
    type: "check",
    options: ["Chocolate chips", "Waffle bits", "Sprinkles"],
  },
  {
    q: "Which market do we enter first?",
    type: "radio",
    options: ["Food trucks", "Grocery freezers", "Scoop shops"],
  },
]

export type ApprovalLabels = {
  skip: string
  continue: string
  send: string
  customPlaceholder: string
  sentMessage: string
}

const DEFAULT_LABELS: ApprovalLabels = {
  skip: "Skip",
  continue: "Continue",
  send: "Send",
  customPlaceholder: "Something else…",
  sentMessage: "Answers sent",
}

/** Roll window of one odometer digit (the original's ROLL_MS). */
const ROLL_MS = 400
/** The stack slide — the original's `SLIDE`, in seconds. */
const SLIDE_TRANSITION = { duration: 0.36, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }
/** One digit's roll — 350ms cubic-bezier(0.4, 0, 0.2, 1), in seconds. */
const ROLL_TRANSITION = { duration: 0.35, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }
/** Vertical gap between questions in the sliding track. */
const TRACK_GAP = 26
/** The counter's line box: 12px font at line-height 1. */
const COUNTER_LINE = 12

const EMPTY_PICKED: number[] = []

/* ── Rolling digits ──────────────────────────────────────
 * Each character that changes rolls up (or down) inside a one-line clip
 * cell; unchanged runs render as plain text. */

type CounterSegment =
  | { kind: "run"; text: string }
  | { kind: "cell"; index: number; from: string; to: string }

function counterSegments(value: string, oldValue: string, rolling: boolean): CounterSegment[] {
  const out: CounterSegment[] = []
  let run = ""
  for (let i = 0; i < value.length; i++) {
    const next = value[i] ?? ""
    const prev = rolling ? (oldValue[i] ?? "") : next
    if (rolling && prev !== next) {
      if (run) {
        out.push({ kind: "run", text: run })
        run = ""
      }
      out.push({ kind: "cell", index: i, from: prev, to: next })
    } else {
      run += next
    }
  }
  if (run) out.push({ kind: "run", text: run })
  return out
}

const RollingDigits = defineComponent({
  name: "BuiApprovalRollingDigits",
  props: {
    value: { type: String, required: true },
  },
  setup(props) {
    const theme = useTheme()
    const oldValue = ref(props.value)
    const rolling = ref(false)
    const direction = ref<"up" | "down">("up")
    let rollTimer: ReturnType<typeof setTimeout> | undefined
    onBeforeUnmount(() => {
      if (rollTimer !== undefined) clearTimeout(rollTimer)
    })
    watch(
      () => props.value,
      (next, prev) => {
        if (next === prev) return
        const fromN = Number.parseInt(prev, 10)
        const toN = Number.parseInt(next, 10)
        direction.value = Number.isFinite(fromN) && Number.isFinite(toN) && toN < fromN ? "down" : "up"
        oldValue.value = prev
        rolling.value = true
        if (rollTimer !== undefined) clearTimeout(rollTimer)
        rollTimer = setTimeout(() => {
          rollTimer = undefined
          rolling.value = false
          oldValue.value = next
        }, ROLL_MS)
      },
    )
    return () => {
      const charStyle = {
        height: COUNTER_LINE,
        lineHeight: COUNTER_LINE,
        fontSize: 12,
        fontWeight: 500,
        color: theme.tokens.value.ink3,
        flexShrink: 0,
      } as const
      return (
        <div style={{ display: "flex", alignItems: "center", height: COUNTER_LINE }}>
          {counterSegments(props.value, oldValue.value, rolling.value).map((segment, i) => {
            if (segment.kind === "run") {
              return (
                <div key={`run-${i}-${segment.text}`} style={charStyle}>
                  {segment.text}
                </div>
              )
            }
            const up = direction.value === "up"
            const topChar = up ? segment.from : segment.to
            const bottomChar = up ? segment.to : segment.from
            return (
              <div
                key={`cell-${segment.index}-${segment.from}-${segment.to}-${direction.value}`}
                style={{ height: COUNTER_LINE, overflow: "hidden", flexShrink: 0 }}
              >
                <div
                  motion={{
                    initial: { top: up ? 0 : -COUNTER_LINE },
                    animate: { top: up ? -COUNTER_LINE : 0 },
                    transition: ROLL_TRANSITION,
                  }}
                  style={{ position: "relative", display: "flex", flexDirection: "column" }}
                >
                  <div style={charStyle}>{topChar === "" ? null : topChar}</div>
                  <div style={charStyle}>{bottomChar === "" ? null : bottomChar}</div>
                </div>
              </div>
            )
          })}
        </div>
      )
    }
  },
})

/* ── One question in the sliding track ───────────────────
 * Renders the question + options + custom-answer row and reports its own
 * painted height to the parent, which derives the viewport height and the
 * track offset. */

const QuestionSlide = defineComponent({
  name: "BuiApprovalQuestionSlide",
  props: {
    index: { type: Number, required: true },
    question: { type: Object as PropType<ApprovalQuestion>, required: true },
    active: { type: Boolean, default: false },
    picked: { type: Array as PropType<number[]>, default: () => EMPTY_PICKED },
    custom: { type: String, default: "" },
    customPlaceholder: { type: String, required: true },
    onToggle: { type: Function as PropType<(optionIndex: number) => void>, required: true },
    onCustomChange: { type: Function as PropType<(value: string) => void>, required: true },
    onCustomSubmit: { type: Function as PropType<() => void>, required: true },
    onMeasured: { type: Function as PropType<(index: number, height: number) => void>, required: true },
  },
  setup(props) {
    const theme = useTheme()
    const { renderer } = useGpuix()
    const root = ref<HostNode | null>(null)
    const inputNode = ref<HostNode | null>(null)
    const { bounds } = useElementBounds(root)
    watch(
      () => bounds.value?.height ?? null,
      (height) => {
        if (height !== null && height > 0) props.onMeasured(props.index, height)
      },
      { immediate: true },
    )

    const focusInput = () => {
      const id = inputNode.value?.id
      if (id != null) renderer?.focusElement?.(id)
    }

    return () => {
      const t = theme.tokens.value
      const question = props.question
      return (
        <div
          ref={root}
          motion={{
            initial: false,
            animate: { opacity: props.active ? 1 : 0 },
            transition: SLIDE_TRANSITION,
          }}
          style={props.active ? {} : { pointerEvents: "none" as const }}
        >
          <div style={{ paddingRight: 28, fontSize: 14, fontWeight: 500, color: t.ink }}>{question.q}</div>
          <GlideMenuRoot style={{ marginTop: 10, gap: 4 }}>
            {question.options.map((option, i) => {
              const on = props.picked.includes(i)
              return (
                <GlideMenuItem key={option}>
                  <div
                    role="button"
                    onClick={() => {
                      if (props.active) props.onToggle(i)
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      borderRadius: radius.control,
                      paddingLeft: 4,
                      paddingRight: 8,
                      paddingTop: 4,
                      paddingBottom: 4,
                      cursor: "pointer",
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
                        borderRadius: question.type === "radio" ? 8 : 5,
                        ...(on
                          ? { backgroundColor: t.ink }
                          : { borderWidth: 1.5, borderColor: t.lineStrong }),
                      }}
                    >
                      {question.type === "radio" ? (
                        on ? (
                          <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.canvas }} />
                        ) : null
                      ) : on ? (
                        <Icon name="checkBold" size={12} color={t.canvas} />
                      ) : null}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 13, color: on ? t.ink : t.ink2 }}>{option}</div>
                  </div>
                </GlideMenuItem>
              )
            })}
            {/* custom answer — the original's <label data-menu-row> row */}
            <GlideMenuItem>
              <div
                onClick={() => {
                  if (props.active) focusInput()
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  borderRadius: radius.control,
                  paddingLeft: 10,
                  paddingRight: 8,
                  paddingTop: 4,
                  paddingBottom: 4,
                  cursor: "text",
                }}
              >
                <input
                  ref={inputNode}
                  value={props.custom}
                  placeholder={props.customPlaceholder}
                  aria-label="Custom answer"
                  onChange={(event: EventPayload) => {
                    if (props.active) props.onCustomChange(event.value ?? "")
                  }}
                  onSubmit={() => {
                    if (props.active) props.onCustomSubmit()
                  }}
                  style={{ minWidth: 0, flexGrow: 1, height: 20, fontSize: 13, color: t.ink }}
                />
              </div>
            </GlideMenuItem>
          </GlideMenuRoot>
        </div>
      )
    }
  },
})

/* ── The card ──────────────────────────────────────────── */

export const ApprovalCard = defineComponent({
  name: "BuiApprovalCard",
  props: {
    questions: { type: Array as PropType<ApprovalQuestion[]>, default: () => QUESTIONS },
    labels: { type: Object as PropType<Partial<ApprovalLabels>>, default: undefined },
    onSubmitted: { type: Function as PropType<(answers: Record<number, number[]>) => void>, default: undefined },
    onAnswerChange: { type: Function as PropType<(questionIndex: number, answer: number[]) => void>, default: undefined },
    resettable: { type: Boolean, default: true },
  },
  setup(props) {
    const theme = useTheme()
    const copy = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }))
    const qi = ref(0)
    const answers = ref<Record<number, number[]>>({})
    const custom = ref<Record<number, string>>({})
    const sent = ref(false)
    const open = ref(true)
    /** Measured painted height per question index. */
    const heights = ref<Record<number, number>>({})

    let advanceTimer: ReturnType<typeof setTimeout> | undefined
    const clearAdvance = () => {
      if (advanceTimer !== undefined) {
        clearTimeout(advanceTimer)
        advanceTimer = undefined
      }
    }
    onBeforeUnmount(clearAdvance)

    const last = computed(() => qi.value >= props.questions.length - 1)
    const selected = computed(() => answers.value[qi.value] ?? EMPTY_PICKED)
    const hasAnswer = computed(() => selected.value.length > 0 || Boolean(custom.value[qi.value]?.trim()))
    /** The original's `ready`: the active question has been measured. */
    const ready = computed(() => heights.value[qi.value] !== undefined)
    /** Track offset for the active question: earlier heights + 26px gaps. */
    const trackY = computed(() => {
      let y = 0
      for (let i = 0; i < qi.value; i++) {
        y += (heights.value[i] ?? heights.value[qi.value] ?? 0) + TRACK_GAP
      }
      return y
    })

    const onMeasured = (index: number, height: number) => {
      if (heights.value[index] === height) return
      heights.value = { ...heights.value, [index]: height }
    }

    const goTo = (next: number) => {
      clearAdvance()
      qi.value = Math.min(Math.max(next, 0), props.questions.length - 1)
    }

    const send = () => {
      clearAdvance()
      sent.value = true
      props.onSubmitted?.({ ...answers.value })
    }

    const advance = () => {
      if (last.value) send()
      else goTo(qi.value + 1)
    }

    const toggle = (optionIndex: number) => {
      const question = props.questions[qi.value]
      if (!question) return
      const picked = answers.value[qi.value] ?? EMPTY_PICKED
      const next =
        question.type === "radio"
          ? [optionIndex]
          : picked.includes(optionIndex)
            ? picked.filter((item) => item !== optionIndex)
            : [...picked, optionIndex]
      answers.value = { ...answers.value, [qi.value]: next }
      props.onAnswerChange?.(qi.value, next)
      if (question.type === "radio") {
        custom.value = { ...custom.value, [qi.value]: "" }
        clearAdvance()
        advanceTimer = setTimeout(() => {
          advanceTimer = undefined
          advance()
        }, 480)
      }
    }

    const onCustomChange = (questionIndex: number, value: string) => {
      custom.value = { ...custom.value, [questionIndex]: value }
      if (props.questions[questionIndex]?.type === "radio") {
        answers.value = { ...answers.value, [questionIndex]: EMPTY_PICKED }
      }
    }

    const onCustomSubmit = () => {
      if (hasAnswer.value) advance()
    }

    const reset = () => {
      clearAdvance()
      qi.value = 0
      answers.value = {}
      custom.value = {}
      sent.value = false
      open.value = true
      /* Measured heights are kept: the questions are the same after a reset,
       * so dropping them would blank the viewport for a poll tick and run
       * the 360ms height tween again — the original only clears `measured`
       * on its own remount path and keeps the stack steady here. */
    }

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value

      if (!open.value) {
        return (
          <div
            role="button"
            onClick={() => {
              open.value = true
            }}
            style={{
              alignSelf: "flex-start",
              borderRadius: radius.control,
              backgroundColor: t.surface,
              paddingLeft: 12,
              paddingRight: 12,
              paddingTop: 8,
              paddingBottom: 8,
              fontSize: 12.5,
              fontWeight: 500,
              color: t.ink,
              cursor: "pointer",
              ...shadows.btn,
              hover: { backgroundColor: t.hover },
            }}
          >
            Open approval
          </div>
        )
      }

      if (sent.value) {
        return (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.26, ease: ease.outStrong }}
            style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", maxWidth: 320 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                borderRadius: radius.pill,
                backgroundColor: t.greenTint,
                paddingTop: 4,
                paddingBottom: 4,
                paddingRight: 10,
                paddingLeft: 4,
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
              {copy.value.sentMessage}
            </div>
            {props.resettable ? (
              <div
                role="button"
                onClick={reset}
                style={{ fontSize: 12, fontWeight: 500, color: t.ink3, cursor: "pointer", hover: { color: t.ink } }}
              >
                Start over
              </div>
            ) : null}
          </motion.div>
        )
      }

      const isReady = ready.value
      return (
        <div style={{ width: "100%", maxWidth: 320 }}>
          <motion.div
            initial={{ opacity: 0, top: 8 }}
            animate={{ opacity: 1, top: 0 }}
            transition={{ duration: 0.38, ease: ease.outStrong }}
            style={{
              position: "relative",
              overflow: "hidden",
              borderRadius: radius.card,
              backgroundColor: t.surface,
              ...shadows.card,
            }}
          >
            <div style={{ padding: 12 }}>
              {/* viewport — tweens its height to the active question */}
              <div
                motion={{
                  initial: false,
                  animate: isReady ? { height: heights.value[qi.value] ?? 0 } : {},
                  transition: SLIDE_TRANSITION,
                }}
                style={{ overflow: "hidden" }}
              >
                {/* track — slides so the active question fills the viewport */}
                <div
                  motion={{
                    initial: false,
                    animate: isReady ? { top: -trackY.value } : {},
                    transition: SLIDE_TRANSITION,
                  }}
                  style={{ position: "relative", display: "flex", flexDirection: "column", gap: TRACK_GAP }}
                >
                  {props.questions.map((question, qIdx) =>
                    isReady || qIdx === qi.value ? (
                      <QuestionSlide
                        key={qIdx}
                        index={qIdx}
                        question={question}
                        active={qIdx === qi.value}
                        picked={answers.value[qIdx] ?? EMPTY_PICKED}
                        custom={custom.value[qIdx] ?? ""}
                        customPlaceholder={copy.value.customPlaceholder}
                        onToggle={toggle}
                        onCustomChange={(value: string) => onCustomChange(qIdx, value)}
                        onCustomSubmit={onCustomSubmit}
                        onMeasured={onMeasured}
                      />
                    ) : null,
                  )}
                </div>
              </div>
            </div>

            {/* footer — step nav (rolling counter) + pill actions */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div
                  role="button"
                  aria-label="Previous question"
                  aria-disabled={qi.value <= 0 || undefined}
                  onClick={qi.value <= 0 ? undefined : () => goTo(qi.value - 1)}
                  style={{
                    display: "flex",
                    width: 18,
                    height: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 5,
                    cursor: qi.value <= 0 ? "default" : "pointer",
                    opacity: qi.value <= 0 ? 0.3 : 1,
                  }}
                >
                  <Icon name="chevronUp" size={14} color={t.ink3} />
                </div>
                <RollingDigits value={`${qi.value + 1} / ${props.questions.length}`} />
                <div
                  role="button"
                  aria-label="Next question"
                  aria-disabled={last.value || undefined}
                  onClick={last.value ? undefined : () => goTo(qi.value + 1)}
                  style={{
                    display: "flex",
                    width: 18,
                    height: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 5,
                    cursor: last.value ? "default" : "pointer",
                    opacity: last.value ? 0.3 : 1,
                  }}
                >
                  <Icon name="chevronDown" size={14} color={t.ink3} />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: -2 }}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (last.value) open.value = false
                    else goTo(qi.value + 1)
                  }}
                >
                  {copy.value.skip}
                </Button>
                <Button variant="accent" size="sm" disabled={!hasAnswer.value} onClick={advance}>
                  {last.value ? copy.value.send : copy.value.continue}
                </Button>
              </div>
            </div>

            {/* dismiss — declared last so it paints above the card content
             *  (the original's `z-10`). */}
            <div
              role="button"
              aria-label="Dismiss"
              onClick={() => {
                open.value = false
              }}
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                display: "flex",
                width: 28,
                height: 28,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.control,
                cursor: "pointer",
                hover: { backgroundColor: t.hover },
              }}
            >
              <Icon name="x" size={14} color={t.ink3} />
            </div>
          </motion.div>
        </div>
      )
    }
  },
})
