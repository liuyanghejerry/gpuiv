/** PROMPT BAR — a composer with real controls: attach, @ data sources,
 *  / commands, a model picker, dictation, and send. Type @ or / to open the
 *  menus; ↑↓ + Enter to pick. Selecting the flagship model fires a one-shot
 *  sweep across the composer; the built-in demo walks both menus and repeats
 *  until the first user interaction.
 *
 *  Ported from beautiful-ui `components/primitives/PromptBar.tsx`.
 *
 *  Platform degradations and deliberate differences from the web original:
 *
 *  - The `glimm` WebGL rainbow sweep is cut entirely (issue #110): selecting
 *    the flagship model plays a one-shot accent-tinted band — a
 *    linear-gradient `motion.div` whose `left` tweens across the measured
 *    composer width (one 0.72s outStrong pass), then
 *    unmounts. No swell/wave; `prefers-reduced-motion` is not readable.
 *  - Both menus move from CSS absolutes above the composer to raw
 *    `<anchored deferred side="top">` layers (the repo's overlay rule): the
 *    @ menu is the composer's measured width with `align: "start"`; the model
 *    menu keeps its 176px but `align: "end"` pins the right edge instead of
 *    the original's left-edge-plus-clamp arithmetic. The two menus are
 *    mutually exclusive — an anchored layer resolves against its preceding
 *    sibling, so both open at once cannot keep independent anchors (typing a
 *    token closes the model menu).
 *  - Menu entrances: `pop-in` (opacity + scale from a transform origin)
 *    becomes an opacity + height `motion` reveal (FineTuneCard's menu
 *    pattern). The gliding row highlights drop their measured
 *    `offsetTop`/`offsetHeight` for fixed row-height arithmetic (36px source
 *    rows, 30px model rows) driving `top`/`height` tweens; the highlight's
 *    150ms opacity fade shares the 220ms glide curve.
 *  - The controls' CSS grid (`28px 1fr auto 28px 28px`) becomes flex rows:
 *    inline is one `items-end` row, wide (wrapped text or `tall`) is a
 *    textarea row over a `space-between` controls row. Wrap detection keeps
 *    the hidden measure span, but its width arrives via `useElementBounds`
 *    polling (≤100ms after the keystroke) instead of a synchronous
 *    `offsetWidth`; the newline check stays synchronous. The textarea's
 *    scrollHeight auto-grow (28–100px) is the native `minRows`/`maxRows`
 *    clamp (1–5 rows at lineHeight 18).
 *  - The dictation equalizer's infinite `eq-bounce` (scaleY) becomes a JS
 *    interval flipping per-bar heights (5↔14px) through staggered `motion`
 *    height tweens — no infinite repeats and no transforms in GPUIV.
 *  - Multicolour brand marks (Figma/Slack/Gmail) are redrawn as monochrome
 *    stroke glyphs in `icons.ts` — GPUIV's `<svg>` renders an alpha mask
 *    tinted from one colour, so per-path fills cannot survive.
 *  - `focus-within:border-line-strong` is an onFocus/onBlur border swap (no
 *    colour tweens); `active:scale` press feedback and the Connect row's
 *    hover underline are dropped (no transform / text-decoration), and icon
 *    glyphs keep `ink3` on hover — an `<svg>` tints only from its own colour
 *    (same constraint as ApprovalCard).
 *  - Keyboard: Enter picks the highlighted row or sends via the native
 *    textarea `onSubmit` (Shift+Enter inserts a newline natively); ↑/↓ move
 *    the highlight but also the caret — GPUIV key events have no
 *    `preventDefault`. Outside-close is `onMouseDownOutside` hit-tested
 *    against the composer's measured bounds, so presses inside the bar (the
 *    original's `[data-promptbar]` containment) do not close the menus, and a
 *    trigger press toggles cleanly without a dismiss guard.
 *  - The demo takeover stops on focus/click/keys routed through the bar's own
 *    elements (no capture phase); the leftover demo draft clears on the first
 *    click or keystroke in the input — programmatic focus cannot be told
 *    apart from a click, so `onFocus` alone only stops the loop. `aria-*` and
 *    `tabIndex` are passthroughs (no accessibility tree), and
 *    `overflow-wrap: anywhere` has no native equivalent.
 */

import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from "vue"
import { motion, useElementBounds, useGpuix, type EventPayload, type HostNode } from "@gpuiv/vue"

import { ease, radius } from "../tokens.js"
import { useTheme } from "../theme.js"
import { withAlpha } from "../colors.js"
import { Icon } from "../atoms/Icon.js"
import { icons, type IconName } from "../icons.js"

