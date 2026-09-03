/**
 * GPUIV Paint — a drawing application on the 2D canvas context.
 *
 * Coordinates: mouse events carry WINDOW coordinates and the FFI has no
 * element-local offset yet (no offsetX/offsetY in EventPayload). The canvas
 * therefore sits at the window origin and wraps the window size: window x/y
 * ARE canvas x/y, and the toolbar floats over the canvas as a
 * pointer-events:"none" surface whose buttons re-enable their own hitboxes.
 *
 * The root is sized with explicit top/left/width/height — GPUIV has no CSS
 * `inset` shorthand, and an `inset: 0` div resolves to zero size, so its
 * background never paints. That matters double here: the erased
 * (transparent) pixels of the canvas show whatever sits underneath it,
 * which is this white root.
 *
 * The buffer is fixed at 800x600 (the window's default) rather than tracking
 * `useWindowSize()`: the test renderer has no `getWindowSize`, so the hook
 * falls back to 800x600 anyway, and a fixed buffer keeps demo and tests on
 * identical coordinates. A window resize simply leaves the canvas in place.
 *
 * Architecture notes:
 * - Undo snapshots are `ImageData` objects, stored `markRaw`ed — the undo
 *   stack lives in a reactive ref, and a deep proxy around `ImageData`
 *   breaks its private field access inside `putImageData`.
 * - Shape previews restore the press-time snapshot with `putImageData` per
 *   mousemove, so a drag never paints dirty overlap.
 * - The eraser paints `destination-out` and restores the composite mode
 *   after, so the rest of the app never sees it.
 */

import { defineComponent, markRaw, onMounted, ref } from "vue"
import {
  GpuixCanvas,
  createApp,
  type EventPayload,
  type GpuixCanvasInstance,
  type GpuixCanvasRenderingContext2D,
  type GpuixImageData,
} from "@gpuiv/vue"

const WIDTH = 800
const HEIGHT = 600

type Tool = "brush" | "eraser" | "line" | "rect" | "ellipse"
type FillMode = "stroke" | "fill" | "both"

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: "brush", label: "Brush" },
  { id: "eraser", label: "Eraser" },
  { id: "line", label: "Line" },
  { id: "rect", label: "Rect" },
  { id: "ellipse", label: "Ellipse" },
]

const PALETTE = [
  "#11111b", "#d20f39", "#f38ba8", "#fab387",
  "#fe640b", "#f9e2af", "#a6e3a1", "#94e2d5",
  "#89b4fa", "#cba6f7", "#f5c2e7", "#ffffff",
] as const

const BRUSH_SIZES = [2, 4, 8, 16, 32] as const

const MAX_UNDO = 24
const GRID_STEP = 20
const GRID_COLOR = "#e7e7e7"

const FILL_MODE_LABEL: Record<FillMode, string> = {
  stroke: "Stroke",
  fill: "Fill",
  both: "Fill+Stroke",
}

