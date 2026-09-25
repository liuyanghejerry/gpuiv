/** STREAMING TEXT — words stream in one by one, an inline source chip
 *  appears mid-sentence, then the action row and follow-up prompts unlock.
 *
 *  Ported from beautiful-ui `components/primitives/StreamingText.tsx`.
 *
 *  Platform degradations vs the web original:
 *
 *  - The original is a `<p>` of inline `<span>` words with an inline `<a>`
 *    chip and caret. GPUIV has no inline flow, so the paragraph is a
 *    `flexWrap: "wrap"` row (the RecommendationCard segment pattern): one div
 *    per word, the chip and the caret as flex items. Word spacing is
 *    `columnGap: 3.5` (≈ a 13px space advance), not a real space glyph;
 *    wrapping still happens at word boundaries, like the source.
 *  - The chip's `pop-in` keyframe (opacity + scale 0.95→1, 250ms
 *    ease-out-strong) keeps its timing but drops the scale — motion tweens
 *    only opacity/geometry. Same for the caret's 150ms `fade-in`.
 *  - The caret's `translate-y-0.5` and the chip's `translate-y-[-1px]`
 *    baseline nudges become flexbox `alignItems: "center"` — there is no
 *    baseline alignment across flex items.
 *  - The action row and the follow-ups block fade in via `motion.div`
 *    opacity tweens (0.4s, the source's `transition-opacity duration-400`).
 *    The source's `pointerEvents` gate is re-expressed per interactive
 *    child — GPUIV does not inherit `pointerEvents`, and an element with a
 *    listener keeps a clickable hitbox regardless of the wrapper's gate —
 *    by dropping each handler/cursor/hover while streaming.
 *  - Follow-up rows ran a `fade-up` keyframe (350ms, 90ms stagger,
 *    ease-out-strong) when `done` flipped, and snapped to `opacity: 0` while
 *    streaming. Here each row is a `motion.div` retargeted between
 *    `{opacity: 0, top: 8}` and `{opacity: 1, top: 0}` with the same
 *    duration/ease/stagger (the stagger delay applies only on the way in),
 *    so the hidden rows keep occupying their layout height like the source.
 *  - The sources drawer transitioned `grid-template-rows: 0fr ↔ 1fr` plus
 *    opacity (300ms ease-out-strong). Here `AnimateHeight` (measured
 *    auto-height tween) plus an opacity tween on its content at the same
 *    timing — the ThinkingState pattern.
 *  - Source chips and rows were `<a href target="_blank">` with an
 *    `animated-underline` hover. GPUIV primitives do not open links (see
 *    ThinkingState), so they are hover-washed rows; `href` stays on
 *    `StreamingSource` for parity, and the underline grow is dropped (no
 *    text-decoration animation in GPUIV).
 *  - The `.source-avatar` ring (a StreamingText-specific block in
 *    globals.css) becomes a zero-blur spread boxShadow — 1px of
 *    `oklch(0.21 0.034 263.436 / 0.1)` light / `oklch(1 0 0 / 0.08)` dark on
 *    the chip and list avatars, 1.5px of the canvas token on the stacked
 *    avatars (the source's `shadow-[0_0_0_1.5px_var(--canvas)]`).
 *  - `transition-colors` hovers swap instantly (no CSS transitions), and the
 *    action icons keep their resting `ink3` tint on hover: an `<svg>` glyph
 *    colours itself from its own style, so the parent's hover colour cannot
 *    reach it (same trade-off as SearchList).
 *  - `onDone` / `onFollowUp` are the `done` / `followUp` emits, per Vue
 *    convention. The original's unused `variant?: string` prop is dropped.
 *    Changing `content` or `loop` mid-run does not re-arm the timer (the
 *    original re-arms on a `loop` flip; here the timeline keeps its pace).
 */

import { computed, defineComponent, onBeforeUnmount, onMounted, ref, type PropType } from "vue"
import { AnimateHeight, motion } from "@gpuiv/vue"
import { ease, fonts, radius } from "../tokens.js"
import { useTheme } from "../theme.js"
import { Icon } from "../atoms/Icon.js"
import type { IconName } from "../icons.js"

