/** Skeleton — GPUIV port of animal-island-vue's `Skeleton.vue`.
 *
 *  Ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT).
 *
 *  Fidelity notes (see issue #164):
 *  - The original five-stop silver band is an SVG image, clipped by the
 *    skeleton and translated by the native clock over 1.6s ease-in-out.
 *    Completion restarts the offscreen band; a shared 100ms bounds poll
 *    tracks responsive widths, without sampling animation frames in JS.
 *  - Length props take `number` (px) or `string`; 'px'-suffixed and plain
 *    numeric strings are normalised to numbers, percentages pass through —
 *    GPUIV dimensions accept only numbers / percent strings / 'auto'.
 *  - The palette is local to the original's Skeleton.less and kept exact:
 *    base #eae5db, paragraph lines #dfd9ce.
 */

import { computed, createCommentVNode, defineComponent, onBeforeUnmount, onMounted, ref, watch, type PropType } from "vue"
import { useGpuix, type EventPayload, type HostNode, type StyleDesc } from "@gpuiv/vue"

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

// One tiny, cached strip supplies all five React gradient stops.
const SHIMMER_URL = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="2" viewBox="0 0 256 2" preserveAspectRatio="none"><defs><linearGradient id="shimmer" x1="0" y1="0" x2="1" y2="0" color-interpolation="sRGB"><stop offset="0" stop-color="#fffaeb" stop-opacity="0"/><stop offset=".25" stop-color="#fffaeb" stop-opacity=".18"/><stop offset=".5" stop-color="#fffcf2" stop-opacity=".55"/><stop offset=".75" stop-color="#fffaeb" stop-opacity=".18"/><stop offset="1" stop-color="#fffaeb" stop-opacity="0"/></linearGradient></defs><rect width="256" height="2" fill="url(#shimmer)"/></svg>').toString("base64")}`

const measurements = new Set<() => void>()
let measurementTimer: ReturnType<typeof setInterval> | undefined
function subscribeMeasurement(sample: () => void): () => void {
  measurements.add(sample)
  if (measurementTimer === undefined) measurementTimer = setInterval(() => {
    for (const current of measurements) current()
  }, 100)
  return () => {
    measurements.delete(sample)
    if (measurements.size === 0 && measurementTimer !== undefined) {
      clearInterval(measurementTimer)
      measurementTimer = undefined
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
    const surface = ref<HostNode | null>(null)
    const width = ref(0)
    const cycle = ref(0)
    const { renderer } = useGpuix()
    let mounted = false
    let release: (() => void) | undefined
    const measure = () => {
      if (surface.value?.id == null) return
      try {
        const next = renderer?.getElementBounds?.(surface.value.id)?.width
        if (next !== undefined && Number.isFinite(next)) width.value = Math.max(0, next)
      } catch { /* The native window may not have painted its first bounds yet. */ }
    }
    function syncMeasurement() {
      release?.()
      release = undefined
      cycle.value = 0
      if (mounted && props.active && props.loading) {
        measure()
        release = subscribeMeasurement(measure)
      }
    }
    watch(() => props.active && props.loading, syncMeasurement, { flush: "post" })
    onMounted(() => { mounted = true; syncMeasurement() })
    onBeforeUnmount(() => { mounted = false; release?.() })

    const shimmer = () => {
      if (!props.active || width.value <= 0) return null
      const generation = cycle.value + 1
      return <div key={`${width.value}:${cycle.value}`} aria-hidden="true"
        testId={props.testId ? `${props.testId}-shimmer` : undefined}
        motion={{ initial: { left: -width.value }, animate: { left: width.value },
          transition: { duration: 1.6, ease: "easeInOut" }, generation }}
        onMotionComplete={(event: EventPayload) => {
          if (props.active && props.loading && event.motionGeneration === generation && cycle.value + 1 === generation) cycle.value++
        }}
        style={{ position: "absolute", top: 0, left: -width.value, width: width.value, height: "100%", pointerEvents: "none" }}>
        <img src={SHIMMER_URL} objectFit="fill" style={{ width: "100%", height: "100%", pointerEvents: "none" }} />
      </div>
    }

    const paragraphWidths = computed<(number | string)[]>(() => {
      const widths = Array.isArray(props.rowWidths) ? props.rowWidths : DEFAULT_PARAGRAPH_WIDTHS
      const rowCount = Math.max(1, props.rows)
      return Array.from({ length: rowCount }, (_, i) => widths[i] ?? widths[widths.length - 1] ?? "100%")
    })

    return () => {
      // loading=false 时不显示骨架屏，有 children 则渲染插槽内容
      if (!props.loading) return slots.default?.() ?? createCommentVNode()

      const opacity = 1

      // paragraph 段落模式：根节点无底色，每行独立骨架条
      if (props.variant === "paragraph") {
        return (
          <div
            {...attrs}
            ref={surface}
            aria-hidden="true"
            testId={props.testId}
            style={{
              position: "relative",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              ...(attrs.style as StyleDesc | undefined),
            }}
          >
            {paragraphWidths.value.map((w, i) => (
              <div key={i} style={{ width: dim(w), height: 14, borderRadius: 12, backgroundColor: BG_LINE, opacity }} />
            ))}
            {shimmer()}
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
          ref={surface}
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
        >{shimmer()}</div>
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
