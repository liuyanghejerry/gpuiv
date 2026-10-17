/** CountUp — ported from guokaigdg/animal-island-ui CountUp.tsx (MIT).
 * Native adaptation: a cancellable 16ms clock drives numeric text/callbacks;
 * unchanged formatted strings do not cross the mutation boundary. Native
 * motion animates celebration position, expanding rings and fading stars.
 * Scale/rotation are approximated by native position motion. A measured SVG
 * paints the island dashed outline while a transparent border owns layout.
 */
import { computed, defineComponent, onBeforeUnmount, onMounted, ref, watch, type PropType, type VNodeChild } from "vue"
import { motion, type StyleDesc } from "@gpuiv/vue"
import { colors, ease, fonts, shadows } from "../tokens.js"
import { DashedBorderSurface } from "./border-decoration.js"
import { renderContent as content } from "./content.js"

export type CountUpSize = "small" | "middle" | "large"
export type CountUpVariant = "default" | "island"
export type CountUpEasingName = "linear" | "easeInCubic" | "easeOutCubic" | "easeInOutCubic" | "easeOutExpo"
export type CountUpEasingFunction = (progress: number) => number
export type CountUpEasing = CountUpEasingName | CountUpEasingFunction
export interface CountUpCompleteResult { shouldRepeat?: boolean; delay?: number; newStartAt?: number }
export interface CountUpCelebrateOptions { text?: VNodeChild }
export interface CountUpRenderState { value: number; reset: (newStartAt?: number) => void }
export interface CountUpProps {
  start?: number; end: number; duration?: number; isCounting?: boolean
  decimalPlaces?: number; decimalSeparator?: string; thousandsSeparator?: string
  easing?: CountUpEasing; formatter?: (value: number) => VNodeChild; updateInterval?: number
  prefix?: VNodeChild; suffix?: VNodeChild; size?: CountUpSize; variant?: CountUpVariant; bordered?: boolean
  celebrate?: boolean | CountUpCelebrateOptions; onUpdate?: (value: number) => void
  onComplete?: (elapsedTime: number) => void | CountUpCompleteResult
  children?: (state: CountUpRenderState) => VNodeChild; style?: StyleDesc; testId?: string
}

const easings: Record<CountUpEasingName, CountUpEasingFunction> = {
  linear: p => p,
  easeInCubic: p => p ** 3,
  easeOutCubic: p => 1 - (1 - p) ** 3,
  easeInOutCubic: p => p < .5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2,
  easeOutExpo: p => p >= 1 ? 1 : 1 - 2 ** (-10 * p),
}
const resolveEasing = (value: CountUpEasing): CountUpEasingFunction => typeof value === "function" ? value : easings[value] ?? easings.easeOutCubic
function decimalCount(value: number) {
  const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e")
  return Math.max(0, (mantissa.split(".")[1]?.length ?? 0) - Number(exponent))
}
function formatNumber(value: number, places: number, decimalSeparator: string, thousandsSeparator: string) {
  const [integer, fraction] = (places > 0 ? value.toFixed(places) : String(Math.round(value))).split(".")
  const grouped = thousandsSeparator ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSeparator) : integer
  return fraction === undefined ? grouped : `${grouped}${decimalSeparator}${fraction}`
}
const sizes = { small: { minHeight: 40, fontSize: 13, digit: 20 }, middle: { minHeight: 48, fontSize: 14, digit: 26 }, large: { minHeight: 56, fontSize: 16, digit: 34 } }
const sparkle = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#f7cd67" d="M5 0 6.1 3.9 10 5 6.1 6.1 5 10 3.9 6.1 0 5 3.9 3.9Z"/></svg>').toString("base64")}`

