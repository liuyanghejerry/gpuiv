/** INSIGHT CARDS — an "Insights ‹ ›" carousel of mini-visualizations: a
 *  two-series return-comparison line chart, an anomaly chart with a
 *  spend/usage metric toggle, and a segmented allocation bar, each with a
 *  prose lead-in and a follow-up prompt pill.
 *
 *  Ported from beautiful-ui `components/primitives/InsightCards.tsx`.
 *
 *  Platform degradations and deliberate differences from the web original:
 *
 *  - The npm package `liveline` is not ported. Both charts are redrawn by
 *    hand on the native `<canvas>` 2D context — grid lines, gradient fill
 *    under the line, 2.25px round-joined stroke, end dot — from the same
 *    Catmull-Rom-resampled series. Liveline's time-axis windowing is
 *    dropped: series are evenly spaced value arrays, so `makePoints`'
 *    mount-time timestamp anchoring has no equivalent here.
 *  - Canvas text is unsupported in GPUIV (`fillText` throws), so every
 *    label and value is a native text element outside the canvas; liveline's
 *    in-canvas value readout, pulse, momentum and scrub are dropped, and
 *    `paused`/`cursor` reduce to a static drawing plus a CSS cursor.
 *  - Chart hover: React pointer events carry element-local coordinates; the
 *    FFI only carries window coordinates, so the stage's painted bounds
 *    (`useElementBounds`) convert `event.x` into chart-local progress.
 *    `pointerCancel` has no GPUIV event — mouseLeave/mouseUp cover it.
 *  - The tooltip's `translateX(-50%)` centering is a transform; the box is
 *    fixed-width and centered with a negative `marginLeft` instead.
 *  - `useDarkMode` (a MutationObserver on `<html>.dark`) becomes
 *    `useTheme()`: a tokens watch redraws the canvas when the mode flips.
 *  - The canvas buffer is rendered at 2× and stretched into the element box
 *    (`objectFit` fill) so the lines stay sharp on retina.
 *  - The prose `ReactNode` becomes a typed segment array rendered as a
 *    `flexWrap: "wrap"` row (the RecommendationCard pattern); the `Entity`
 *    mention and `Mono` code spans are flex segments. The page wrapper's
 *    `transition-[opacity,filter]` classes are static in the source (the
 *    blurred crossfade never fires) and are dropped — page switches are
 *    instant, exactly what the original renders.
 *  - `CompareSeries`' separate `dot`/`color`/`tooltipColor` class and var
 *    strings collapse to one semantic `color` key, and
 *    `AllocationSegment`'s `cls`/`tone` class strings become semantic
 *    colour keys — both resolved against the live theme (no CSS variables).
 *  - Allocation: the selected gloss's `calc(100% - 8px)` width tween becomes
 *    pixels measured from the bar's `useElementBounds` (motion tweens px
 *    only); the `inset 0 0 0 1px` ring is a 1px border; `active:scale`
 *    press feedback is dropped (no transform).
 *  - The anomaly metric toggle's `transition-colors` and every hover colour
 *    fade are instant swaps (nested `hover:` styles remain); `tabular-nums`,
 *    `tracking`, `aria-pressed` (no accessibility tree — aria is a
 *    passthrough) and the pager glyphs' `hover:text-ink` (an `<svg>` tints
 *    only from its own `color`, same as ApprovalCard) are dropped. The
 *    source header's "autoplay" note is vestigial — there is no timer in
 *    the original, and none is added.
 */

import { computed, defineComponent, h, onBeforeUnmount, ref, watch, type Component, type PropType } from "vue"
import {
  GpuixCanvas,
  motion,
  useElementBounds,
  type EventPayload,
  type GpuixCanvasInstance,
  type GpuixCanvasRenderingContext2D,
  type HostNode,
} from "@gpuiv/vue"

import { ease, fonts, radius, type Tokens } from "../tokens.js"
import { useTheme } from "../theme.js"
import { toSrgb, withAlpha } from "../colors.js"
import { Icon } from "../atoms/Icon.js"

/* ── Formatting & series math (ported verbatim where meaningful) ── */

