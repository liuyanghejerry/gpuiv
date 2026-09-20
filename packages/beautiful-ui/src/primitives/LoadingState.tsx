/** LOADING STATE — pixel-grid loader for long-running work.
 *
 *  Ported from beautiful-ui `components/primitives/LoadingState.tsx`.
 *
 *  Variants:
 *    Drive — square cells, chevron wavefront driving right; the 650ms
 *            cycle is shorter than the sweep, so two fronts are always
 *            in flight
 *    Dots  — same wavefront, circular cells
 *    Orbit — a comet lapping the grid perimeter
 *
 *  Platform degradations vs the web original:
 *  - The `Surfer` variant is DROPPED: it pairs the Drive loader with a
 *    `<video>` meme card, and GPUIV has no video element. Passing
 *    `variant="Surfer"` from untyped JS falls back to Drive.
 *  - The `pixel-on` CSS keyframe (`0%/100%: 0.15, 18%/42%: 1, 62%: 0.15`,
 *    `ease-in-out`) is sampled in JS: one `setInterval(100ms)` advances a
 *    shared clock (10fps vs the browser's 60 — the wave is steppy by
 *    design here), and each cell's opacity is the keyframe wave offset by
 *    its per-variant delay. The easing replicates CSS `ease-in-out`
 *    (cubic-bezier(0.42, 0, 0.58, 1)) exactly.
 *  - The label uses the `Shimmer` atom: the original's 1.4s gradient
 *    sweep (`background-clip: text`) cannot clip a gradient to glyphs in
 *    GPUIV, so the atom breathes the label's opacity instead.
 *  - The `pop-in` entrance (opacity + scale, 200ms) becomes a
 *    `motion.div` opacity fade — no scale/transform in GPUIV.
 *  - `tabular-nums` on the elapsed readout is dropped (no
 *    font-feature-settings); the mono family already reads tabular.
 *  - `prefers-reduced-motion` is not wired (no media queries in GPUIV).
 *    Pass `phase` to freeze every animation on a pinned clock instead.
 *
 *  `phase` pins the whole component to one millisecond on the shared
 *  clock (grid wave, shimmer label, elapsed readout) and skips the
 *  entrance fade — for tests and screenshots. The elapsed readout is
 *  also driven by that clock, so a pinned frame shows a deterministic
 *  `0.0s`-style value instead of wall time.
 */

import { defineComponent, onBeforeUnmount, onMounted, ref, type PropType } from "vue"
import { motion } from "@gpuiv/vue"
import { ease, fonts } from "../tokens.js"
import { useTheme } from "../theme.js"
import { Shimmer } from "../atoms/index.js"

export type LoadingStateVariant = "Drive" | "Dots" | "Orbit"

export interface LoadingStateProps {
  /** Status text between the grid and the timer. Default "Churning". */
  label?: string
  /** Pixel-grid waveform. Default "Drive"; unknown values fall back to it. */
  variant?: LoadingStateVariant
  /** Pin the shared clock at this many ms instead of ticking (tests). */
  phase?: number
}

const DEFAULT_LABEL = "Churning"

/** Shared clock cadence — also the elapsed readout's refresh rate. */
const TICK_MS = 100

/* Per-cell animation delays (ms), 3×3 grid indexed row-major. Both tables
 * are the source's formulas verbatim. */
const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3)
  const c = i % 3
  return (c + Math.abs(r - 1)) * 90
})

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3]
const ORBIT_DELAYS: (number | null)[] = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i)
  return k === -1 ? null : k * 110
})

interface GridPattern {
  /** Per-cell delay in ms; `null` never lights (the Orbit centre cell). */
  delays: (number | null)[]
  /** Keyframe cycle length in ms. */
  dur: number
  /** Circular cells (Dots) vs 1px-rounded squares. */
  round: boolean
}

const PATTERNS: Record<LoadingStateVariant, GridPattern> = {
  Drive: { delays: CHEVRON_DELAYS, dur: 650, round: false },
  Dots: { delays: CHEVRON_DELAYS, dur: 650, round: true },
  Orbit: { delays: ORBIT_DELAYS, dur: 950, round: false },
}

