/** Reusable P1 primitives: a native drag spacer, window controls, and
 * cancellable smooth scrolling. Run: bun --hot window-shell.tsx */
import { defineComponent, onBeforeUnmount, ref } from "vue"
import { createApp, useGpuixRequired, useScrollController } from "@gpuiv/vue"

export const WindowShell = defineComponent({
  setup() {
    const renderer = useGpuixRequired()
    const scrolling = useScrollController()
    const pane = ref<any>(null)
    const status = ref("Ready")
    let request = 0
    onBeforeUnmount(() => { request++ })
    const jump = async (y: number) => {
      const current = ++request
      status.value = "Scrolling…"
      const result = await scrolling.scrollTo(pane.value.id, { y, behavior: "smooth" })
      if (current === request) status.value = result.status
    }
    const button = (label: string, action: () => void) => (
      <div role="button" aria-label={label} tabIndex={0}
        onClick={action}
        onKeyDown={(event: any) => { if (event.key === "enter" || event.key === "space") action() }}
        style={{ padding: 8, color: "#2c2c2c", cursor: "pointer" }}><text>{label}</text></div>
    )
    return () => (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#f0edea" }}>
        <div style={{ display: "flex", height: 48, flexShrink: 0, paddingLeft: 86, alignItems: "center", backgroundColor: "#e4e1de" }}>
          <div testId="window-drag-region" windowDragRegion
            style={{ flexGrow: 1, height: "100%", display: "flex", alignItems: "center", userSelect: "none" }}>
            <text>Reusable app shell</text>
          </div>
          {button("Minimize", () => renderer.minimizeWindow?.())}
          {button("Zoom", () => renderer.zoomWindow?.())}
          {button("Close", () => renderer.closeWindow?.())}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {button("Top", () => { void jump(0) })}
          {button("Section 10", () => { void jump(-900) })}
          <text>{status.value}</text>
        </div>
        <div ref={pane} testId="scroll-pane" onScroll={() => scrolling.cancel()} onMouseDown={() => scrolling.cancel()}
          style={{ flexGrow: 1, minHeight: 0, overflow: "scroll" }}>
          {Array.from({ length: 30 }, (_, index) => (
            <div style={{ height: 100, padding: 24 }}><text>{`Section ${index + 1}`}</text></div>
          ))}
        </div>
      </div>
    )
  },
})

if (import.meta.main) createApp(WindowShell, {
  title: "GPUIV Window Primitives", width: 900, height: 600,
  titlebarTransparent: true, focus: process.env.GPUIX_BACKGROUND !== "1",
})