const formatPercent = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`
const formatMoney = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`

/* Catmull-Rom resample — turn a sparse series into a dense, smoothly curved
 * one so the line glides instead of stepping between a handful of points. */
function smooth(values: number[], perSegment = 9): number[] {
  if (values.length < 3) return values.slice()
  const out: number[] = []
  const n = values.length
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = values[Math.max(0, i - 1)]
    const p1 = values[i]
    const p2 = values[i + 1]
    const p3 = values[Math.min(n - 1, i + 2)]
    for (let s = 0; s < perSegment; s += 1) {
      const t = s / perSegment
      const t2 = t * t
      const t3 = t2 * t
      out.push(
        0.5 *
          (2 * p1 +
            (-p0 + p2) * t +
            (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
            (-p0 + 3 * p1 - 3 * p2 + p3) * t3),
      )
    }
  }
  out.push(values[n - 1])
  return out
}

/** Dense, smoothed values — the original's 42s-window resample, minus the
 *  timestamps (the charts here space points evenly). */
function smoothValues(values: number[]): number[] {
  return smooth(values)
}

/* ── Canvas chart ────────────────────────────────────────
 * Redrawn whenever the painted size, the series, or the theme changes. */

const STAGE_HEIGHT = 166
/** Buffer oversampling — the element box is logical px, retina is 2×. */
const RENDER_SCALE = 2
/** Liveline's lineWidth for both charts. */
const LINE_WIDTH = 2.25

interface ChartSeriesData {
  /** A theme token string (oklch) — converted to srgb for the canvas. */
  color: string
  values: number[]
}

interface ChartOptions {
  grid: boolean
  fill: boolean
  domainFromZero: boolean
}

