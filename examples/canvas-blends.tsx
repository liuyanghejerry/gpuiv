/**
 * Blend modes demo — a canvas grid painting the same backdrop/layer pair
 * through every W3C `globalCompositeOperation` blend, with the four
 * non-separable modes (hue / saturation / color / luminosity) called out.
 * Click any swatch to cycle its backdrop colour.
 */

import { defineComponent, onMounted, ref, watch } from "vue"
import {
  GpuixCanvas,
  createApp,
  type GpuixCanvasInstance,
  type GpuixCanvasRenderingContext2D,
} from "@gpuiv/vue"

const CELL = 108

const NON_SEPARABLE = ["hue", "saturation", "color", "luminosity"] as const
const SEPARABLE = ["multiply", "screen", "overlay", "difference"] as const

const BACKDROPS = ["#89b4fa", "#f38ba8", "#a6e3a1", "#f9e2af"]

function paintCell(ctx: GpuixCanvasRenderingContext2D, mode: string, backdrop: string): void {
  ctx.globalCompositeOperation = "source-over"
  ctx.fillStyle = backdrop
  ctx.fillRect(0, 0, CELL, CELL)
  // The blended layer: a warm circle over a cool diagonal.
  ctx.globalCompositeOperation = mode as never
  ctx.fillStyle = "#fab387"
  ctx.beginPath()
  ctx.arc(CELL * 0.65, CELL * 0.4, CELL * 0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = "#11111b"
  ctx.fillRect(CELL * 0.1, CELL * 0.55, CELL * 0.5, CELL * 0.12)
  ctx.globalCompositeOperation = "source-over"
}

const BlendCell = defineComponent({
  props: {
    mode: { type: String, required: true },
    backdrop: { type: String, required: true },
  },
  setup(props) {
    const canvas = ref<GpuixCanvasInstance | null>(null)

    function repaint(): void {
      const ctx = canvas.value?.getContext("2d")
      if (ctx) paintCell(ctx, props.mode, props.backdrop)
    }

    onMounted(repaint)
    watch(
      () => props.backdrop,
      () => repaint()
    )

    return () => (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        <GpuixCanvas ref={canvas} width={CELL} height={CELL} style={{ width: CELL, height: CELL, borderRadius: 10 }} />
        <text testId={`blend-label-${props.mode}`} style={{ color: "#a6adc8", fontSize: 12 }}>
          {props.mode}
        </text>
      </div>
    )
  },
})

const CanvasBlends = defineComponent({
  setup() {
    const backdropIndex = ref(0)
    const backdrop = ref(BACKDROPS[0])

    function cycle(): void {
      backdropIndex.value = (backdropIndex.value + 1) % BACKDROPS.length
      backdrop.value = BACKDROPS[backdropIndex.value]
    }

    return () => (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: 28,
          width: "100%",
          height: "100%",
          backgroundColor: "#11111b",
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", gap: 16, alignItems: "center" }}>
          <text style={{ color: "#cdd6f4", fontSize: 18, fontWeight: "bold" }}>Blend modes</text>
          <div
            testId="blend-cycle"
            style={{
              padding: 8,
              paddingLeft: 16,
              paddingRight: 16,
              backgroundColor: "#89b4fa",
              borderRadius: 8,
              cursor: "pointer",
            }}
            onClick={cycle}
          >
            <text testId="blend-backdrop" style={{ color: "#1e1e2e", fontSize: 13, fontWeight: "bold" }}>
              backdrop: {backdrop.value}
            </text>
          </div>
        </div>

        <text style={{ color: "#fab387", fontSize: 14, fontWeight: "bold" }}>
          Non-separable (new in #87)
        </text>
        <div style={{ display: "flex", flexDirection: "row", gap: 18 }}>
          {NON_SEPARABLE.map((mode) => (
            <BlendCell key={mode} mode={mode} backdrop={backdrop.value} />
          ))}
        </div>

        <text style={{ color: "#a6adc8", fontSize: 14 }}>Separable (for comparison)</text>
        <div style={{ display: "flex", flexDirection: "row", gap: 18 }}>
          {SEPARABLE.map((mode) => (
            <BlendCell key={mode} mode={mode} backdrop={backdrop.value} />
          ))}
        </div>

        <text style={{ color: "#6c7086", fontSize: 12, width: 520 }}>
          The non-separable operators mix colour channels through the W3C
          luminance/saturation helpers — hue takes the layer's hue at the
          backdrop's luminance, luminosity the reverse.
        </text>
      </div>
    )
  },
})

const App = defineComponent({
  setup() {
    return () => (
      <div style={{ width: "100%", height: "100%", backgroundColor: "#11111b" }}>
        <CanvasBlends />
      </div>
    )
  },
})

export { App, CanvasBlends, paintCell }

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("canvas-blends.tsx")

if (isEntryPoint) {
  createApp(App, {
    title: "GPUIV Canvas Blends",
    width: 880,
    height: 640,
    focus: process.env.GPUIX_BACKGROUND !== "1",
  })
}