export type PromptBarBrand = "figma" | "slack" | "gmail"

export interface PromptBarSource {
  key: string
  name: string
  desc: string
  glyph?: IconName
  brand?: PromptBarBrand
  attach?: boolean
  connect?: boolean
}

export interface PromptBarCommand {
  key: string
  name: string
  desc: string
}

export interface PromptBarModel {
  key: string
  name: string
  tag: string
}

const SOURCES: PromptBarSource[] = [
  { key: "attach", name: "Add photos & files", desc: "Upload from your computer", glyph: "paperclip", attach: true },
  { key: "scoop", name: "Scoop Data", desc: "Sales & churn metrics", glyph: "chart" },
  { key: "flavors", name: "Flavor records", desc: "26 makers, tags, links", glyph: "layers" },
  { key: "web", name: "Web search", desc: "Real-time news and info", glyph: "globe" },
  { key: "figma", name: "Figma", desc: "Design-to-code workflows", brand: "figma" },
  { key: "slack", name: "Slack", desc: "Read and manage Slack", brand: "slack" },
  { key: "gmail", name: "Gmail", desc: "Read and manage Gmail", brand: "gmail", connect: true },
]

const COMMANDS: PromptBarCommand[] = [
  { key: "compare", name: "/compare", desc: "Flavor vs. last summer" },
  { key: "churn-plan", name: "/churn-plan", desc: "Draft a churn schedule" },
  { key: "restock", name: "/restock", desc: "Build a reorder list" },
  { key: "draft-email", name: "/draft-email", desc: "Write a supplier email" },
  { key: "summarize", name: "/summarize", desc: "Digest the thread so far" },
]

const MODELS: PromptBarModel[] = [
  { key: "sprinkles-5", name: "Sprinkles 5", tag: "Flagship" },
  { key: "vanilla-1", name: "Vanilla 1", tag: "Basic" },
  { key: "freezer-burn", name: "Freezer Burn 0.4", tag: "Stale" },
]

const FILES = ["flavor-chart.png", "summer-menu.pdf", "pos-export.csv"]
const DICTATION = "Compare pistachio weekends to last summer"

/* Self-running demo: walk the @ menu, then the / menu, then upgrade the model
 * → sweep, and repeat. Any user interaction hands control over. */
const AUTO_STEPS: {
  draft: string
  active?: number
  connect?: boolean
  modelOpen?: boolean
  model?: string
  hold: number
}[] = [
  { draft: "", connect: false, model: "vanilla-1", hold: 1100 },
  { draft: "@", active: 0, hold: 900 },
  { draft: "@", active: 1, hold: 620 },
  { draft: "@", active: 4, hold: 620 },
  { draft: "@", active: 6, hold: 700 },
  { draft: "@", active: 6, connect: true, hold: 1000 },
  { draft: "", hold: 700 },
  { draft: "/", active: 0, hold: 900 },
  { draft: "/", active: 1, hold: 620 },
  { draft: "/", active: 3, hold: 1000 },
  { draft: "", hold: 800 },
  { draft: "", modelOpen: true, hold: 1200 },
  { draft: "", model: "sprinkles-5", hold: 2400 },
  { draft: "", hold: 900 },
]

/** Source-row height (the original's h-9) — drives the glide arithmetic. */
const MENU_ROW_HEIGHT = 36
/** Model-row height (the original's h-7.5). */
const MODEL_ROW_HEIGHT = 30
/** The @ menu's hint footer: 4 margin + 1 border + 6 + ~15 text + 4 padding. */
const MENU_FOOTER_HEIGHT = 30
/** The glide highlight — 220ms cubic-bezier(0.23,1,0.32,1). */
const GLIDE_TRANSITION = { duration: 0.22, ease: ease.outStrong }
/** Menu reveal — the original's 180ms pop-in curve, opacity+height. */
const MENU_REVEAL = { duration: 0.18, ease: ease.outStrong }
/** Dictation transcript delay, and the eq-bounce flip cadence. */
const DICTATION_MS = 2200
const EQ_STEP_MS = 450
/** The sweep band and its single outStrong pass across the composer. */
const SWEEP_BAND_WIDTH = 72
const SWEEP_MS = 720

const BRAND_SIZE: Record<PromptBarBrand, { width: number; height: number }> = {
  figma: { width: 11, height: 16 },
  slack: { width: 15, height: 15 },
  gmail: { width: 15, height: 12 },
}