/** One streamed word, or a `cite` placeholder that renders an inline source chip. */
export interface StreamingToken {
  text: string
  cite?: boolean
}

/** One cited source, shown as the inline chip, in the avatar stack, and in the expanded list. */
export interface StreamingSource {
  name: string
  domain: string
  /** Kept for parity with the web original; GPUIV primitives do not open links. */
  href: string
  /** Avatar image URL. A `data:` URL paints offline (the default set is inline SVG). */
  image: string
}

export interface StreamingLabels {
  /** Label on the collapsed sources toggle. */
  sources: string
  /** Heading above the follow-up prompts. */
  followUps: string
}

/** Milliseconds per streamed word, and the end-of-stream hold before a loop
 *  restart — the original's timing, unchanged. */
const WORD_MS = 55
const HOLD_MS = 3400

const SOURCE_IMAGES = {
  scoop:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%231f7a5f'/%3E%3Cpath d='M20 36c0 7 5.4 12 12 12s12-5 12-12H20Z' fill='%23fff'/%3E%3Ccircle cx='32' cy='25' r='11' fill='%23bff3dd'/%3E%3Cpath d='M24 24c4-7 13-7 17 0' fill='none' stroke='%231f7a5f' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E",
  trends:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%232f6fec'/%3E%3Cpath d='M15 43 27 31l8 7 14-18' fill='none' stroke='%23fff' stroke-width='7' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='49' cy='20' r='5' fill='%23bfe0ff'/%3E%3C/svg%3E",
  market:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23e56d24'/%3E%3Cpath d='M17 45V25h8v20h-8Zm11 0V16h8v29h-8Zm11 0V30h8v15h-8Z' fill='%23fff'/%3E%3Cpath d='M16 49h32' stroke='%23ffd6b8' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E",
}

const DEFAULT_TOKENS: StreamingToken[] = [
  ..."Pistachio is your fastest-growing flavor — sales are up 23% this month and margins beat vanilla by 8 points."
    .split(" ")
    .map((text) => ({ text })),
  { text: "", cite: true },
  ..."Stone-fruit flavors are trending in the same range.".split(" ").map((text) => ({ text })),
]

const DEFAULT_SOURCES: StreamingSource[] = [
  { name: "Scoop Data", domain: "scoopdata.io", href: "https://scoopdata.io/", image: SOURCE_IMAGES.scoop },
  { name: "Trends Index", domain: "trends.google.com", href: "https://trends.google.com/trends/", image: SOURCE_IMAGES.trends },
  { name: "Market Basket", domain: "marketbasket.io", href: "https://marketbasket.io/", image: SOURCE_IMAGES.market },
]

const DEFAULT_FOLLOW_UPS = ["Which flavors sell best in winter", "Compare gelato and soft serve margins"]

const DEFAULT_LABELS: StreamingLabels = {
  sources: "10 sources",
  followUps: "Follow-ups",
}

const ACTION_ICONS: { name: IconName; label: string }[] = [
  { name: "copy", label: "Copy" },
  { name: "retrySoft", label: "Retry" },
  { name: "thumbsUp", label: "Good response" },
  { name: "thumbsDown", label: "Bad response" },
]

/** `.source-avatar` from the StreamingText block of globals.css
 *  (component-specific there, so a local constant, not a theme token). */
const AVATAR_RING = {
  light: "oklch(0.21 0.034 263.436 / 0.1)",
  dark: "oklch(1 0 0 / 0.08)",
}