function drawLineChart(
  ctx: GpuixCanvasRenderingContext2D,
  width: number,
  height: number,
  series: ChartSeriesData[],
  options: ChartOptions,
  t: Tokens,
): void {
  ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0)
  ctx.fillStyle = toSrgb(t.inset)
  ctx.fillRect(0, 0, width, height)

  const padTop = 14
  const padBottom = 12
  const padSide = 3
  const plotTop = padTop
  const plotBottom = height - padBottom
  const plotHeight = plotBottom - plotTop

  let min = Infinity
  let max = -Infinity
  for (const s of series) {
    for (const v of s.values) {
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return
  if (min === max) {
    min -= 1
    max += 1
  }
  let lo: number
  let hi: number
  if (options.domainFromZero) {
    lo = Math.min(0, min)
    hi = max + (max - lo) * 0.06
  } else {
    const pad = (max - min) * 0.08
    lo = min - pad
    hi = max + pad
  }
  const range = hi - lo || 1
  const yOf = (v: number) => plotTop + (1 - (v - lo) / range) * plotHeight
  const xOf = (i: number, n: number) => (n <= 1 ? width / 2 : padSide + (i / (n - 1)) * (width - padSide * 2))

  if (options.grid) {
    ctx.strokeStyle = toSrgb(t.gridLine)
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let g = 0; g < 4; g += 1) {
      const y = Math.round(plotTop + (plotHeight * g) / 3) + 0.5
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
    }
    ctx.stroke()
  }

  // Zero axis — the compare domain crosses zero; a from-zero domain sits on it.
  if (lo < 0 && 0 < hi) {
    ctx.strokeStyle = toSrgb(withAlpha(t.ink3, 0.4))
    ctx.lineWidth = 1
    ctx.beginPath()
    const y = Math.round(yOf(0)) + 0.5
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }

  for (const s of series) {
    const n = s.values.length
    if (n === 0) continue
    const rgb = toSrgb(s.color)

    if (options.fill) {
      // The gradient fades from the curve's own high point down to the plot
      // floor, so a low-riding series keeps a visible wash under its line.
      let seriesTop = plotBottom
      for (let i = 0; i < n; i += 1) seriesTop = Math.min(seriesTop, yOf(s.values[i]))
      const gradient = ctx.createLinearGradient(0, seriesTop, 0, plotBottom)
      gradient.addColorStop(0, toSrgb(withAlpha(s.color, 0.18)))
      gradient.addColorStop(1, toSrgb(withAlpha(s.color, 0)))
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.moveTo(xOf(0, n), yOf(s.values[0]))
      for (let i = 1; i < n; i += 1) ctx.lineTo(xOf(i, n), yOf(s.values[i]))
      ctx.lineTo(xOf(n - 1, n), plotBottom)
      ctx.lineTo(xOf(0, n), plotBottom)
      ctx.closePath()
      ctx.fill()
    }

    ctx.strokeStyle = rgb
    ctx.lineWidth = LINE_WIDTH
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.beginPath()
    ctx.moveTo(xOf(0, n), yOf(s.values[0]))
    for (let i = 1; i < n; i += 1) ctx.lineTo(xOf(i, n), yOf(s.values[i]))
    ctx.stroke()

    // End dot — liveline's latest-value marker, minus the pulse.
    const endX = xOf(n - 1, n)
    const endY = yOf(s.values[n - 1])
    ctx.fillStyle = rgb
    ctx.beginPath()
    ctx.arc(endX, endY, 3.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = toSrgb(t.inset)
    ctx.beginPath()
    ctx.arc(endX, endY, 1.2, 0, Math.PI * 2)
    ctx.fill()
  }
}

interface ChartTooltipRow {
  value: string
  color: string
}

/* ── The chart stage: canvas + hover cursor + tooltip ────
 * Hover state lives here; the card formats tooltip rows and mirrors the
 * hovered index for its header label. */

const ChartStage = defineComponent({
  name: "BuiInsightChartStage",
  props: {
    series: { type: Array as PropType<ChartSeriesData[]>, required: true },
    grid: { type: Boolean, default: false },
    fill: { type: Boolean, default: true },
    domainFromZero: { type: Boolean, default: false },
    crosshair: { type: Boolean, default: false },
    /** Fixed tooltip box width — centers the clamped anchor via marginLeft. */
    tooltipWidth: { type: Number, required: true },
    formatTooltip: { type: Function as PropType<(index: number) => ChartTooltipRow[]>, required: true },
    onHover: { type: Function as PropType<(index: number | null) => void>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    const stage = ref<HostNode | null>(null)
    const canvas = ref<GpuixCanvasInstance | null>(null)
    const { bounds } = useElementBounds(stage)
    const hoverIndex = ref<number | null>(null)

    const width = computed(() => Math.max(2, Math.round(bounds.value?.width ?? 320)))

    const draw = () => {
      const ctx = canvas.value?.getContext("2d")
      if (!ctx) return
      drawLineChart(
        ctx,
        width.value,
        STAGE_HEIGHT,
        props.series,
        { grid: props.grid, fill: props.fill, domainFromZero: props.domainFromZero },
        theme.tokens.value,
      )
    }

    /* A buffer resize clears the bitmap after GpuixCanvas's own watcher —
     * every redraw is repeated one task later so a resize never lands blank. */
    let redrawTimer: ReturnType<typeof setTimeout> | undefined
    const scheduleDraw = () => {
      draw()
      if (redrawTimer !== undefined) clearTimeout(redrawTimer)
      redrawTimer = setTimeout(() => {
        redrawTimer = undefined
        draw()
      }, 0)
    }
    onBeforeUnmount(() => {
      if (redrawTimer !== undefined) clearTimeout(redrawTimer)
    })

    /* Redraw on size or data change only — a scroll translates the canvas
     * without resizing it, and re-uploading pixels every bounds poll made
     * scrolling expensive. */
    watch(
      [() => [bounds.value?.width, bounds.value?.height], () => props.series, () => theme.tokens.value],
      scheduleDraw,
      { immediate: true },
    )

    const pointCount = computed(() => props.series[0]?.values.length ?? 0)

    const setHoverFromEvent = (event: EventPayload) => {
      const box = bounds.value
      const count = pointCount.value
      if (!box || count < 2) return
      const progress = Math.min(1, Math.max(0, ((event.x ?? 0) - box.x) / box.width))
      const next = Math.round(progress * (count - 1))
      if (next !== hoverIndex.value) {
        hoverIndex.value = next
        props.onHover?.(next)
      }
    }

    const clearHover = () => {
      if (hoverIndex.value !== null) {
        hoverIndex.value = null
        props.onHover?.(null)
      }
    }

    return () => {
      const t = theme.tokens.value
      const idx = hoverIndex.value
      const count = pointCount.value
      const fraction = idx !== null && count > 1 ? idx / (count - 1) : 0
      // left/top are px-only in GPUIV — positions derive from the measured
      // stage width instead of CSS percentages.
      return (
        <div ref={stage} style={{ position: "relative", height: STAGE_HEIGHT, overflow: "hidden" }}>
          <GpuixCanvas
            ref={canvas}
            width={width.value * RENDER_SCALE}
            height={STAGE_HEIGHT * RENDER_SCALE}
            style={{ width: "100%", height: STAGE_HEIGHT, cursor: props.crosshair ? "crosshair" : "default" }}
            // GpuixCanvas's declared props leave no attr slots for testId or
            // mouse handlers in TS; the spread form skips excess-property
            // checking (the Button pattern) — attrs still reach the canvas.
            {...{
              testId: "insight-chart",
              onMouseDown: setHoverFromEvent,
              onMouseMove: setHoverFromEvent,
              onMouseUp: clearHover,
              onMouseLeave: clearHover,
            }}
          />
          {idx !== null && count > 1 ? (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: Math.round(fraction * (width.value - 1)),
                width: 1,
                backgroundColor: t.ink,
                opacity: 0.26,
                pointerEvents: "none",
              }}
            />
          ) : null}
          {idx !== null && count > 1 ? (
            <div
              style={{
                position: "absolute",
                top: 8,
                left: Math.round(Math.min(Math.max(fraction, 0.28), 0.72) * width.value),
                width: 0,
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  width: props.tooltipWidth,
                  marginLeft: -props.tooltipWidth / 2,
                  paddingTop: 5,
                  paddingBottom: 5,
                  paddingLeft: 9,
                  paddingRight: 9,
                  ...theme.shadows.value.overlay,
                  borderColor: t.lineStrong,
                  borderRadius: radius.control,
                  backgroundColor: t.tooltipBg,
                }}
              >
                {props.formatTooltip(idx).map((row, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: row.color, flexShrink: 0 }} />
                    <div style={{ fontSize: 11.5, color: t.tooltipFg, whiteSpace: "nowrap" }}>{row.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )
    }
  },
})

/* ── Demo data ─────────────────────────────────────────── */

export interface CompareSeries {
  name: string
  values: number[]
  sub: string
  tone: "red" | "green"
  /** Semantic stroke/dot colour — the original's hex + class trio. */
  color: "orange" | "accent"
}

const COMPARE_SERIES: CompareSeries[] = [
  {
    name: "Mint Chip",
    values: [-2.9, -3.4, -3.05, -3.86, -3.52, -4.1, -3.82, -4.41],
    sub: "-$2,377.66",
    tone: "red",
    color: "orange",
  },
  {
    name: "Pistachio",
    values: [0.22, 0.58, 0.42, 0.91, 0.76, 1.08, 0.96, 1.15],
    sub: "+$617.22",
    tone: "green",
    color: "accent",
  },
]

export interface AnomalyData {
  spend: number[]
  usage: number[]
}

const ANOMALY_DATA: AnomalyData = {
  spend: [274, 289, 264, 307, 331, 1210, 1718, 2112],
  usage: [18, 19, 17, 21, 22, 58, 81, 96],
}

export type AllocationColor = "orange" | "lineStrong" | "line"
export type AllocationTone = "orange" | "ink2" | "ink3"

export interface AllocationSegment {
  name: string
  label: string
  pct: number
  amount: string
  color: AllocationColor
  tone: AllocationTone
}

const ALLOCATION_SEGMENTS: AllocationSegment[] = [
  { name: "VAN", label: "Vanilla", pct: 72.5, amount: "$51,785", color: "orange", tone: "orange" },
  { name: "CHOC", label: "Chocolate", pct: 22.8, amount: "$16,278", color: "lineStrong", tone: "ink2" },
  { name: "MINT", label: "Mint", pct: 4.7, amount: "$3,357", color: "line", tone: "ink3" },
]

/* ── 1 — return comparison ─────────────────────────────── */

export const InsightCompareCard = defineComponent({
  name: "BuiInsightCompareCard",
  props: {
    series: { type: Array as PropType<CompareSeries[]>, default: () => COMPARE_SERIES },
  },
  setup(props) {
    const theme = useTheme()

    const points = computed(() => props.series.map((s) => smoothValues(s.values)))
    const chartSeries = computed<ChartSeriesData[]>(() =>
      props.series.map((s, i) => ({ color: theme.tokens.value[s.color], values: points.value[i] })),
    )
    const lastPercent = (i: number) => formatPercent(points.value[i]?.at(-1) ?? props.series[i]?.values.at(-1) ?? 0)

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      return (
        <div style={{ minHeight: 278, borderRadius: radius.card, backgroundColor: t.surface, padding: 12, ...shadows.hairline }}>
          {/* legend — one column per series */}
          <div style={{ display: "flex", gap: 16 }}>
            {props.series.map((s, i) => (
              <div key={s.name} style={{ flexGrow: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: t.ink2 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t[s.color], flexShrink: 0 }} />
                  {s.name}
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontSize: 17,
                    fontWeight: 600,
                    color: s.tone === "red" ? t.red : t.green,
                  }}
                >
                  {lastPercent(i)}
                </div>
                <div
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 11.5,
                    color: s.tone === "red" ? t.red : t.green,
                  }}
                >
                  {s.sub}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, overflow: "hidden", borderRadius: radius.control, backgroundColor: t.inset, ...shadows.hairline }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottomWidth: 1,
                borderColor: t.line,
                paddingLeft: 10,
                paddingRight: 10,
                paddingTop: 6,
                paddingBottom: 6,
              }}
            >
              <div style={{ fontSize: 11, color: t.ink3 }}>Trend snapshot</div>
              <div
                style={{
                  borderRadius: radius.pill,
                  backgroundColor: t.field,
                  paddingLeft: 8,
                  paddingRight: 8,
                  paddingTop: 2,
                  paddingBottom: 2,
                  fontSize: 10.5,
                  fontWeight: 500,
                  color: t.ink2,
                }}
              >
                Snapshot
              </div>
            </div>
            <ChartStage
              series={chartSeries.value}
              fill
              tooltipWidth={150}
              formatTooltip={(index: number) =>
                props.series.map((s, i) => ({
                  value: formatPercent(points.value[i]?.[index] ?? 0),
                  color: t[s.color],
                }))
              }
            />
          </div>
        </div>
      )
    }
  },
})