/** The last @word or /word being typed, if any. */
function parseToken(draft: string): { kind: "at" | "slash"; query: string; start: number } | null {
  const match = /(^|\s)([@/])([\w-]*)$/.exec(draft)
  if (!match) return null
  return {
    kind: match[2] === "@" ? "at" : "slash",
    query: match[3].toLowerCase(),
    start: match.index + match[1].length,
  }
}

export const PromptBar = defineComponent({
  name: "BuiPromptBar",
  props: {
    /** Card radius (Rounded) or full radius (Pill). */
    variant: { type: String as PropType<"Rounded" | "Pill">, default: "Rounded" },
    /** Run the self-running walkthrough; turn off when embedding in a real surface. */
    demo: { type: Boolean, default: true },
    /** Hero sizing: a multi-line input with controls on their own row. */
    tall: { type: Boolean, default: false },
    placeholder: { type: String, default: undefined },
    onSend: { type: Function as PropType<(text: string) => void>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    const { renderer } = useGpuix()

    const pill = computed(() => props.variant === "Pill")
    const draft = ref("")
    const dismissed = ref(false)
    const plusOpen = ref(false)
    const modelOpen = ref(false)
    const model = ref<PromptBarModel>(MODELS[1])
    const attachments = ref<string[]>([])
    const connected = ref(false)
    const active = ref(0)
    const listening = ref(false)
    const auto = ref(props.demo)
    const autoStep = ref(0)
    const expanded = ref(false)
    const engaged = ref(false)
    const modelHovered = ref<number | null>(null)
    const sweeping = ref(false)
    const sweepSeq = ref(0)
    const inputFocused = ref(false)
    const eqPhase = ref(false)

    const inputNode = ref<HostNode | null>(null)
    /* The wrapper around the composer is the menus' anchor and the measuring
     * box for the @ menu width, the sweep run, and the wrap threshold. */
    const anchorRef = ref<HostNode | null>(null)
    const modelBtnRef = ref<HostNode | null>(null)
    const measureRef = ref<HostNode | null>(null)
    const anchor = useElementBounds(anchorRef)
    const modelBtn = useElementBounds(modelBtnRef)
    const measure = useElementBounds(measureRef)

    let autoTimer: ReturnType<typeof setTimeout> | undefined
    let dictationTimer: ReturnType<typeof setTimeout> | undefined
    let eqTimer: ReturnType<typeof setInterval> | undefined
    let sweepTimer: ReturnType<typeof setTimeout> | undefined
    let focusTimer: ReturnType<typeof setTimeout> | undefined

    const stopAuto = () => {
      auto.value = false
      if (autoTimer !== undefined) {
        clearTimeout(autoTimer)
        autoTimer = undefined
      }
    }
    onBeforeUnmount(() => {
      stopAuto()
      if (dictationTimer !== undefined) clearTimeout(dictationTimer)
      if (eqTimer !== undefined) clearInterval(eqTimer)
      if (sweepTimer !== undefined) clearTimeout(sweepTimer)
      if (focusTimer !== undefined) clearTimeout(focusTimer)
    })

    const focusInput = () => {
      if (focusTimer !== undefined) clearTimeout(focusTimer)
      focusTimer = setTimeout(() => {
        focusTimer = undefined
        const id = inputNode.value?.id
        if (id != null) renderer?.focusElement?.(id)
      }, 0)
    }

    const token = computed(() => (dismissed.value ? null : parseToken(draft.value)))
    const menu = computed<"at" | "slash" | null>(() => (plusOpen.value ? "at" : token.value?.kind ?? null))
    const query = computed(() => (plusOpen.value ? "" : token.value?.query ?? ""))
    const rows = computed<{ key: string; name: string; desc: string }[]>(() =>
      menu.value === "at"
        ? SOURCES.filter((s) => s.name.toLowerCase().includes(query.value))
        : menu.value === "slash"
          ? COMMANDS.filter((c) => c.name.slice(1).startsWith(query.value))
          : [],
    )

    watch([menu, query], () => {
      active.value = 0
      engaged.value = false
    })
    watch(menu, (open) => {
      if (open != null) modelOpen.value = false
    })
    watch(modelOpen, (open) => {
      if (!open) modelHovered.value = null
    })

    /* Wrap detection: the original reads the hidden span's offsetWidth
     * synchronously; here it arrives through the bounds poll (≤100ms). */
    /* Width-only view of the composer bounds: a scroll translates x/y but
     * not width, so re-renders (and the canvas-free layout math) stay still
     * while the page scrolls. */
    const composerWidth = computed(() => anchor.bounds.value?.width ?? null)
    const modelWidth = computed(() => modelBtn.bounds.value?.width ?? null)
    const inlineInputWidth = computed(() => {
      const composerW = composerWidth.value
      const modelW = modelWidth.value
      if (composerW == null || modelW == null || composerW <= 0 || modelW <= 0) return null
      // 2×1px border + 2×6px padding; the original's fixed controls (28×3 +
      // model button) and four 4px gaps.
      return composerW - 14 - (28 * 3 + modelW + 16)
    })
    watch([() => measure.bounds.value, inlineInputWidth, draft], () => {
      const textW = measure.bounds.value?.width
      const inputW = inlineInputWidth.value
      const needs = draft.value.includes("\n") || (textW != null && inputW != null && textW + 8 > inputW)
      if (needs !== expanded.value) expanded.value = needs
    })

    const celebrate = () => {
      if (sweeping.value) return
      sweeping.value = true
      sweepSeq.value += 1
      if (sweepTimer !== undefined) clearTimeout(sweepTimer)
      sweepTimer = setTimeout(() => {
        sweepTimer = undefined
        sweeping.value = false
      }, SWEEP_MS)
    }

    const selectModel = (next: PromptBarModel) => {
      model.value = next
      modelOpen.value = false
      if (next.key === "sprinkles-5") celebrate()
    }

    /* Autoplay: apply the current step, then advance after its hold. */
    const runStep = () => {
      if (!auto.value) return
      const step = AUTO_STEPS[autoStep.value % AUTO_STEPS.length]
      if (!step) return
      draft.value = step.draft
      if (step.active !== undefined) active.value = step.active
      if (step.connect !== undefined) connected.value = step.connect
      if (step.modelOpen !== undefined) modelOpen.value = step.modelOpen
      if (step.model) {
        const next = MODELS.find((m) => m.key === step.model)
        if (next) selectModel(next)
      }
      if (autoTimer !== undefined) clearTimeout(autoTimer)
      autoTimer = setTimeout(() => {
        autoTimer = undefined
        autoStep.value += 1
        runStep()
      }, step.hold)
    }
    onMounted(() => {
      if (auto.value) runStep()
    })

    /* Dictation resolves after a beat, like a real transcript landing; the
     * equalizer bars flip on the same timers (no infinite CSS animation). */
    watch(listening, (on) => {
      if (dictationTimer !== undefined) {
        clearTimeout(dictationTimer)
        dictationTimer = undefined
      }
      if (eqTimer !== undefined) {
        clearInterval(eqTimer)
        eqTimer = undefined
      }
      if (!on) return
      eqTimer = setInterval(() => {
        eqPhase.value = !eqPhase.value
      }, EQ_STEP_MS)
      dictationTimer = setTimeout(() => {
        dictationTimer = undefined
        if (eqTimer !== undefined) {
          clearInterval(eqTimer)
          eqTimer = undefined
        }
        draft.value = draft.value ? `${draft.value.trimEnd()} ${DICTATION}` : DICTATION
        listening.value = false
        focusInput()
      }, DICTATION_MS)
    })

    const closeMenus = () => {
      plusOpen.value = false
      modelOpen.value = false
    }

    /* Outside-close: a press inside the composer keeps the menus open (the
     * original's [data-promptbar] containment) — the polled bounds are the
     * hit-test box, so a trigger press falls through to its own toggle. */
    const onMenuMouseDownOutside = (event: EventPayload) => {
      const box = anchor.bounds.value
      const x = event.x ?? 0
      const y = event.y ?? 0
      if (box && x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) return
      closeMenus()
    }

    const pick = (row: { key: string; name: string }) => {
      stopAuto()
      const source = SOURCES.find((s) => s.key === row.key)
      const tk = token.value
      if (source?.attach) {
        attachments.value = [...attachments.value, FILES[attachments.value.length % FILES.length]]
        if (tk) draft.value = draft.value.slice(0, tk.start)
      } else if (menu.value === "at") {
        draft.value = `${tk ? draft.value.slice(0, tk.start) : draft.value}@${row.name} `
      } else {
        draft.value = `${tk ? draft.value.slice(0, tk.start) : draft.value}${row.name} `
      }
      plusOpen.value = false
      dismissed.value = false
      focusInput()
    }

    const canSend = computed(() => draft.value.trim().length > 0 || attachments.value.length > 0)
    const send = () => {
      if (!canSend.value) return
      props.onSend?.(draft.value.trim())
      draft.value = ""
      attachments.value = []
      closeMenus()
    }

    const onTextareaKeyDown = (event: EventPayload) => {
      if (auto.value) {
        stopAuto()
        draft.value = ""
      }
      const key = event.key
      if (menu.value && rows.value.length > 0) {
        if (key === "down" || key === "up") {
          engaged.value = true
          active.value = (active.value + (key === "down" ? 1 : rows.value.length - 1)) % rows.value.length
          return
        }
        if (key === "tab") {
          const row = rows.value[active.value]
          if (row) pick(row)
          return
        }
      }
      if (key === "escape") {
        dismissed.value = true
        closeMenus()
      }
    }

    /* Enter arrives as the native submit (Shift+Enter inserts a newline in
     * the editor itself), so menu pick and send both route through here. */
    const onTextareaSubmit = () => {
      stopAuto()
      if (menu.value && rows.value.length > 0) {
        const row = rows.value[active.value]
        if (row) pick(row)
        return
      }
      send()
    }

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const isPill = pill.value
      const wide = expanded.value || props.tall
      const composerW = composerWidth.value
      const m = menu.value
      const menuRows = rows.value
      const modelIndex = MODELS.findIndex((mo) => mo.key === model.value.key)
      const composerRadius = isPill
        ? attachments.value.length > 0 || wide
          ? 24
          : radius.pill
        : props.tall
          ? 22
          : 14
      const controlRadius = isPill ? radius.pill : radius.control

      const textarea = (
        <textarea
          ref={inputNode}
          testId="promptbar-input"
          value={draft.value}
          placeholder={listening.value ? "Listening…" : props.placeholder ?? "Write a message…"}
          aria-label="Prompt"
          minRows={props.tall ? 3 : 1}
          maxRows={5}
          onChange={(event: EventPayload) => {
            stopAuto()
            draft.value = event.value ?? ""
            dismissed.value = false
            plusOpen.value = false
          }}
          onKeyDown={onTextareaKeyDown}
          onSubmit={onTextareaSubmit}
          onFocus={() => {
            inputFocused.value = true
            stopAuto()
          }}
          onBlur={() => {
            inputFocused.value = false
          }}
          onClick={() => {
            if (auto.value) {
              stopAuto()
              draft.value = ""
            }
          }}
          style={{
            minWidth: 0,
            ...(wide ? { width: "100%" } : { flexGrow: 1 }),
            ...(props.tall
              ? { minHeight: 68, paddingLeft: 8, paddingRight: 8, fontSize: 14, lineHeight: 20 }
              : { paddingLeft: 4, paddingRight: 4, paddingTop: 5, paddingBottom: 5, fontSize: 13, lineHeight: 18 }),
            color: t.ink,
          }}
        />
      )

      const plusButton = (
        <div
          role="button"
          aria-label="Add attachments and sources"
          aria-expanded={plusOpen.value}
          tabIndex={0}
          testId="promptbar-plus"
          onClick={() => {
            stopAuto()
            modelOpen.value = false
            plusOpen.value = !plusOpen.value
            focusInput()
          }}
          onKeyDown={(event: EventPayload) => {
            if (event.key === "enter" || event.key === "space") {
              stopAuto()
              modelOpen.value = false
              plusOpen.value = !plusOpen.value
            }
          }}
          style={{
            display: "flex",
            width: 28,
            height: 28,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: controlRadius,
            cursor: "pointer",
            ...(plusOpen.value ? { backgroundColor: t.hover } : {}),
            hover: { backgroundColor: t.hover },
          }}
        >
          <Icon name="plus" size={16} color={plusOpen.value ? t.ink : t.ink3} />
        </div>
      )

      const modelButton = (
        <div
          ref={modelBtnRef}
          role="button"
          aria-expanded={modelOpen.value}
          aria-label="Choose model"
          tabIndex={0}
          testId="promptbar-model-trigger"
          onClick={() => {
            stopAuto()
            plusOpen.value = false
            /* Mutual exclusion both ways: an open @/ token menu must close
             * when this one opens (the token menu's anchored layer sits
             * before this one, so both rendered would mis-anchor it). */
            dismissed.value = true
            modelOpen.value = !modelOpen.value
          }}
          onKeyDown={(event: EventPayload) => {
            if (event.key === "enter" || event.key === "space") {
              stopAuto()
              plusOpen.value = false
              dismissed.value = true
              modelOpen.value = !modelOpen.value
            }
          }}
          style={{
            display: "flex",
            height: 28,
            flexShrink: 0,
            alignItems: "center",
            gap: 4,
            paddingLeft: 6,
            paddingRight: 6,
            fontSize: 12,
            fontWeight: 500,
            color: t.ink2,
            borderRadius: controlRadius,
            cursor: "pointer",
            hover: { backgroundColor: t.hover, color: t.ink },
          }}
        >
          <div style={{ minWidth: 0, whiteSpace: "nowrap" }}>{model.value.name}</div>
          <Icon name="chevronDown" size={11} color={t.ink3} />
        </div>
      )

      const eqHeights = eqPhase.value ? [14, 9, 5] : [5, 9, 14]
      const dictationButton = (
        <div
          role="button"
          aria-label={listening.value ? "Stop dictation" : "Start dictation"}
          aria-pressed={listening.value}
          tabIndex={0}
          testId="promptbar-dictation"
          onClick={() => {
            stopAuto()
            listening.value = !listening.value
          }}
          onKeyDown={(event: EventPayload) => {
            if (event.key === "enter" || event.key === "space") {
              stopAuto()
              listening.value = !listening.value
            }
          }}
          style={{
            display: "flex",
            width: 28,
            height: 28,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: controlRadius,
            cursor: "pointer",
            ...(listening.value
              ? { backgroundColor: t.accentTint }
              : { hover: { backgroundColor: t.hover } }),
          }}
        >
          {listening.value ? (
            <div style={{ display: "flex", height: 14, alignItems: "center", gap: 2.5 }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  motion={{
                    initial: false,
                    animate: { height: eqHeights[i] },
                    transition: { duration: EQ_STEP_MS / 1000, ease: "easeInOut", delay: i * 0.12 },
                  }}
                  style={{ width: 2.5, borderRadius: 1.25, backgroundColor: t.accentInk }}
                />
              ))}
            </div>
          ) : (
            <Icon name="mic" size={15} color={t.ink3} />
          )}
        </div>
      )

      const sendButton = (
        <div
          role="button"
          aria-label="Send"
          tabIndex={0}
          testId="promptbar-send"
          onClick={() => {
            stopAuto()
            send()
          }}
          onKeyDown={(event: EventPayload) => {
            if (event.key === "enter" || event.key === "space") {
              stopAuto()
              send()
            }
          }}
          style={{
            display: "flex",
            width: 28,
            height: 28,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: controlRadius,
            backgroundColor: canSend.value ? t.ink : t.lineStrong,
            cursor: canSend.value ? "pointer" : "default",
          }}
        >
          <Icon name="arrowUp" size={16} color={canSend.value ? t.surface : t.ink2} />
        </div>
      )

      const controls = wide ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {textarea}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {plusButton}
            {modelButton}
            <div style={{ flexGrow: 1 }} />
            {dictationButton}
            {sendButton}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
          {plusButton}
          {textarea}
          {modelButton}
          {dictationButton}
          {sendButton}
        </div>
      )

      /* The @ / slash menu — anchored above the composer, composer-wide. */
      const atMenu =
        m != null && composerW != null
          ? h(
              "anchored",
              {
                side: "top",
                align: "start",
                gap: 8,
                offset: { x: 0, y: 0 },
                fit: "snap",
                snapMargin: 8,
                deferred: true,
                priority: 1,
                occlude: true,
                style: {
                  width: composerW,
                  borderRadius: radius.card,
                  backgroundColor: t.surface,
                  ...shadows.raised,
                },
              },
              [
                <div
                  motion={{
                    initial: { opacity: 0, height: Math.max(menuRows.length, 1) * MENU_ROW_HEIGHT },
                    animate: { opacity: 1, height: 4 + Math.max(menuRows.length, 1) * MENU_ROW_HEIGHT + MENU_FOOTER_HEIGHT },
                    transition: MENU_REVEAL,
                  }}
                  style={{ overflow: "hidden" }}
                  onMouseLeave={() => {
                    engaged.value = false
                  }}
                  onMouseDownOutside={onMenuMouseDownOutside}
                >
                  <div style={{ position: "relative", paddingTop: 4, paddingBottom: 4 }}>
                    {/* single gliding highlight — appears once a row is hovered */}
                    <motion.div
                      initial={false}
                      animate={{
                        top: 4 + active.value * MENU_ROW_HEIGHT,
                        height: MENU_ROW_HEIGHT,
                        opacity: engaged.value && menuRows.length > 0 ? 1 : 0,
                      }}
                      transition={GLIDE_TRANSITION}
                      style={{
                        position: "absolute",
                        left: 4,
                        right: 4,
                        borderRadius: radius.chip,
                        backgroundColor: t.hover,
                        pointerEvents: "none",
                      }}
                    />
                    {menuRows.length === 0
                      ? (
                          <div
                            style={{
                              display: "flex",
                              height: MENU_ROW_HEIGHT,
                              alignItems: "center",
                              paddingLeft: 8,
                              fontSize: 12,
                              color: t.ink3,
                            }}
                          >
                            {`No matches for “${query.value}”`}
                          </div>
                        )
                      : null}
                    {menuRows.map((row, i) => {
                      const source = m === "at" ? SOURCES.find((s) => s.key === row.key) : undefined
                      return (
                        <div
                          key={row.key}
                          role="button"
                          tabIndex={-1}
                          testId={`promptbar-menu-row-${row.key}`}
                          onMouseEnter={() => {
                            active.value = i
                            engaged.value = true
                          }}
                          onClick={() => {
                            pick(row)
                          }}
                          style={{
                            position: "relative",
                            display: "flex",
                            height: MENU_ROW_HEIGHT,
                            width: "100%",
                            alignItems: "center",
                            gap: 10,
                            paddingLeft: 8,
                            paddingRight: 8,
                            borderRadius: radius.chip,
                            cursor: "pointer",
                          }}
                        >
                          {source ? (
                            <div
                              style={{
                                display: "flex",
                                width: 22,
                                height: 22,
                                flexShrink: 0,
                                alignItems: "center",
                                justifyContent: "center",
                                color: t.ink2,
                              }}
                            >
                              {source.brand ? (
                                <svg
                                  src={icons[source.brand]}
                                  style={{ ...BRAND_SIZE[source.brand], color: t.ink2 }}
                                />
                              ) : (
                                <Icon name={source.glyph ?? "paperclip"} size={15} color={t.ink2} />
                              )}
                            </div>
                          ) : null}
                          <div style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 500, color: t.ink }}>{row.name}</div>
                          <div
                            style={{
                              minWidth: 0,
                              flexGrow: 1,
                              overflow: "hidden",
                              whiteSpace: "nowrap",
                              textOverflow: "ellipsis",
                              fontSize: 12,
                              color: t.ink3,
                            }}
                          >
                            {row.desc}
                          </div>
                          {source?.connect ? (
                            <div
                              role="button"
                              tabIndex={-1}
                              testId="promptbar-connect"
                              onClick={() => {
                                stopAuto()
                                connected.value = !connected.value
                              }}
                              style={{
                                flexShrink: 0,
                                fontSize: 12,
                                fontWeight: 500,
                                color: connected.value ? t.green : t.accentInk,
                                cursor: "pointer",
                              }}
                            >
                              {connected.value ? "Connected" : "Connect"}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      borderWidth: 1,
                      borderColor: t.line,
                      paddingTop: 6,
                      paddingBottom: 4,
                      paddingLeft: 8,
                      paddingRight: 8,
                      fontSize: 11,
                      color: t.ink3,
                    }}
                  >
                    {m === "at" ? "Type to search sources & files" : "Type to search commands"}
                  </div>
                </div>,
              ],
            )
          : null

      /* The model menu — anchored above the composer, right-aligned. */
      const modelMenu = modelOpen.value
        ? h(
            "anchored",
            {
              side: "top",
              align: "end",
              gap: 8,
              offset: { x: 0, y: 0 },
              fit: "snap",
              snapMargin: 8,
              deferred: true,
              priority: 1,
              occlude: true,
              style: {
                width: 176,
                borderRadius: radius.card,
                backgroundColor: t.surface,
                ...shadows.raised,
              },
            },
            [
              <div
                motion={{
                  initial: { opacity: 0, height: MODELS.length * MODEL_ROW_HEIGHT },
                  animate: { opacity: 1, height: 8 + MODELS.length * MODEL_ROW_HEIGHT },
                  transition: MENU_REVEAL,
                }}
                style={{ overflow: "hidden" }}
                onMouseLeave={() => {
                  modelHovered.value = null
                }}
                onMouseDownOutside={onMenuMouseDownOutside}
              >
                <div style={{ position: "relative", paddingTop: 4, paddingBottom: 4 }}>
                  <motion.div
                    initial={false}
                    animate={{
                      top: 4 + (modelHovered.value ?? modelIndex) * MODEL_ROW_HEIGHT,
                      height: MODEL_ROW_HEIGHT,
                      opacity: modelHovered.value != null ? 1 : 0,
                    }}
                    transition={GLIDE_TRANSITION}
                    style={{
                      position: "absolute",
                      left: 4,
                      right: 4,
                      borderRadius: radius.chip,
                      backgroundColor: t.hover,
                      pointerEvents: "none",
                    }}
                  />
                  {MODELS.map((mo, i) => (
                    <div
                      key={mo.key}
                      role="button"
                      tabIndex={-1}
                      testId={`promptbar-model-option-${mo.key}`}
                      onMouseEnter={() => {
                        modelHovered.value = i
                      }}
                      onClick={() => {
                        stopAuto()
                        selectModel(mo)
                        focusInput()
                      }}
                      style={{
                        position: "relative",
                        display: "flex",
                        height: MODEL_ROW_HEIGHT,
                        width: "100%",
                        alignItems: "center",
                        gap: 8,
                        paddingLeft: 8,
                        paddingRight: 8,
                        borderRadius: radius.chip,
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          minWidth: 0,
                          flexGrow: 1,
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                          fontSize: 12.5,
                          fontWeight: 500,
                          color: t.ink,
                        }}
                      >
                        {mo.name}
                      </div>
                      <div style={{ flexShrink: 0, fontSize: 11, color: t.ink3 }}>{mo.tag}</div>
                      {mo.key === model.value.key ? (
                        <Icon name="check" size={13} color={t.ink} />
                      ) : (
                        <div style={{ width: 13, height: 13, flexShrink: 0 }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>,
            ],
          )
        : null

      return (
        <div
          testId="promptbar-root"
          style={
            props.demo
              ? {
                  display: "flex",
                  width: "100%",
                  maxWidth: 420,
                  minHeight: 384,
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  paddingBottom: 32,
                }
              : { width: "100%" }
          }
        >
          <div ref={anchorRef} style={{ position: "relative", width: "100%" }}>
            {/* composer — the menus grow up from its top edge */}
            <motion.div
              initial={false}
              animate={{ borderRadius: composerRadius }}
              transition={{ duration: 0.15 }}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                backgroundColor: t.surface,
                ...shadows.card,
                borderColor: inputFocused.value ? t.lineStrong : t.line,
                gap: props.tall ? 10 : 6,
                padding: props.tall ? 14 : 6,
              }}
            >
              {/* sweep band — first child so it paints under the content */}
              {sweeping.value && composerW != null ? (
                <motion.div
                  key={`sweep-${sweepSeq.value}`}
                  initial={{ left: -SWEEP_BAND_WIDTH }}
                  animate={{ left: composerW + 2 }}
                  transition={{ duration: SWEEP_MS / 1000, ease: ease.outStrong }}
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    width: SWEEP_BAND_WIDTH,
                    background: {
                      type: "linear-gradient",
                      angle: 90,
                      stops: [
                        { color: withAlpha(t.accent, 0), position: 0 },
                        { color: withAlpha(t.accent, 0.32), position: 1 },
                      ],
                    },
                    pointerEvents: "none",
                  }}
                />
              ) : null}

              {/* hidden measuring span for the wrap detection */}
              <div
                ref={measureRef}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  fontSize: 13,
                  lineHeight: 18,
                  whiteSpace: "nowrap",
                  opacity: 0,
                  pointerEvents: "none",
                  userSelect: "none",
                }}
              >
                {draft.value}
              </div>

              {attachments.value.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    paddingTop: 2,
                    paddingLeft: isPill ? 4 : 2,
                    paddingRight: isPill ? 4 : 2,
                  }}
                >
                  {attachments.value.map((file, i) => (
                    <motion.div
                      key={`${file}-${i}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2, ease: ease.outStrong }}
                      style={{
                        display: "flex",
                        height: 26,
                        alignItems: "center",
                        gap: 6,
                        backgroundColor: t.field,
                        paddingTop: 4,
                        paddingBottom: 4,
                        paddingLeft: 6,
                        paddingRight: 4,
                        fontSize: 11.5,
                        color: t.ink2,
                        borderRadius: isPill ? radius.pill : radius.chip,
                        ...shadows.hairline,
                      }}
                    >
                      <Icon name="file" size={12} color={t.ink2} />
                      <div
                        style={{
                          maxWidth: 144,
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {file}
                      </div>
                      <div
                        role="button"
                        aria-label={`Remove ${file}`}
                        testId={`promptbar-chip-remove-${i}`}
                        onClick={() => {
                          stopAuto()
                          attachments.value = attachments.value.filter((_, j) => j !== i)
                        }}
                        style={{
                          display: "flex",
                          width: 24,
                          height: 24,
                          alignItems: "center",
                          justifyContent: "center",
                          color: t.ink3,
                          borderRadius: isPill ? radius.pill : 5,
                          cursor: "pointer",
                          hover: { backgroundColor: withAlpha(t.line, 0.7) },
                        }}
                      >
                        <Icon name="x" size={10} color={t.ink3} />
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : null}

              {controls}
            </motion.div>

            {/* overlays — declared after the composer so each anchored layer
             * resolves against it (they are mutually exclusive). */}
            {modelMenu}
            {atMenu}
          </div>
        </div>
      )
    }
  },
})