export const StreamingText = defineComponent({
  name: "BuiStreamingText",
  props: {
    /** The streamed tokens; `cite` tokens render an inline source chip. */
    content: { type: Array as PropType<StreamingToken[]>, default: () => DEFAULT_TOKENS },
    /** Cited sources shown in the chip, the avatar stack, and the expanded list. */
    sources: { type: Array as PropType<StreamingSource[]>, default: () => DEFAULT_SOURCES },
    /** Follow-up prompt suggestions shown once the stream completes. */
    followUps: { type: Array as PropType<string[]>, default: () => DEFAULT_FOLLOW_UPS },
    /** Prominent copy strings. */
    labels: { type: Object as PropType<Partial<StreamingLabels>>, default: undefined },
    /** Restart the stream after a hold; turn off when embedding in a real thread. */
    loop: { type: Boolean, default: true },
    /** Fill the parent width instead of the gallery's fixed measure. */
    fill: { type: Boolean, default: false },
  },
  emits: {
    /** The stream reached the end and `loop` is off. */
    done: () => true,
    /** A follow-up prompt was chosen. */
    followUp: (_text: string, _index: number) => true,
  },
  setup(props, { emit }) {
    const theme = useTheme()
    const copy = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }))
    const count = ref(0)
    const sourcesOpen = ref(false)
    const done = computed(() => count.value >= props.content.length)

    /* The original's useEffect timer chain: one timeout in flight at a time.
     * At the end of the stream: hold, then restart (loop) or settle (done).
     * An empty `content` settles immediately instead of idling on the hold. */
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (done.value) {
        if (!props.loop) {
          emit("done")
          return
        }
        if (props.content.length === 0) return
        timer = setTimeout(() => {
          count.value = 0
          schedule()
        }, HOLD_MS)
        return
      }
      timer = setTimeout(() => {
        count.value += 1
        schedule()
      }, WORD_MS)
    }
    onMounted(schedule)
    onBeforeUnmount(() => {
      if (timer !== undefined) clearTimeout(timer)
    })

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const isDone = done.value
      const drawerOpen = isDone && sourcesOpen.value
      const avatarRing = theme.isDark.value ? AVATAR_RING.dark : AVATAR_RING.light
      const chipSource = props.sources[0]

      const avatar = (source: StreamingSource, size: number, radiusPx: number, ring: string, spread: number, marginLeft = 0) => (
        // No flexShrink here: flexShrink: 0 combined with the negative overlap
        // margin collapses the stack's fit-content width to 0 (Taffy quirk),
        // which parked the "N sources" label under the avatars.
        <img
          key={source.domain}
          src={source.image}
          alt=""
          style={{
            width: size,
            height: size,
            borderRadius: radiusPx,
            backgroundColor: t.surface,
            ...(marginLeft === 0 ? {} : { marginLeft }),
            boxShadow: { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: spread, color: ring },
          }}
        />
      )

      return (
        <div style={props.fill ? { width: "100%" } : { width: "100%", maxWidth: 380, minHeight: 248 }}>
          {/* streamed paragraph */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 3.5 }}>
            {props.content.slice(0, count.value).map((token, i) =>
              token.cite ? (
                chipSource ? (
                  <motion.div
                    key={`cite-${i}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.25, ease: ease.outStrong }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        height: 18,
                        borderRadius: 5,
                        backgroundColor: t.inset,
                        paddingLeft: 3,
                        paddingRight: 3,
                        fontSize: 10.5,
                        fontFamily: fonts.mono,
                        color: t.ink2,
                        cursor: "pointer",
                        ...shadows.hairline,
                        hover: { backgroundColor: t.hover, color: t.ink },
                      }}
                    >
                      {avatar(chipSource, 12, 3, avatarRing, 1)}
                      {chipSource.domain}
                    </div>
                  </motion.div>
                ) : null
              ) : (
                <div key={i} style={{ fontSize: 13, lineHeight: 21, color: t.ink }}>
                  {token.text}
                </div>
              ),
            )}
            {!isDone && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15, ease: ease.out }}
                style={{ width: 2, height: 12, borderRadius: 1, backgroundColor: t.ink }}
              />
            )}
          </div>

          {/* action icons row */}
          <motion.div
            initial={false}
            animate={{ opacity: isDone ? 1 : 0 }}
            transition={{ duration: 0.4 }}
            style={{
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              gap: 2,
              pointerEvents: isDone ? "auto" : "none",
            }}
          >
            {ACTION_ICONS.map((action) => (
              <div
                key={action.name}
                role="button"
                aria-label={action.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  ...(isDone ? { cursor: "pointer" as const, hover: { backgroundColor: t.hover2 } } : {}),
                }}
              >
                <Icon name={action.name} size={15} color={t.ink3} />
              </div>
            ))}
            <div
              role="button"
              testId="streaming-sources"
              aria-expanded={sourcesOpen.value}
              onClick={
                isDone
                  ? () => {
                      sourcesOpen.value = !sourcesOpen.value
                    }
                  : undefined
              }
              style={{
                marginLeft: 6,
                display: "flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 6,
                paddingLeft: 4,
                paddingRight: 4,
                paddingTop: 2,
                paddingBottom: 2,
                ...(isDone ? { cursor: "pointer" as const, hover: { backgroundColor: t.hover } } : {}),
              }}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                {props.sources.map((source, i) => avatar(source, 14, radius.pill, t.canvas, 1.5, i > 0 ? -4 : 0))}
              </div>
              <div style={{ fontSize: 12, color: t.ink2 }}>{copy.value.sources}</div>
            </div>
          </motion.div>

          {/* expandable sources list */}
          <AnimateHeight height={drawerOpen ? "auto" : 0} duration={0.3} ease={ease.outStrong}>
            <motion.div
              initial={false}
              animate={{ opacity: drawerOpen ? 1 : 0 }}
              transition={{ duration: 0.3, ease: ease.outStrong }}
            >
              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  flexDirection: "column",
                  borderRadius: radius.card,
                  backgroundColor: t.inset,
                  padding: 4,
                  ...shadows.hairline,
                }}
              >
                {props.sources.map((source) => (
                  <div
                    key={source.domain}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 6,
                      paddingLeft: 6,
                      paddingRight: 6,
                      paddingTop: 4,
                      paddingBottom: 4,
                      fontSize: 12,
                      color: t.ink2,
                      cursor: "pointer",
                      hover: { backgroundColor: t.hover, color: t.ink },
                    }}
                  >
                    {avatar(source, 16, 4, avatarRing, 1)}
                    {source.name}
                    <div style={{ flexGrow: 1 }} />
                    <div style={{ fontSize: 10.5, fontFamily: fonts.mono, color: t.ink3 }}>{source.domain}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          </AnimateHeight>

          {/* follow-ups */}
          <motion.div
            initial={false}
            animate={{ opacity: isDone ? 1 : 0 }}
            transition={{ duration: 0.4 }}
            style={{ marginTop: 10, pointerEvents: isDone ? "auto" : "none" }}
          >
            <div style={{ fontSize: 12, fontWeight: 500, color: t.ink2 }}>{copy.value.followUps}</div>
            <div style={{ marginTop: 2, display: "flex", flexDirection: "column" }}>
              {props.followUps.map((text, i) => (
                <motion.div
                  key={text}
                  initial={false}
                  animate={isDone ? { opacity: 1, top: 0 } : { opacity: 0, top: 8 }}
                  transition={isDone ? { duration: 0.35, delay: i * 0.09, ease: ease.outStrong } : { duration: 0.15 }}
                  style={{ position: "relative" }}
                >
                  <div
                    role="button"
                    testId={`streaming-followup-${i}`}
                    onClick={isDone ? () => emit("followUp", text, i) : undefined}
                    style={{
                      marginLeft: -6,
                      marginRight: -6,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 7,
                      borderBottomWidth: 1,
                      borderColor: t.line,
                      paddingLeft: 6,
                      paddingRight: 6,
                      paddingTop: 6,
                      paddingBottom: 6,
                      fontSize: 12.5,
                      color: t.ink,
                      ...(isDone ? { cursor: "pointer" as const, hover: { backgroundColor: t.hover2 } } : {}),
                    }}
                  >
                    <Icon name="cornerDownLeft" size={11} color={t.ink3} />
                    {text}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      )
    }
  },
})
