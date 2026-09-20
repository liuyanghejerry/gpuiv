/** CHAT COMPOSER — interactive chat panel with tabs, a scripted agent reply
 *  sequence, and a composer.
 *
 *  Ported from beautiful-ui `components/primitives/ChatComposer.tsx`.
 *  The scripted stage machine is kept: sending moves `phase` through
 *  "sent" → "reply1" → "reply2" → "done" on setTimeout (500 / 1400 / 1200 ms),
 *  driven by a `watch` that clears the pending timer on every phase change
 *  and in `onBeforeUnmount`.
 *
 *  Platform degradations from the web original:
 *  - The `resolving` state (opacity 0.55 + blur(0.5px) + scale(0.985)) keeps
 *    only the opacity — GPUIV has no filter/transform. It animates through
 *    `motion.div`'s `animate`, so the 400ms ease is preserved.
 *  - Section entrances (`fade-up` keyframes) and the user bubble's
 *    translateY entrance become `motion.div` {opacity, top} with
 *    `position: "relative"`. The bubble entrance plays once on mount (in the
 *    original the transition was dead code — `phase` starts at "done").
 *  - `focus-within` border/shadow on the composer box: focus is tracked via
 *    the textarea's onFocus/onBlur into a ref, swapping `borderColor` and the
 *    `boxShadow` alpha.
 *  - The HTML `<input>` becomes a native `<textarea>` (minRows/maxRows),
 *    driven by `:value` + `onChange` — v-model is not supported. Enter
 *    submits via `onSubmit` (the original's onKeyDown Enter branch).
 *  - Placeholder colour: GPUIV's text editor paints placeholders in a fixed
 *    neutral grey, not the theme's ink3. The caret is themed through the
 *    textarea's `theme` prop (only `caret` is read by the native input).
 *  - All CSS colour/shadow transitions (duration-100/150/200) are dropped —
 *    GPUIV styles have no transitions, so hover/active states swap instantly.
 *    The send button's press scale(0.96) degrades to an opacity dip, and the
 *    header action glyphs keep a fixed ink3 on hover (an svg's tint is
 *    per-element and does not inherit the button's hover colour).
 */

import { computed, defineComponent, onBeforeUnmount, ref, watch, type PropType } from "vue"
import { motion, useGpuix, type EventPayload, type HostNode } from "@gpuiv/vue"
import { ease, radius } from "../tokens.js"
import { useTheme } from "../theme.js"
import { Icon } from "../atoms/Icon.js"
import type { IconName } from "../icons.js"

/** one scripted agent reply in the thread */
export interface ChatMessage {
  label: string
  sub: string
  time: string
  body: string
}

const DEFAULT_MESSAGES: ChatMessage[] = [
  {
    label: "Sales History",
    sub: "Flavor Data",
    time: "4s",
    body: "Pulled 3 summers of mint chip sales for comparison.",
  },
  {
    label: "Comparison",
    sub: "Trend Detection",
    time: "2s",
    body: "Mint chip is up 12% with stronger weekend peaks.",
  },
]

const DEFAULT_SUGGESTIONS = ["Flavors", "Suppliers"]

export interface ChatComposerLabels {
  /** the pre-filled prompt shown in the first user bubble */
  initialPrompt: string
  /** composer input placeholder */
  placeholder: string
}

const DEFAULT_LABELS: ChatComposerLabels = {
  initialPrompt: "Compare mint chip to last summer",
  placeholder: "Prompt or tag a flavor with @",
}

type Phase = "idle" | "sent" | "reply1" | "reply2" | "done"

const HEADER_ACTIONS: { icon: IconName }[] = [{ icon: "plus" }, { icon: "history" }, { icon: "ellipsis" }]

