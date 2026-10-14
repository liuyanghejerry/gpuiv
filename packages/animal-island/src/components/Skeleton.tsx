/** Skeleton — GPUIV port of animal-island-vue's `Skeleton.vue`.
 *
 *  Ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT).
 *
 *  Fidelity notes (see issue #164):
 *  - The shimmer — a `linear-gradient` band sweeping via `transform` — cannot
 *    be expressed in GPUIV (no background images, no transforms, two-stop
 *    gradients only). `active` degrades to an opacity breath: a shared 50ms clock
 *    drives opacity between 0.45 and 1 with an ease-in-out-quad curve over
 *    1.6s, the original shimmer period. `active={false}` paints statically.
 *  - Length props take `number` (px) or `string`; 'px'-suffixed and plain
 *    numeric strings are normalised to numbers, percentages pass through —
 *    GPUIV dimensions accept only numbers / percent strings / 'auto'.
 *  - The palette is local to the original's Skeleton.less and kept exact:
 *    base #eae5db, paragraph lines #dfd9ce.
 */

import { computed, createCommentVNode, defineComponent, onUnmounted, ref, watch, type PropType } from "vue"
import type { StyleDesc } from "@gpuiv/vue"

export type SkeletonVariant = "text" | "circle" | "rect" | "paragraph"
export interface SkeletonProps {
  loading?: boolean
  variant?: SkeletonVariant
  active?: boolean
  rows?: number
  width?: number | string
  rowWidths?: (number | string)[]
  widthValue?: number | string
  heightValue?: number | string
  testId?: string
}
type SkeletonSize = "small" | "middle" | "large"
export interface SkeletonButtonProps { size?: SkeletonSize; active?: boolean; testId?: string }
export interface SkeletonInputProps { size?: SkeletonSize; active?: boolean; testId?: string }
export interface SkeletonAvatarProps { size?: SkeletonSize; shape?: "circle" | "square"; active?: boolean; testId?: string }

const BG_BASE = "#eae5db"
const BG_LINE = "#dfd9ce"

const DEFAULT_PARAGRAPH_WIDTHS = ["100%", "92%", "84%", "76%", "68%"]

const BREATH_PERIOD = 1600
const BREATH_TICK = 50
const BREATH_MIN = 0.45

// Advance every active instance in one JS turn so Vue naturally emits one
// mutation batch per cadence. Each subscriber owns its phase and reset state.
const breathSamples = new Set<() => void>()
let breathTimer: ReturnType<typeof setInterval> | undefined
function subscribeBreath(sample: () => void): () => void {
  breathSamples.add(sample)
  if (breathTimer === undefined) {
    breathTimer = setInterval(() => {
      for (const current of breathSamples) current()
    }, BREATH_TICK)
  }
  return () => {
    breathSamples.delete(sample)
    if (breathSamples.size === 0 && breathTimer !== undefined) {
      clearInterval(breathTimer)
      breathTimer = undefined
    }
  }
}

function dim(v: number | string): number | string {
  if (typeof v === "number") return v
  const s = v.trim()
  if (s.endsWith("%") || s === "auto") return s
  const n = s.endsWith("px") ? Number(s.slice(0, -2)) : Number(s)
  return Number.isNaN(n) ? s : n
}