/* ── 2 — anomaly ───────────────────────────────────────── */

const ANOMALY_THRESHOLDS = { spend: "$2,112", usage: "82 kWh" } as const

export const InsightAnomalyCard = defineComponent({
  name: "BuiInsightAnomalyCard",
  props: {
    data: { type: Object as PropType<AnomalyData>, default: () => ANOMALY_DATA },
  },
  setup(props) {
    const theme = useTheme()
    const metric = ref<"spend" | "usage">("spend")
    const hoverIndex = ref<number | null>(null)

    const chartSeries = computed<ChartSeriesData[]>(() => [
      { color: theme.tokens.value.red, values: props.data[metric.value] },
    ])
    const formatValue = (v: number) => (metric.value === "spend" ? formatMoney(v) : `${Math.round(v)} kWh`)
    const moneyLabel = formatMoney(props.data.spend.at(-1) ?? 2112)

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const data = props.data[metric.value]
      const headerLabel =
        hoverIndex.value !== null && data[hoverIndex.value] !== undefined
          ? formatValue(data[hoverIndex.value])
          : `${ANOMALY_THRESHOLDS[metric.value]} threshold`
      return (
        <div style={{ minHeight: 278, borderRadius: radius.card, backgroundColor: t.surface, padding: 12, ...shadows.hairline }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, color: t.ink }}>
              <Icon name="arrowUp" size={12} color={t.red} />
              High freezer spend
            </div>
            <div
              style={{
                borderRadius: radius.pill,
                backgroundColor: t.field,
                paddingLeft: 8,
                paddingRight: 8,
                paddingTop: 2,
                paddingBottom: 2,
                fontSize: 10.5,
                fontWeight: 500,
                color: t.ink2,
              }}
            >
              Snapshot
            </div>
          </div>
          <div style={{ marginTop: 8, overflow: "hidden", borderRadius: radius.control, backgroundColor: t.inset, ...shadows.hairline }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottomWidth: 1,
                borderColor: t.line,
                paddingLeft: 10,
                paddingRight: 10,
                paddingTop: 6,
                paddingBottom: 6,
              }}
            >
              <div style={{ fontSize: 11, color: t.ink3 }}>{headerLabel}</div>
              <div style={{ display: "flex", borderRadius: radius.pill, backgroundColor: t.field, padding: 2 }}>
                {(["spend", "usage"] as const).map((item) => {
                  const on = metric.value === item
                  return (
                    <div
                      key={item}
                      role="button"
                      testId={`insight-metric-${item}`}
                      onClick={() => {
                        metric.value = item
                      }}
                      style={{
                        borderRadius: radius.pill,
                        paddingLeft: 8,
                        paddingRight: 8,
                        paddingTop: 2,
                        paddingBottom: 2,
                        fontSize: 10.5,
                        fontWeight: 500,
                        cursor: "pointer",
                        ...(on
                          ? { backgroundColor: t.surface, color: t.ink, ...shadows.btn }
                          : { color: t.ink3, hover: { color: t.ink2 } }),
                      }}
                    >
                      {item === "spend" ? "Spend" : "Usage"}
                    </div>
                  )
                })}
              </div>
            </div>
            <ChartStage
              series={chartSeries.value}
              grid
              fill={false}
              domainFromZero
              crosshair
              tooltipWidth={92}
              onHover={(index: number | null) => {
                hoverIndex.value = index
              }}
              formatTooltip={(index: number) => [{ value: formatValue(data[index] ?? 0), color: t.red }]}
            />
          </div>
          <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: t.ink }}>{`${moneyLabel} spent`}</div>
            <div style={{ fontFamily: fonts.mono, fontSize: 11.5, color: t.red }}>+$1,834.66</div>
            <div style={{ fontSize: 11, color: t.ink3 }}>vs 3 months</div>
          </div>
        </div>
      )
    }
  },
})

