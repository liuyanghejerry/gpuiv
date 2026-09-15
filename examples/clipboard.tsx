/**
 * Clipboard demo — text and image read/write against the system clipboard.
 *
 * The right panel writes a generated RGBA pattern with `writeClipboardImage`
 * and reads it back through the real platform clipboard entry; the left panel
 * round-trips text through `writeClipboardText` / `readClipboardText`.
 */

import { defineComponent, onMounted, ref } from "vue"
import { GpuixCanvas, createApp, useGpuixRequired, type GpuixCanvasInstance } from "@gpuiv/vue"

const PANEL = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 20,
  backgroundColor: "#1e1e2e",
  borderRadius: 12,
  width: 320,
} as const

const BUTTON = {
  padding: 10,
  paddingLeft: 16,
  paddingRight: 16,
  backgroundColor: "#89b4fa",
  borderRadius: 8,
  cursor: "pointer",
  color: "#1e1e2e",
  fontWeight: "bold",
  fontSize: 14,
} as const

const Label = defineComponent({
  props: {
    text: { type: String, required: true },
  },
  setup(props) {
    return () => <text style={{ color: "#a6adc8", fontSize: 13 }}>{props.text}</text>
  },
})

const ClipboardDemo = defineComponent({
  setup() {
    const renderer = useGpuixRequired()
    const draft = ref("你好，clipboard！")
    const readBack = ref<string | null>(null)
    const imageInfo = ref<string | null>(null)
    const canvas = ref<GpuixCanvasInstance | null>(null)

    function writeText(): void {
      readBack.value = null
      renderer.writeClipboardText?.(draft.value)
    }

    function readText(): void {
      const text = renderer.readClipboardText?.()
      readBack.value = typeof text === "string" ? text : null
    }

    function writeImage(): void {
      const ctx = canvas.value?.getContext("2d")
      if (!ctx) return
      const gradient = ctx.createLinearGradient(0, 0, 0, 96)
      gradient.addColorStop(0, "#f38ba8")
      gradient.addColorStop(1, "#89b4fa")
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 96, 96)
      ctx.fillStyle = "#a6e3a1"
      ctx.beginPath()
      ctx.arc(48, 48, 20, 0, Math.PI * 2)
      ctx.fill()
      const image = ctx.getImageData(0, 0, 96, 96)
      renderer.writeClipboardImage?.(image.data, 96, 96)
    }

    function readImage(): void {
      const image = renderer.readClipboardImage?.()
      imageInfo.value = image
        ? `${image.width}×${image.height} RGBA, first pixel ${Array.from(
            image.data.slice(0, 4)
          ).join(",")}`
        : null
    }

    onMounted(() => {
      // The pattern source lives offscreen; its pixels are what ships to the
      // clipboard, so it never needs to be in the layout.
      writeImage()
    })

    return () => (
      <div
        style={{
          display: "flex",
          gap: 20,
          padding: 32,
          width: "100%",
          height: "100%",
          backgroundColor: "#11111b",
          alignItems: "flex-start",
        }}
      >
        <div style={PANEL}>
          <text style={{ color: "#cdd6f4", fontSize: 16, fontWeight: "bold" }}>
            Text clipboard
          </text>
          <input
            testId="clipboard-draft"
            value={draft.value}
            onChange={(e) => (draft.value = e.value ?? "")}
            style={{ padding: 8, backgroundColor: "#313244", borderRadius: 6, color: "#cdd6f4" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <div testId="copy-text" style={BUTTON} onClick={writeText}>
              Copy
            </div>
            <div testId="paste-text" style={{ ...BUTTON, backgroundColor: "#a6e3a1" }} onClick={readText}>
              Paste
            </div>
          </div>
          <Label text={readBack.value === null ? "Paste reads the system clipboard" : readBack.value} />
        </div>

        <div style={PANEL}>
          <text style={{ color: "#cdd6f4", fontSize: 16, fontWeight: "bold" }}>
            Image clipboard
          </text>
          <GpuixCanvas
            ref={canvas}
            width={96}
            height={96}
            style={{ width: 96, height: 96, borderRadius: 8 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <div testId="copy-image" style={{ ...BUTTON, backgroundColor: "#f5c2e7" }} onClick={writeImage}>
              Copy pattern
            </div>
            <div testId="paste-image" style={{ ...BUTTON, backgroundColor: "#a6e3a1" }} onClick={readImage}>
              Paste
            </div>
          </div>
          <Label text={imageInfo.value === null ? "Paste decodes the PNG entry back to RGBA" : imageInfo.value} />
        </div>
      </div>
    )
  },
})

const App = defineComponent({
  setup() {
    return () => (
      <div style={{ width: "100%", height: "100%", backgroundColor: "#11111b" }}>
        <ClipboardDemo />
      </div>
    )
  },
})

export { App, ClipboardDemo }

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("clipboard.tsx")

if (isEntryPoint) {
  createApp(App, {
    title: "GPUIV Clipboard",
    width: 760,
    height: 420,
    focus: process.env.GPUIX_BACKGROUND !== "1",
  })
}
