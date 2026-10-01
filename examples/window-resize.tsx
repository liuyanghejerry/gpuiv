import { defineComponent, h } from "vue"
import { createApp, createWindow, useGpuixRequired, useWindowSize } from "@gpuiv/vue"

const ResizeWindow = defineComponent({
  props: { name: { type: String, required: true } },
  setup(props) {
    const renderer = useGpuixRequired()
    const size = useWindowSize({ intervalMs: 20 })
    return () => <div testId="viewport" style={{ width: "100%", height: "100%", padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
      <text testId="size">{`${props.name}: ${size.value.width} × ${size.value.height}`}</text>
      <div testId="resize" role="button" tabIndex={0} aria-label="Resize window"
        onClick={() => renderer.resizeWindow?.(700, 420)}
        onKeyDown={(event: { key?: string }) => { if (event.key === "enter" || event.key === "space") renderer.resizeWindow?.(700, 420) }}
        style={{ padding: 12, backgroundColor: "#2563eb", cursor: "pointer" }}><text>Resize to 700 × 420</text></div>
    </div>
  },
})

if (import.meta.main) {
  const focus = process.env.GPUIX_BACKGROUND !== "1"
  createApp(defineComponent({ setup: () => () => h(ResizeWindow, { name: "Main" }) }), { width: 640, height: 360, focus })
  createWindow(defineComponent({ setup: () => () => h(ResizeWindow, { name: "Second" }) }), { width: 420, height: 300, focus })
}