/* ── 3 — allocation ────────────────────────────────────── */

export const InsightAllocationCard = defineComponent({
  name: "BuiInsightAllocationCard",
  props: {
    segments: { type: Array as PropType<AllocationSegment[]>, default: () => ALLOCATION_SEGMENTS },
  },
  setup(props) {
    const theme = useTheme()
    const selected = ref(props.segments[0]?.name ?? "")
    const bar = ref<HostNode | null>(null)
    const { bounds: barBounds } = useElementBounds(bar)

    /* The gloss tween needs pixels; the segments themselves are %-wide. */
    const segmentWidths = computed(() => {
      const w = barBounds.value?.width
      if (w == null) return null
      const available = w - 4 /* bar padding */ - (props.segments.length - 1) * 2 /* gaps */
      const total = props.segments.reduce((sum, s) => sum + s.pct, 0) || 100
      return props.segments.map((s) => (available * s.pct) / total)
    })

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const active = props.segments.find((segment) => segment.name === selected.value) ?? props.segments[0]
      const segmentColor: Record<AllocationColor, string> = {
        orange: t.orange,
        lineStrong: t.lineStrong,
        line: t.line,
      }
      const toneColor: Record<AllocationTone, string> = { orange: t.orange, ink2: t.ink2, ink3: t.ink3 }
      return (
        <div style={{ minHeight: 278, borderRadius: radius.card, backgroundColor: t.surface, padding: 12, ...shadows.hairline }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, color: t.ink }}>
            <div
              style={{
                display: "flex",
                width: 14,
                height: 14,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 7,
                backgroundColor: t.orange,
                fontSize: 8,
                fontWeight: 700,
                color: "#ffffff",
              }}
            >
              V
            </div>
            Vanilla allocation
          </div>
          <div style={{ marginTop: 4, fontSize: 20, fontWeight: 600, color: t.ink }}>{active?.amount}</div>
          <div
            ref={bar}
            testId="insight-alloc-bar"
            style={{
              marginTop: 12,
              display: "flex",
              height: 36,
              gap: 2,
              overflow: "hidden",
              borderRadius: radius.pill,
              backgroundColor: t.field,
              padding: 2,
            }}
          >
            {props.segments.map((s, i) => {
              const isSelected = s.name === selected.value
              return (
                <motion.div
                  key={s.name}
                  {...{
                    testId: `insight-segment-${s.name}`,
                    onClick: () => {
                      selected.value = s.name
                    },
                  }}
                  animate={{ opacity: isSelected ? 1 : 0.58 }}
                  transition={{ duration: 0.3, ease: ease.link }}
                  style={{
                    position: "relative",
                    height: "100%",
                    overflow: "hidden",
                    borderRadius: radius.pill,
                    width: `${s.pct}%`,
                    flexShrink: 0,
                    backgroundColor: segmentColor[s.color],
                    cursor: "pointer",
                    ...(isSelected ? { borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.22)" } : {}),
                  }}
                >
                  <motion.div
                    animate={{
                      width: isSelected ? Math.max(0, (segmentWidths.value?.[i] ?? 0) - 8) : 0,
                      opacity: isSelected ? 1 : 0,
                    }}
                    transition={{ duration: 0.5, ease: ease.link }}
                    style={{
                      position: "absolute",
                      left: 4,
                      top: 4,
                      bottom: 4,
                      borderRadius: radius.pill,
                      backgroundColor: "rgba(255, 255, 255, 0.2)",
                    }}
                  />
                </motion.div>
              )
            })}
          </div>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
            {props.segments.map((s) => {
              const isSelected = s.name === selected.value
              return (
                <div
                  key={s.name}
                  role="button"
                  testId={`insight-legend-${s.name}`}
                  onClick={() => {
                    selected.value = s.name
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    borderRadius: radius.pill,
                    paddingLeft: 6,
                    paddingRight: 6,
                    paddingTop: 2,
                    paddingBottom: 2,
                    fontSize: 11,
                    cursor: "pointer",
                    ...(isSelected
                      ? { backgroundColor: t.field, color: t.ink }
                      : { color: t.ink2, hover: { backgroundColor: t.hover, color: t.ink } }),
                  }}
                >
                  <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: segmentColor[s.color], flexShrink: 0 }} />
                  {`${s.name} ${s.pct}%`}
                </div>
              )
            })}
          </div>
          <div
            style={{
              marginTop: 12,
              minHeight: 64,
              borderRadius: radius.control,
              backgroundColor: t.inset,
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 8,
              paddingBottom: 8,
              ...shadows.hairline,
            }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 500, color: active ? toneColor[active.tone] : t.ink2 }}>
              {active?.label}
            </div>
            <div style={{ marginTop: 4, fontSize: 11, lineHeight: 18, color: t.ink3 }}>
              Contribution snapshot across current inventory value. Segment selection changes the inspected group without moving the card.
            </div>
          </div>
        </div>
      )
    }
  },
})