export const CountUp = defineComponent({
  name: "AnimalCountUp",
  inheritAttrs: false,
  props: {
    start: { type: Number, default: 0 }, end: { type: Number, required: true }, duration: { type: Number, default: 2 },
    isCounting: { type: Boolean, default: false }, decimalPlaces: { type: Number, default: undefined },
    decimalSeparator: { type: String, default: "." }, thousandsSeparator: { type: String, default: "" },
    easing: { type: [String, Function] as PropType<CountUpEasing>, default: "easeOutCubic" },
    formatter: { type: Function as PropType<(value: number) => VNodeChild>, default: undefined },
    updateInterval: { type: Number, default: 0 }, prefix: { type: null as unknown as PropType<VNodeChild>, default: undefined },
    suffix: { type: null as unknown as PropType<VNodeChild>, default: undefined },
    size: { type: String as PropType<CountUpSize>, default: "middle" }, variant: { type: String as PropType<CountUpVariant>, default: "default" },
    bordered: { type: Boolean, default: false }, celebrate: { type: [Boolean, Object] as PropType<boolean | CountUpCelebrateOptions>, default: false },
    onUpdate: { type: Function as PropType<(value: number) => void>, default: undefined },
    onComplete: { type: Function as PropType<(elapsedTime: number) => void | CountUpCompleteResult>, default: undefined },
    children: { type: Function as PropType<(state: CountUpRenderState) => VNodeChild>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    const display = ref(props.start), counting = ref(false), celebrating = ref(false), bounce = ref(0)
    const places = computed(() => Math.min(100, Math.max(0, Math.floor(props.decimalPlaces ?? Math.max(decimalCount(props.start), decimalCount(props.end))))))
    const format = (value: number) => props.formatter ? props.formatter(value) : formatNumber(value, places.value, props.decimalSeparator, props.thousandsSeparator)
    let timer: ReturnType<typeof setInterval> | undefined, repeat: ReturnType<typeof setTimeout> | undefined, celebration: ReturnType<typeof setTimeout> | undefined
    let elapsed = 0, lastTimestamp = 0, runStart = props.start, complete = false, formatted: string | null = null, mounted = false
    const clearRun = () => {
      if (timer !== undefined) clearInterval(timer)
      if (repeat !== undefined) clearTimeout(repeat)
      timer = repeat = undefined
      counting.value = false
    }
    const clearCelebration = () => {
      if (celebration !== undefined) clearTimeout(celebration)
      celebration = undefined
      celebrating.value = false
      bounce.value = 0
    }
    function commit(next: number, force = false) {
      const output = format(next)
      const key = typeof output === "string" || typeof output === "number" ? String(output) : null
      // Render functions consume the precise value even if formatted text is unchanged.
      if (!force && !props.children && !slots.default && key !== null && key === formatted) return
      formatted = key
      display.value = next
    }
    function finish() {
      clearRun()
      complete = true
      commit(props.end, true)
      if (props.celebrate) {
        clearCelebration()
        celebrating.value = true
        celebration = setTimeout(clearCelebration, 900)
      }
      const result = props.onComplete?.(elapsed / 1000)
      if (result?.shouldRepeat && props.isCounting) {
        // A zero-duration, zero-delay repeat must yield between runs.
        repeat = setTimeout(() => { repeat = undefined; reset(result.newStartAt) }, Math.max(16, (result.delay ?? 0) * 1000))
      }
    }
    function resume() {
      clearRun()
      if (!props.isCounting || complete) return
      const total = Math.max(0, props.duration) * 1000
      if (total === 0) { finish(); return }
      counting.value = true
      lastTimestamp = Date.now()
      timer = setInterval(() => {
        const timestamp = Date.now()
        elapsed += Math.max(0, timestamp - lastTimestamp)
        lastTimestamp = timestamp
        const interval = Math.max(0, props.updateInterval) * 1000
        const sampled = interval > 0 ? Math.floor(elapsed / interval) * interval : elapsed
        const done = elapsed >= total
        const progress = Math.min(1, Math.max(0, sampled / total))
        const next = done ? props.end : runStart + (props.end - runStart) * resolveEasing(props.easing)(progress)
        props.onUpdate?.(next)
        if (done) finish()
        else commit(next)
      }, 16)
    }
    function reset(newStartAt?: number) {
      clearRun()
      clearCelebration()
      elapsed = 0
      complete = false
      runStart = newStartAt ?? props.start
      commit(runStart, true)
      if (mounted) resume()
    }
    expose({ reset })
    onMounted(() => { mounted = true; commit(props.start, true); resume() })
    watch(() => [props.start, props.end, props.duration], () => reset())
    watch(() => props.isCounting, () => { if (mounted) resume() })
    onBeforeUnmount(() => { mounted = false; clearRun(); clearCelebration() })

    return () => {
      const size = sizes[props.size], island = props.variant === "island"
      const state: CountUpRenderState = { value: display.value, reset }
      const rendered = props.children ? props.children(state) : slots.default ? slots.default(state) : format(display.value)
      const readable = counting.value ? "" : formatNumber(display.value, places.value, props.decimalSeparator, props.thousandsSeparator)
      const affix: StyleDesc = { color: "#a89878", fontWeight: 800, fontSize: size.digit * .62, whiteSpace: "nowrap" }
      const text = typeof props.celebrate === "object" ? props.celebrate.text : undefined
      const rootStyle: StyleDesc = { position: "relative", display: "flex", alignItems: "center", gap: 8, minHeight: size.minHeight, paddingTop: island ? 13 : 12, paddingBottom: island ? 13 : 12, paddingLeft: island ? 20 : 18, paddingRight: island ? 20 : 18, borderRadius: 20, backgroundColor: island ? "#f7f3df" : "#ffffff", ...(island ? { borderWidth: 2, borderColor: "#d4c4a8" } : { boxShadow: shadows.sm }), color: colors.text, fontSize: size.fontSize, fontWeight: 700, ...(fonts.sans ? { fontFamily: fonts.sans } : {}), ...(attrs.style as StyleDesc | undefined) }
      const borderInk = typeof rootStyle.borderColor === "string" ? rootStyle.borderColor : "#d4c4a8"
      const borderWidth = typeof rootStyle.borderWidth === "number" ? rootStyle.borderWidth : 2
      const borderRadius = typeof rootStyle.borderRadius === "number" ? rootStyle.borderRadius : 20
      if (island) rootStyle.borderColor = "transparent"
      return <div {...attrs} role="status" aria-valuetext={readable} testId={props.testId} style={rootStyle}>
        {island && borderWidth > 0 ? <DashedBorderSurface color={borderInk} width={borderWidth} radius={borderRadius} /> : null}
        <div style={{ position: "relative", display: "flex" }}>
          {celebrating.value ? <div aria-hidden="true" testId={props.testId ? `${props.testId}-celebration` : undefined} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "none" }}>
            {[0, 1].map(index => <motion.div key={index} initial={{ top: -2, right: -2, bottom: -2, left: -2, opacity: .9 }} animate={{ top: -18, right: -18, bottom: -18, left: -18, opacity: 0 }} transition={{ duration: .7, delay: index * .12, ease }} style={{ position: "absolute", borderWidth: 2, borderColor: "#f7cd67", borderRadius: 14, pointerEvents: "none" }} />)}
            {[-1, 1].flatMap((horizontal, i) => [-1, 1].map((vertical, j) => <motion.div key={`star-${i}-${j}`} initial={{ [horizontal < 0 ? "left" : "right"]: 0, [vertical < 0 ? "top" : "bottom"]: 0, opacity: 1 }} animate={{ [horizontal < 0 ? "left" : "right"]: -16, [vertical < 0 ? "top" : "bottom"]: -14, opacity: 0 }} transition={{ duration: .72, delay: (i + j) * .06, ease }} style={{ position: "absolute", width: 10, height: 10, pointerEvents: "none" }}>{() => <img src={sparkle} style={{ width: 10, height: 10, pointerEvents: "none" }} />}</motion.div>))}
            {text !== undefined ? <motion.div initial={{ opacity: 0, top: -24 }} animate={{ opacity: 1, top: -32 }} transition={{ duration: .5, ease }} style={{ position: "absolute", alignSelf: "center", paddingLeft: 10, paddingRight: 10, paddingTop: 2, paddingBottom: 2, borderRadius: 50, backgroundColor: "#f7cd67", borderWidth: 1.5, borderColor: "#e0b800", color: "#725d42", fontSize: size.fontSize, fontWeight: 800, whiteSpace: "nowrap", pointerEvents: "none" }}>{() => content(text)}</motion.div> : null}
          </div> : null}
          <motion.div initial={false} animate={{ top: celebrating.value ? [-6, 2, -3, 0][Math.min(bounce.value, 3)] : 0 }} transition={{ duration: .16, ease }} onMotionComplete={() => { if (celebrating.value && bounce.value < 3) bounce.value++ }} style={{ position: "relative", display: "flex", alignItems: "center", gap: 2, paddingTop: 3, paddingBottom: 3, paddingLeft: 8, paddingRight: 8, borderRadius: 12, background: { type: "linear-gradient", angle: 180, stops: [{ color: island ? "#fffdf4" : "#ffffff", position: 0 }, { color: colors.bg, position: 1 }] }, ...(props.bordered ? { borderWidth: 1.5, borderColor: island ? "#d4c4a8" : "#d4c9b4" } : {}) }}>
            {() => <>
            {slots.prefix || props.prefix !== undefined ? <div style={affix}>{slots.prefix?.() ?? content(props.prefix)}</div> : null}
            <div aria-hidden="true" testId={props.testId ? `${props.testId}-number` : undefined} style={{ color: "#8b7355", fontSize: size.digit, fontWeight: 900, lineHeight: size.digit * 1.2 }}>{content(rendered)}</div>
            {slots.suffix || props.suffix !== undefined ? <div style={affix}>{slots.suffix?.() ?? content(props.suffix)}</div> : null}
            </>}
          </motion.div>
        </div>
      </div>
    }
  },
})
export default CountUp
