/**
 * GPUIV canvas paint example — a small drawing pad on the 2D context.
 *
 * Pointer note: mouse events carry WINDOW coordinates, and the FFI has no
 * element-local offset yet (that needs a native payload field). The pad
 * therefore anchors drawing to the first press: the first mouseDown picks
 * where the canvas origin sits, and every move is drawn relative to it.
 * Precision painting comes back once EventPayload grows offsetX/offsetY.
 */

import { onMounted, ref, defineComponent } from "vue"
import {
  GpuixCanvas,
  createApp,
  type GpuixCanvasInstance,
  type GpuixCanvasRenderingContext2D,
  type EventPayload,
} from "@gpuiv/vue"

const WIDTH = 560
const HEIGHT = 400

const COLORS = ["#1e1e2e", "#f38ba8", "#a6e3a1", "#89b4fa", "#f5c2e7"] as const

const CanvasPaint = defineComponent({
  setup() {
    const canvas = ref<GpuixCanvasInstance | null>(null)
    const color = ref<string>(COLORS[0])
    const width = ref(6)
    const drawing = ref(false)
    let ctx: GpuixCanvasRenderingContext2D | null = null
    let anchorX = 0
    let anchorY = 0
    let lastX = 0
    let lastY = 0

    // Where the canvas origin lands for the current stroke. The middle of
    // the pad is a comfortable default; the first press of each stroke
    // re-anchors it under the cursor.
    let originX = WIDTH / 2
    let originY = HEIGHT / 2

    function context(): GpuixCanvasRenderingContext2D | null {
      if (!ctx) ctx = canvas.value?.getContext("2d") ?? null
      return ctx
    }

    function clear(): void {
      const c = context()
      if (!c) return
      c.fillStyle = "#ffffff"
      c.fillRect(0, 0, WIDTH, HEIGHT)
    }

    function segment(fromX: number, fromY: number, toX: number, toY: number): void {
      const c = context()
      if (!c) return
      c.strokeStyle = color.value
      c.lineWidth = width.value
      c.lineCap = "round"
      c.lineJoin = "round"
      c.beginPath()
      c.moveTo(fromX, fromY)
      c.lineTo(toX, toY)
      c.stroke()
    }

    function gradientScene(): void {
      const c = context()
      if (!c) return
      clear()
      const sky = c.createLinearGradient(0, 0, WIDTH, HEIGHT)
      sky.addColorStop(0, "#1e1e2e")
      sky.addColorStop(1, "#3b2f63")
      c.fillStyle = sky
      c.fillRect(0, 0, WIDTH, HEIGHT)

      c.save()
      c.beginPath()
      c.roundRect(40, 40, WIDTH - 80, HEIGHT - 80, 24)
      c.clip()
      const glow = c.createRadialGradient(WIDTH / 2, 120, 10, WIDTH / 2, 120, 180)
      glow.addColorStop(0, "#f5c2e7")
      glow.addColorStop(1, "#1e1e2e")
      c.fillStyle = glow
      c.fillRect(0, 0, WIDTH, HEIGHT)
      c.restore()

      c.strokeStyle = "#89dceb"
      c.lineWidth = 3
      c.setLineDash([10, 6])
      c.beginPath()
      c.roundRect(40, 40, WIDTH - 80, HEIGHT - 80, 24)
      c.stroke()
      c.setLineDash([])

      c.fillStyle = "#a6e3a1"
      c.beginPath()
      c.arc(WIDTH / 2, 250, 60, 0, Math.PI * 2)
      c.fill()
      c.strokeStyle = "#f38ba8"
      c.lineWidth = 6
      c.beginPath()
      c.arc(WIDTH / 2, 250, 80, Math.PI * 0.75, Math.PI * 1.9)
      c.stroke()
    }

    function onMouseDown(event: EventPayload): void {
      const x = event.x ?? 0
      const y = event.y ?? 0
      anchorX = x
      anchorY = y
      originX = WIDTH / 2
      originY = HEIGHT / 2
      lastX = originX
      lastY = originY
      drawing.value = true
    }

    function onMouseMove(event: EventPayload): void {
      if (!drawing.value) return
      const x = originX + ((event.x ?? 0) - anchorX)
      const y = originY + ((event.y ?? 0) - anchorY)
      segment(lastX, lastY, x, y)
      lastX = x
      lastY = y
    }

    function onMouseUp(): void {
      drawing.value = false
    }

    onMounted(() => {
      gradientScene()
    })

    const swatch = (c: string) => (
      <div
        key={c}
        testId={`swatch-${c.slice(1)}`}
        onClick={() => {
          color.value = c
        }}
        style={{
          width: 28,
          height: 28,
          backgroundColor: c,
          borderRadius: 8,
          cursor: "pointer",
          borderWidth: color.value === c ? 2 : 0,
          borderColor: "#89b4fa",
        }}
      />
    )

    return () => (
      <div style={{ display: "flex", width: "100%", height: "100%", backgroundColor: "#11111b" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 16,
            width: 120,
            height: "100%",
          }}
        >
          <text style={{ color: "#cdd6f4", fontSize: 14 }}>Canvas paint</text>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, width: 88 }}>
            {COLORS.map(swatch)}
          </div>
          <div
            testId="brush-wide"
            onClick={() => {
              width.value = width.value === 6 ? 14 : 6
            }}
            style={{
              padding: 8,
              backgroundColor: "#313244",
              borderRadius: 8,
              cursor: "pointer",
              color: "#bac2de",
              fontSize: 12,
            }}
          >
            Brush: {width.value}
          </div>
          <div
            testId="gradient-demo"
            onClick={gradientScene}
            style={{
              padding: 8,
              backgroundColor: "#313244",
              borderRadius: 8,
              cursor: "pointer",
              color: "#bac2de",
              fontSize: 12,
            }}
          >
            Gradient demo
          </div>
          <div
            testId="clear-canvas"
            onClick={clear}
            style={{
              padding: 8,
              backgroundColor: "#313244",
              borderRadius: 8,
              cursor: "pointer",
              color: "#bac2de",
              fontSize: 12,
            }}
          >
            Clear
          </div>
        </div>
        <GpuixCanvas
          ref={canvas}
          testId="paint-canvas"
          width={WIDTH}
          height={HEIGHT}
          style={{ width: WIDTH, height: HEIGHT, margin: 20 }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
        />
      </div>
    )
  },
})

const App = defineComponent({
  setup() {
    return () => <CanvasPaint />
  },
})

export { App, CanvasPaint }

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("canvas-paint.tsx")

if (isEntryPoint) {
  createApp(App, {
    title: "GPUIV Canvas Paint",
    width: 720,
    height: 460,
    // Agent checks need real GPU paint, not control of the user's keyboard.
    focus: process.env.GPUIX_BACKGROUND !== "1",
  })
}