/* ── The carousel ──────────────────────────────────────── */

/** One piece of the prose lead-in: a text run, an inline @entity mention, a
 *  mono code span, or an emphasised run (the RecommendationCard pattern —
 *  GPUIV has no inline flow). */
export type InsightProseSegment =
  | string
  | { entity: string; tone?: "orange" | "accent" }
  | { mono: string; tone: "red" | "green" }
  | { strong: string }

export interface InsightPage {
  key: string
  prose: InsightProseSegment[]
  card: Component
  pill: string
}

const DEFAULT_PAGES: InsightPage[] = [
  {
    key: "compare",
    prose: [
      "The worst performer in your",
      { entity: "Creamery", tone: "orange" },
      "is Rocky Road — down",
      { mono: "-6%", tone: "red" },
      "or",
      { mono: "-$2,453.44", tone: "red" },
      ".",
    ],
    card: InsightCompareCard,
    pill: "Should I rebalance flavors?",
  },
  {
    key: "anomaly",
    prose: [
      "Unusually high freezer bill on",
      { strong: "Dec 13" },
      "—",
      { mono: "+$1,834.66", tone: "red" },
      "above your average.",
    ],
    card: InsightAnomalyCard,
    pill: "Get tips on cutting freezer costs",
  },
  {
    key: "allocation",
    prose: [
      "You’re heavily invested in",
      { entity: "Vanilla", tone: "orange" },
      "— it’s",
      { strong: "72.5%" },
      "of your case.",
    ],
    card: InsightAllocationCard,
    pill: "If we look at seasonals, what changes?",
  },
]