export const ChatComposer = defineComponent({
  name: "BuiChatComposer",
  props: {
    /** scripted agent replies revealed in sequence after the user sends */
    messages: { type: Array as PropType<ChatMessage[]>, default: () => DEFAULT_MESSAGES },
    /** header chips (tabs) for switching context */
    suggestions: { type: Array as PropType<string[]>, default: () => DEFAULT_SUGGESTIONS },
    /** prominent copy strings */
    labels: { type: Object as PropType<Partial<ChatComposerLabels>>, default: undefined },
    /** fired with the trimmed prompt text when the user sends */
    onSend: { type: Function as PropType<(text: string) => void>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    const { renderer } = useGpuix()
    const copy = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }))

    const phase = ref<Phase>("done")
    const draft = ref("")
    const submitted = ref(copy.value.initialPrompt)
    const tab = ref(props.suggestions[0] ?? "")
    const focused = ref(false)
    const composerRef = ref<HostNode | null>(null)

    // The scripted stage machine, ported 1:1 from the React useEffect: each
    // phase arms the timeout for the next one, and a phase change (or
    // unmount) clears the pending timer.
    let stageTimer: ReturnType<typeof setTimeout> | undefined
    const clearStageTimer = () => {
      if (stageTimer !== undefined) {
        clearTimeout(stageTimer)
        stageTimer = undefined
      }
    }
    watch(phase, (next) => {
      clearStageTimer()
      if (next === "sent") stageTimer = setTimeout(() => (phase.value = "reply1"), 500)
      else if (next === "reply1") stageTimer = setTimeout(() => (phase.value = "reply2"), 1400)
      else if (next === "reply2") stageTimer = setTimeout(() => (phase.value = "done"), 1200)
    })
    onBeforeUnmount(clearStageTimer)

    const canSend = computed(() => draft.value.trim().length > 0)
    const send = () => {
      if (!canSend.value) return
      const text = draft.value.trim()
      submitted.value = text
      props.onSend?.(text)
      draft.value = ""
      phase.value = "sent"
    }
    const focusComposer = () => {
      const id = composerRef.value?.id
      if (id != null) renderer?.focusElement?.(id)
    }

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const showFirst = phase.value === "reply1" || phase.value === "reply2" || phase.value === "done"
      const showSecond = phase.value === "reply2" || phase.value === "done"

      const section = (message: ChatMessage, resolving: boolean) => (
        <motion.div
          initial={{ opacity: 0, top: 8 }}
          animate={{ opacity: resolving ? 0.55 : 1, top: 0 }}
          transition={{ duration: 0.4, ease: ease.outStrong }}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ fontSize: 12, lineHeight: 15.6, fontWeight: 500, color: t.ink }}>{message.label}</div>
            <div style={{ fontSize: 12, lineHeight: 15.6, color: t.ink2 }}>{message.sub}</div>
            <div style={{ fontSize: 12, lineHeight: 15.6, color: t.ink }}>{`for ${message.time}`}</div>
          </div>
          <div style={{ fontSize: 13, lineHeight: 19.5, color: t.ink }}>{message.body}</div>
        </motion.div>
      )

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: 288,
            width: "100%",
            maxWidth: 380,
            alignSelf: "flex-start",
            overflow: "hidden",
            borderRadius: radius.window,
            backgroundColor: t.surface,
            ...shadows.card,
          }}
        >
          {/* header — tabs + actions */}
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "space-between",
              borderBottomWidth: 1,
              borderColor: t.line,
              padding: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              {props.suggestions.map((item) => {
                const selected = tab.value === item
                return (
                  <div
                    key={item}
                    role="button"
                    aria-selected={selected}
                    style={{
                      borderRadius: radius.chip,
                      paddingLeft: 8,
                      paddingRight: 8,
                      paddingTop: 3,
                      paddingBottom: 3,
                      fontSize: 13,
                      color: t.ink,
                      cursor: "pointer",
                      backgroundColor: selected ? t.field : "#00000000",
                      opacity: selected ? 1 : 0.5,
                      hover: selected ? undefined : { opacity: 0.75 },
                    }}
                    onClick={() => (tab.value = item)}
                  >
                    {item}
                  </div>
                )
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {HEADER_ACTIONS.map((action) => (
                <div
                  key={action.icon}
                  role="button"
                  aria-label="Action"
                  style={{
                    display: "flex",
                    width: 24,
                    height: 24,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.chip,
                    cursor: "pointer",
                    hover: { backgroundColor: t.hover },
                  }}
                >
                  <Icon name={action.icon} size={15} color={t.ink3} />
                </div>
              ))}
            </div>
          </div>

          {/* conversation — fixed region so the card never changes shape */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flexGrow: 1,
              minHeight: 0,
              gap: 10,
              overflowY: "scroll",
              paddingLeft: 12,
              paddingRight: 12,
              paddingTop: 10,
              paddingBottom: 4,
            }}
          >
            {/* user bubble — right aligned, soft block */}
            <div style={{ display: "flex", justifyContent: "flex-end", paddingLeft: 56 }}>
              <motion.div
                initial={{ opacity: 0, top: 10 }}
                animate={{ opacity: 1, top: 0 }}
                transition={{ duration: 0.3, ease: ease.outStrong }}
                style={{
                  position: "relative",
                  borderRadius: 12,
                  backgroundColor: t.field,
                  paddingLeft: 12,
                  paddingRight: 12,
                  paddingTop: 6,
                  paddingBottom: 6,
                  fontSize: 13,
                  lineHeight: 18,
                  color: t.ink,
                }}
              >
                {submitted.value}
              </motion.div>
            </div>

            {props.messages[0] && showFirst ? section(props.messages[0], false) : null}
            {props.messages[1] && showSecond ? section(props.messages[1], phase.value === "reply2") : null}
          </div>

          {/* composer */}
          <div style={{ flexShrink: 0, padding: 6 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                borderRadius: radius.control,
                borderWidth: 1,
                borderColor: focused.value ? t.lineStrong : t.line,
                backgroundColor: t.field,
                padding: 10,
                cursor: "text",
                boxShadow: {
                  offsetX: 0,
                  offsetY: 1,
                  blurRadius: 2,
                  spreadRadius: 0,
                  color: focused.value ? "rgba(0, 0, 0, 0.025)" : "rgba(0, 0, 0, 0.035)",
                },
              }}
              onClick={focusComposer}
            >
              <textarea
                ref={composerRef}
                value={draft.value}
                placeholder={copy.value.placeholder}
                minRows={1}
                maxRows={3}
                theme={{ caret: t.ink }}
                aria-label="Chat prompt"
                style={{
                  width: "100%",
                  minWidth: 0,
                  fontSize: 13,
                  lineHeight: 18,
                  color: t.ink,
                  backgroundColor: "#00000000",
                  borderWidth: 0,
                }}
                onChange={(event: EventPayload) => (draft.value = event.value ?? "")}
                onSubmit={send}
                onFocus={() => (focused.value = true)}
                onBlur={() => (focused.value = false)}
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                <div
                  role="button"
                  aria-label="Send"
                  style={{
                    display: "flex",
                    width: 28,
                    height: 28,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 8,
                    cursor: canSend.value ? "pointer" : undefined,
                    backgroundColor: canSend.value ? t.ink : t.lineStrong,
                    active: canSend.value ? { opacity: 0.88 } : undefined,
                  }}
                  onClick={send}
                >
                  <Icon name="arrowUp" size={16} color={canSend.value ? t.surface : t.ink2} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    }
  },
})