/** y-at-x for a CSS cubic-bezier timing function (Newton, then bisection). */
function cubicBezierY(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const ax = 3 * x1 - 3 * x2 + 1
  const bx = 3 * x2 - 6 * x1
  const cx = 3 * x1
  const ay = 3 * y1 - 3 * y2 + 1
  const by = 3 * y2 - 6 * y1
  const cy = 3 * y1
  const xAt = (t: number) => ((ax * t + bx) * t + cx) * t
  const yAt = (t: number) => ((ay * t + by) * t + cy) * t
  let t = x
  for (let i = 0; i < 8; i++) {
    const err = xAt(t) - x
    if (Math.abs(err) < 1e-6) return yAt(t)
    const d = (3 * ax * t + 2 * bx) * t + cx
    if (Math.abs(d) < 1e-6) break
    t -= err / d
  }
  let lo = 0
  let hi = 1
  t = x
  while (hi - lo > 1e-6) {
    if (xAt(t) < x) lo = t
    else hi = t
    t = (lo + hi) / 2
  }
  return yAt(t)
}

const cssEaseInOut = (x: number) => cubicBezierY(0.42, 0, 0.58, 1, x)

/** The `pixel-on` keyframe, sampled at fraction `u` (0–1) of one cycle. */
function pixelOn(u: number): number {
  if (u <= 0.18) return 0.15 + 0.85 * cssEaseInOut(u / 0.18)
  if (u <= 0.42) return 1
  if (u <= 0.62) return 1 - 0.85 * cssEaseInOut((u - 0.42) / 0.2)
  return 0.15
}

function cellOpacity(now: number, delay: number | null, dur: number): number {
  if (delay === null) return 0.07
  // A positive CSS animation-delay holds the base style (0.15, which is
  // also pixelOn(0)) until the delay elapses, then cycles.
  const t = Math.max(0, now - delay) % dur
  return pixelOn(t / dur)
}

function formatElapsed(ms: number): string {
  const total = ms / 1000
  if (total < 60) return `${total.toFixed(1)}s`
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`
}

/** The 3×3 grid as nested flex rows — GPUIV has no CSS grid. Cells carry
 *  no `role`, so (like the original's `aria-hidden`) they stay out of the
 *  accessibility tree. */
function loaderGrid(color: string, pattern: GridPattern, now: number) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1.5, flexShrink: 0 }}>
      {[0, 1, 2].map((r) => (
        <div key={r} style={{ display: "flex", gap: 1.5 }}>
          {[0, 1, 2].map((c) => {
            const i = r * 3 + c
            return (
              <div
                key={c}
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: pattern.round ? 2 : 1,
                  backgroundColor: color,
                  opacity: cellOpacity(now, pattern.delays[i] ?? null, pattern.dur),
                }}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

export const LoadingState = defineComponent({
  name: "BuiLoadingState",
  props: {
    label: { type: String, default: undefined },
    variant: { type: String as PropType<LoadingStateVariant>, default: "Drive" },
    /** Pin the shared clock at this many ms instead of ticking (tests). */
    phase: { type: Number, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    // One timer drives both the pixel wave and the elapsed readout.
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
      const t = theme.tokens.value
      const now = props.phase ?? elapsed.value
      const pattern = PATTERNS[props.variant] ?? PATTERNS.Drive
      return (
        <motion.div
          initial={{ opacity: props.phase === undefined ? 0 : 1 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: ease.link }}
          style={{ alignSelf: "flex-start" }}
        >
          <div role="status" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {loaderGrid(t.ink, pattern, now)}
            <Shimmer phase={props.phase}>
              <div style={{ fontSize: 13, fontWeight: 500, color: t.ink2 }}>{props.label ?? DEFAULT_LABEL}</div>
            </Shimmer>
            <div style={{ fontFamily: fonts.mono, fontSize: 12, color: t.ink3 }}>{formatElapsed(now)}</div>
          </div>
        </motion.div>
      )
    }
  },
})