export interface InsightCardsLabels {
  /** Carousel heading shown before the page count. */
  title: string
}

const DEFAULT_LABELS: InsightCardsLabels = {
  title: "Insights",
}

export const InsightCards = defineComponent({
  name: "BuiInsightCards",
  props: {
    pages: { type: Array as PropType<InsightPage[]>, default: () => DEFAULT_PAGES },
    labels: { type: Object as PropType<Partial<InsightCardsLabels>>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    const copy = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }))
    const page = ref(0)

    const move = (direction: -1 | 1) => {
      page.value = (page.value + direction + props.pages.length) % props.pages.length
    }

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const current = props.pages[Math.min(page.value, props.pages.length - 1)]
      if (!current) return <div />

      const renderSegment = (segment: InsightProseSegment, i: number) => {
        if (typeof segment === "string") {
          return (
            <div key={i} style={{ fontSize: 12.5, lineHeight: 20, color: t.ink2 }}>
              {segment}
            </div>
          )
        }
        if ("entity" in segment) {
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: segment.tone === "accent" ? t.accent : t.orange,
                  flexShrink: 0,
                }}
              />
              <div style={{ fontSize: 12.5, fontWeight: 500, color: t.ink }}>{`@${segment.entity}`}</div>
            </div>
          )
        }
        if ("mono" in segment) {
          return (
            <div
              key={i}
              style={{
                flexShrink: 0,
                fontFamily: fonts.mono,
                fontSize: 11.5,
                color: segment.tone === "red" ? t.red : t.green,
              }}
            >
              {segment.mono}
            </div>
          )
        }
        return (
          <div key={i} style={{ fontSize: 12.5, fontWeight: 500, color: t.ink }}>
            {segment.strong}
          </div>
        )
      }

      const Card = current.card
      return (
        <div testId="insight-root" style={{ display: "flex", flexDirection: "column", minHeight: 408, width: "100%", maxWidth: 344 }}>
          {/* pager header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.ink }}>{copy.value.title}</div>
              <div style={{ fontSize: 13, color: t.ink3 }}>{props.pages.length}</div>
            </div>
            <div style={{ display: "flex", gap: 2 }}>
              {(
                [
                  { icon: "chevronLeft" as const, testId: "insight-prev", direction: -1 as const },
                  { icon: "chevronRight" as const, testId: "insight-next", direction: 1 as const },
                ]
              ).map((button) => (
                <div
                  key={button.testId}
                  role="button"
                  testId={button.testId}
                  onClick={() => {
                    move(button.direction)
                  }}
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
                  <Icon name={button.icon} size={13} color={t.ink3} />
                </div>
              ))}
            </div>
          </div>

          {/* page content */}
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                columnGap: 4,
                rowGap: 2,
              }}
            >
              {current.prose.map(renderSegment)}
            </div>
            <div style={{ marginTop: 8 }}>{h(Card)}</div>
            <div
              role="button"
              testId="insight-pill"
              style={{
                marginTop: 8,
                alignSelf: "flex-start",
                borderRadius: radius.pill,
                backgroundColor: t.surface,
                paddingLeft: 12,
                paddingRight: 12,
                paddingTop: 6,
                paddingBottom: 6,
                fontSize: 12,
                color: t.ink,
                cursor: "pointer",
                ...shadows.btn,
                hover: { backgroundColor: t.hover },
              }}
            >
              {current.pill}
            </div>
          </div>
        </div>
      )
    }
  },
})