export const Paint = defineComponent({
  setup() {
    const canvas = ref<GpuixCanvasInstance | null>(null)

    const tool = ref<Tool>("brush")
    const color = ref<string>(PALETTE[0])
    const brushWidth = ref(6)
    const fillMode = ref<FillMode>("stroke")
    const gridOn = ref(true)
    const cursor = ref<{ x: number; y: number } | null>(null)
    const undoStack = ref<GpuixImageData[]>([])
    const redoStack = ref<GpuixImageData[]>([])

    // Interaction state — deliberately not reactive; it lives and dies within
    // one down→move*→up stroke and must not re-render mid-drag.
    let drawing = false
    let startX = 0
    let startY = 0
    let lastX = 0
    let lastY = 0
    let dragSnap: GpuixImageData | null = null

    function ctx(): GpuixCanvasRenderingContext2D | null {
      return canvas.value?.getContext("2d") ?? null
    }

    function snapshot(): GpuixImageData | null {
      const c = ctx()
      if (!c) return null
      return c.getImageData(0, 0, c.canvas.width, c.canvas.height)
    }

    function pushUndo(snap: GpuixImageData | null = null): void {
      const s = snap ?? snapshot()
      if (!s) return
      // markRaw: the undo stack lives in a reactive ref, and a deep proxy
      // around `ImageData` breaks its private field access in putImageData.
      undoStack.value.push(markRaw(s))
      if (undoStack.value.length > MAX_UNDO) undoStack.value.shift()
      redoStack.value = []
    }

    function undo(): void {
      const c = ctx()
      if (!c) return
      const snap = undoStack.value.pop()
      if (!snap) return
      redoStack.value.push(markRaw(c.getImageData(0, 0, c.canvas.width, c.canvas.height)))
      c.putImageData(snap, 0, 0)
    }

    function redo(): void {
      const c = ctx()
      if (!c) return
      const snap = redoStack.value.pop()
      if (!snap) return
      undoStack.value.push(markRaw(c.getImageData(0, 0, c.canvas.width, c.canvas.height)))
      c.putImageData(snap, 0, 0)
    }

    /** White paper, with the light grid when enabled. Painted from scratch —
     *  both for the initial canvas and after a clear. */
    function paintBackground(): void {
      const c = ctx()
      if (!c) return
      const w = c.canvas.width
      const h = c.canvas.height
      if (w === 0 || h === 0) return
      c.fillStyle = "#ffffff"
      c.fillRect(0, 0, w, h)
      if (!gridOn.value) return
      c.strokeStyle = GRID_COLOR
      c.lineWidth = 1
      c.beginPath()
      for (let x = GRID_STEP; x < w; x += GRID_STEP) {
        c.moveTo(x, 0)
        c.lineTo(x, h)
      }
      for (let y = GRID_STEP; y < h; y += GRID_STEP) {
        c.moveTo(0, y)
        c.lineTo(w, y)
      }
      c.stroke()
    }

    function clearAll(): void {
      pushUndo()
      paintBackground()
    }

    function toggleGrid(): void {
      pushUndo()
      gridOn.value = !gridOn.value
      paintBackground()
    }

    /** One brush segment; the eraser paints `destination-out` and restores
     *  the composite mode after, so the rest of the app never sees it. */
    function strokeSegment(
      c: GpuixCanvasRenderingContext2D,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ): void {
      const erase = tool.value === "eraser"
      if (erase) c.globalCompositeOperation = "destination-out"
      c.strokeStyle = erase ? "#000000" : color.value
      c.lineWidth = brushWidth.value
      c.lineCap = "round"
      c.lineJoin = "round"
      c.beginPath()
      c.moveTo(x0, y0)
      c.lineTo(x1, y1)
      c.stroke()
      if (erase) c.globalCompositeOperation = "source-over"
    }

    /** A dot for a press that never moves — a straight click still leaves a
     *  mark, sized to the brush. */
    function paintDot(c: GpuixCanvasRenderingContext2D, x: number, y: number): void {
      const erase = tool.value === "eraser"
      if (erase) c.globalCompositeOperation = "destination-out"
      c.fillStyle = erase ? "#000000" : color.value
      c.beginPath()
      c.arc(x, y, brushWidth.value / 2, 0, Math.PI * 2)
      c.fill()
      if (erase) c.globalCompositeOperation = "source-over"
    }

    /** The current shape from its two drag corners, honoring the fill mode.
     *  `line` only strokes. */
    function drawShape(
      c: GpuixCanvasRenderingContext2D,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ): void {
      c.strokeStyle = color.value
      c.fillStyle = color.value
      c.lineWidth = brushWidth.value
      if (tool.value === "line") {
        c.lineCap = "round"
        c.beginPath()
        c.moveTo(x0, y0)
        c.lineTo(x1, y1)
        c.stroke()
        return
      }
      c.beginPath()
      if (tool.value === "rect") {
        const x = Math.min(x0, x1)
        const y = Math.min(y0, y1)
        c.rect(x, y, Math.abs(x1 - x0), Math.abs(y1 - y0))
      } else {
        const cx = (x0 + x1) / 2
        const cy = (y0 + y1) / 2
        c.ellipse(cx, cy, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2)
      }
      if (fillMode.value === "fill" || fillMode.value === "both") c.fill()
      if (fillMode.value === "stroke" || fillMode.value === "both") c.stroke()
    }

    function onMouseDown(event: EventPayload): void {
      if (event.button !== 0 || drawing) return
      const x = event.x ?? 0
      const y = event.y ?? 0
      cursor.value = { x, y }
      drawing = true
      startX = x
      startY = y
      lastX = x
      lastY = y
      const c = ctx()
      if (!c) return
      if (tool.value === "brush" || tool.value === "eraser") {
        pushUndo() // before the dot: one undo entry per stroke
        paintDot(c, x, y)
      } else {
        dragSnap = snapshot() // the paper under the shape, for preview + undo
      }
    }

    function onMouseMove(event: EventPayload): void {
      const x = event.x ?? 0
      const y = event.y ?? 0
      cursor.value = { x, y }
      if (!drawing) return
      const c = ctx()
      if (!c) return
      if (tool.value === "brush" || tool.value === "eraser") {
        strokeSegment(c, lastX, lastY, x, y)
        lastX = x
        lastY = y
      } else {
        // Live preview: restore the paper snapshot, then draw the shape at the
        // current drag corner.
        if (dragSnap) c.putImageData(dragSnap, 0, 0)
        drawShape(c, startX, startY, x, y)
      }
    }

    function onMouseUp(event: EventPayload): void {
      const x = event.x ?? 0
      const y = event.y ?? 0
      cursor.value = { x, y }
      if (!drawing) return
      drawing = false
      const c = ctx()
      if (!c || !dragSnap) return
      c.putImageData(dragSnap, 0, 0)
      drawShape(c, startX, startY, x, y)
      pushUndo(dragSnap)
      dragSnap = null
    }

    onMounted(paintBackground)

    return () => {
      const button = (active: boolean, color = "#cdd6f4"): Record<string, unknown> => ({
        padding: 6,
        borderRadius: 8,
        backgroundColor: active ? "#45475a" : "#313244",
        color,
        fontSize: 12,
        whiteSpace: "nowrap",
        cursor: "pointer",
        textAlign: "center",
      })

      const toolButtons = (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, width: 170, pointerEvents: "auto" }}>
          {TOOLS.map((t) => (
            <div
              key={t.id}
              testId={`tool-${t.id}`}
              onClick={() => {
                tool.value = t.id
              }}
              style={button(tool.value === t.id)}
            >
              {t.label}
            </div>
          ))}
        </div>
      )

      const swatches = (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, width: 168, pointerEvents: "auto" }}>
          {PALETTE.map((c) => (
            <div
              key={c}
              testId={`swatch-${c.slice(1)}`}
              onClick={() => {
                color.value = c
              }}
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                backgroundColor: c,
                borderWidth: color.value === c ? 2 : 0,
                borderColor: "#89b4fa",
                cursor: "pointer",
              }}
            />
          ))}
        </div>
      )

      const brushes = (
        <div style={{ display: "flex", gap: 6, pointerEvents: "auto" }}>
          {BRUSH_SIZES.map((s) => (
            <div
              key={s}
              testId={`brush-${s}`}
              onClick={() => {
                brushWidth.value = s
              }}
              style={button(brushWidth.value === s)}
            >
              {s}
            </div>
          ))}
        </div>
      )

      const actions = (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, width: 170, pointerEvents: "auto" }}>
          <div
            testId="undo"
            onClick={undo}
            style={button(false, undoStack.value.length ? "#cdd6f4" : "#6c7086")}
          >
            Undo
          </div>
          <div
            testId="redo"
            onClick={redo}
            style={button(false, redoStack.value.length ? "#cdd6f4" : "#6c7086")}
          >
            Redo
          </div>
          <div testId="clear-canvas" onClick={clearAll} style={button(false)}>
            Clear
          </div>
          <div testId="grid-toggle" onClick={toggleGrid} style={button(gridOn.value)}>
            Grid
          </div>
          <div
            testId="fill-mode"
            onClick={() => {
              fillMode.value =
                fillMode.value === "stroke" ? "fill" : fillMode.value === "fill" ? "both" : "stroke"
            }}
            style={button(false)}
          >
            {FILL_MODE_LABEL[fillMode.value]}
          </div>
        </div>
      )

      return (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: WIDTH,
            height: HEIGHT,
            backgroundColor: "#ffffff",
          }}
        >
          <GpuixCanvas
            ref={canvas}
            testId="paint-canvas"
            width={WIDTH}
            height={HEIGHT}
            style={{ position: "absolute", top: 0, left: 0, width: WIDTH, height: HEIGHT }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          />
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: 10,
              backgroundColor: "#313244",
              borderRadius: 12,
              pointerEvents: "none",
              // Drags on the canvas must not start a text selection on the
              // toolbar labels: userSelect:"none" keeps them out of the
              // window-level selection registry entirely.
              userSelect: "none",
            }}
          >
            <text style={{ color: "#cdd6f4", fontSize: 14 }}>Paint</text>
            <text style={{ color: "#bac2de", fontSize: 11 }}>Tools</text>
            {toolButtons}
            <text style={{ color: "#bac2de", fontSize: 11 }}>Colors</text>
            {swatches}
            <text style={{ color: "#bac2de", fontSize: 11 }}>Brush size</text>
            {brushes}
            <text style={{ color: "#bac2de", fontSize: 11 }}>Actions</text>
            {actions}
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 8,
              right: 12,
              display: "flex",
              gap: 12,
              backgroundColor: "#ffffff",
              padding: 4,
              borderRadius: 8,
              color: "#585b70",
              fontSize: 11,
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            <text>{tool.value}</text>
            <text>{color.value}</text>
            <text>{cursor.value ? `${cursor.value.x}, ${cursor.value.y}` : "—"}</text>
            <text>{`${WIDTH}×${HEIGHT}`}</text>
          </div>
        </div>
      )
    }
  },
})

export const App = defineComponent({
  setup() {
    return () => <Paint />
  },
})

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("paint.tsx")

if (isEntryPoint) {
  createApp(App, {
    title: "GPUIV Paint",
    width: WIDTH,
    height: HEIGHT,
    // Agent checks need real GPU paint, not control of the user's keyboard.
    focus: process.env.GPUIX_BACKGROUND !== "1",
  })
}
