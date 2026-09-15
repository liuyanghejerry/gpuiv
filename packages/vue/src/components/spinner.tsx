/** Loading indicators: three pulsing dots (default) or an indeterminate
 *  sliding pulse bar.
 *
 *  Pure opacity/position animation — the styles the mutation protocol
 *  already carries — driven by a 25fps timer while mounted. Pass `phase`
 *  (milliseconds into the 1200ms cycle) to pin the visuals, e.g. in tests
 *  or when driving it from an app-owned timeline. */

import { defineComponent, h, onBeforeUnmount, onMounted, ref, type PropType } from "vue"

const PERIOD = 1200
const TICK_MS = 40
const DOT_STAGGER = 180
const DEFAULT_COLOR = "#8b8fa3"

function cycleTone(elapsed: number, delay: number): number {
  const t = ((((elapsed - delay) % PERIOD) + PERIOD) % PERIOD) / PERIOD
  return 0.25 + 0.75 * Math.sin(Math.PI * t)
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "")
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const Spinner = defineComponent({
  name: "Spinner",
  props: {
    /** `dots` (default) or `pulse`. */
    variant: { type: String as PropType<"dots" | "pulse">, default: "dots" },
    /** Dot diameter, or the pulse bar's height. Default 8 / 4. */
    size: { type: Number, default: undefined },
    /** Any CSS color string. */
    color: { type: String, default: DEFAULT_COLOR },
    /** Pulse bar track width. Default 96. */
    width: { type: Number, default: undefined },
    /** Accessibility label; also what `getA11yTree` reports. */
    label: { type: String, default: "Loading" },
    /** Pin the animation at this many ms into the cycle instead of ticking. */
    phase: { type: Number, default: undefined },
  },
  setup(props) {
    const elapsed = ref(0)
    let timer: ReturnType<typeof setInterval> | undefined
    onMounted(() => {
      if (props.phase !== undefined) return
      const start = Date.now()
      timer = setInterval(() => {
        elapsed.value = Date.now() - start
      }, TICK_MS)
    })
    onBeforeUnmount(() => {
      if (timer !== undefined) clearInterval(timer)
    })
    return () => {
      const phase = props.phase ?? elapsed.value
      if (props.variant === "pulse") {
        const height = props.size ?? 4
        const trackWidth = props.width ?? 96
        const t = (phase % PERIOD + PERIOD) % PERIOD / PERIOD
        // 0 → 1 → 0: the segment sweeps one way and back, like a shimmer.
        const slide = 0.5 - 0.5 * Math.cos(2 * Math.PI * t)
        const segmentWidth = Math.max(12, trackWidth * 0.35)
        const left = (trackWidth - segmentWidth) * slide
        return h(
          "div",
          {
            role: "status",
            "aria-label": props.label,
            style: {
              position: "relative",
              width: trackWidth,
              height,
              borderRadius: height / 2,
              backgroundColor: withAlpha(props.color, 0.25),
            },
          },
          h("div", {
            style: {
              position: "absolute",
              left,
              top: 0,
              width: segmentWidth,
              height,
              borderRadius: height / 2,
              backgroundColor: props.color,
            },
          })
        )
      }
      const dot = props.size ?? 8
      return h(
        "div",
        {
          role: "status",
          "aria-label": props.label,
          style: {
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: Math.max(3, Math.round(dot * 0.6)),
          },
        },
        [0, 1, 2].map((ix) =>
          h("div", {
            key: ix,
            style: {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: props.color,
              opacity: cycleTone(phase, ix * DOT_STAGGER),
            },
          })
        )
      )
    }
  },
})