export const Skeleton = defineComponent({
  name: "AnimalSkeleton",
  inheritAttrs: false,
  props: {
    loading: { type: Boolean, default: true },
    variant: { type: String as PropType<SkeletonVariant>, default: "text" },
    active: { type: Boolean, default: true },
    rows: { type: Number, default: 3 },
    width: { type: [Number, String] as PropType<number | string>, default: undefined },
    rowWidths: { type: Array as PropType<(number | string)[]>, default: undefined },
    widthValue: { type: [Number, String] as PropType<number | string>, default: undefined },
    heightValue: { type: [Number, String] as PropType<number | string>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const breath = ref(1)
    let release: (() => void) | undefined
    let elapsed = 0

    function stopBreath() {
      release?.()
      release = undefined
      breath.value = 1
    }

    watch(
      () => props.active && props.loading,
      (on) => {
        if (on) {
          elapsed = 0
          release = subscribeBreath(() => {
            elapsed = (elapsed + BREATH_TICK) % BREATH_PERIOD
            const t = elapsed / BREATH_PERIOD
            const tri = t < 0.5 ? t * 2 : 2 - t * 2 // ping-pong 0→1→0
            const eased = tri < 0.5 ? 2 * tri * tri : 1 - Math.pow(-2 * tri + 2, 2) / 2 // easeInOutQuad
            breath.value = BREATH_MIN + (1 - BREATH_MIN) * eased
          })
        } else {
          stopBreath()
        }
      },
      { immediate: true },
    )
    onUnmounted(stopBreath)

    const paragraphWidths = computed<(number | string)[]>(() => {
      const widths = Array.isArray(props.rowWidths) ? props.rowWidths : DEFAULT_PARAGRAPH_WIDTHS
      const rowCount = Math.max(1, props.rows)
      return Array.from({ length: rowCount }, (_, i) => widths[i] ?? widths[widths.length - 1] ?? "100%")
    })

    return () => {
      // loading=false 时不显示骨架屏，有 children 则渲染插槽内容
      if (!props.loading) return slots.default?.() ?? createCommentVNode()

      const opacity = props.active ? breath.value : 1

      // paragraph 段落模式：根节点无底色，每行独立骨架条
      if (props.variant === "paragraph") {
        return (
          <div
            {...attrs}
            aria-hidden="true"
            testId={props.testId}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              ...(attrs.style as StyleDesc | undefined),
            }}
          >
            {paragraphWidths.value.map((w, i) => (
              <div key={i} style={{ width: dim(w), height: 14, borderRadius: 12, backgroundColor: BG_LINE, opacity }} />
            ))}
          </div>
        )
      }

      let sizeStyle: StyleDesc
      switch (props.variant) {
        case "circle": {
          const s = dim(props.widthValue ?? props.heightValue ?? 44)
          sizeStyle = { width: s, height: s, borderRadius: 999 }
          break
        }
        case "rect":
          sizeStyle = {
            width: dim(props.widthValue ?? "100%"),
            height: dim(props.heightValue ?? 120),
            borderRadius: 18,
          }
          break
        case "text":
        default:
          sizeStyle = {
            width: dim(props.width ?? "100%"),
            height: dim(props.heightValue ?? 16),
            borderRadius: 12,
            marginBottom: 8,
          }
          break
      }

      return (
        <div
          {...attrs}
          aria-hidden="true"
          testId={props.testId}
          style={{
            position: "relative",
            overflow: "hidden",
            flexShrink: 0,
            lineHeight: 1,
            backgroundColor: BG_BASE,
            opacity,
            ...sizeStyle,
            ...(attrs.style as StyleDesc | undefined),
          }}
        />
      )
    }
  },
})

export default Skeleton

/** Original public Skeleton helpers; reuse the same animation/lifecycle. */
export const SkeletonButton = defineComponent({
  name: "AnimalSkeletonButton",
  inheritAttrs: false,
  props: {
    size: { type: String as PropType<SkeletonSize>, default: "middle" },
    active: { type: Boolean, default: true },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    const geometry = { small: [80, 32], middle: [100, 45], large: [130, 48] } as const
    return () => <Skeleton {...attrs} variant="rect" active={props.active} widthValue={geometry[props.size][0]} heightValue={geometry[props.size][1]} testId={props.testId} style={{ borderRadius: 50, ...(attrs.style as StyleDesc | undefined) }} />
  },
})

export const SkeletonInput = defineComponent({
  name: "AnimalSkeletonInput",
  inheritAttrs: false,
  props: {
    size: { type: String as PropType<SkeletonSize>, default: "middle" },
    active: { type: Boolean, default: true },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    const geometry = { small: [160, 32], middle: [200, 40], large: [240, 48] } as const
    return () => <Skeleton {...attrs} variant="rect" active={props.active} widthValue={geometry[props.size][0]} heightValue={geometry[props.size][1]} testId={props.testId} style={{ borderRadius: 50, ...(attrs.style as StyleDesc | undefined) }} />
  },
})

export const SkeletonAvatar = defineComponent({
  name: "AnimalSkeletonAvatar",
  inheritAttrs: false,
  props: {
    size: { type: String as PropType<SkeletonSize>, default: "middle" },
    shape: { type: String as PropType<"circle" | "square">, default: "circle" },
    active: { type: Boolean, default: true },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    const sizes = { small: 32, middle: 44, large: 56 } as const
    return () => <Skeleton {...attrs} variant={props.shape === "circle" ? "circle" : "rect"} active={props.active} widthValue={sizes[props.size]} heightValue={sizes[props.size]} testId={props.testId} style={{ borderRadius: props.shape === "circle" ? 999 : 12, ...(attrs.style as StyleDesc | undefined) }} />
  },
})
