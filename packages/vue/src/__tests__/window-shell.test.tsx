import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { createScrollController, useScrollController } from "../scroll-controller.js"
import { fileURLToPath } from "node:url"

const { WindowShell } = await import(fileURLToPath(new URL("../../../../examples/window-shell.tsx", import.meta.url)))

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("window shell primitives", () => {
  it("cancels component-owned scroll requests on unmount", async () => {
    let scrolling!: ReturnType<typeof useScrollController>
    const app = createTestApp(defineComponent({
      setup() {
        scrolling = useScrollController()
        return () => <div testId="pane" style={{ width: 200, height: 100, overflow: "scroll" }}>
          <div style={{ height: 500 }} />
        </div>
      },
    }))
    await app.settle()
    const done = scrolling.scrollTo(app.renderer.findByTestId("pane")!.id, { y: -300, behavior: "smooth", duration: 1000 })
    app.unmount()
    expect((await done).status).toBe("cancelled")
  })

  it("renders the reusable example and routes its zoom button", async () => {
    const app = createTestApp(WindowShell, { width: 900, height: 600 })
    try {
      await app.settle()
      const zoom = app.renderer.findByText("Zoom")!
      const bounds = app.renderer.getElementBounds(zoom.id)!
      app.renderer.nativeSimulateClick(bounds.x + 2, bounds.y + 2)
      await app.settle()
      expect(app.renderer.getZoomCalls()).toBe(1)
      const jump = app.renderer.findByText("Section 10")!
      const jumpBounds = app.renderer.getElementBounds(jump.id)!
      app.renderer.nativeSimulateClick(jumpBounds.x + 2, jumpBounds.y + 2)
      await app.settle()
      await new Promise((resolve) => setTimeout(resolve, 400))
      await app.settle()
      expect(app.renderer.getAllText().join(" ")).toContain("finished")
      expect(app.renderer.getScrollOffset(app.renderer.findByTestId("scroll-pane")!.id)?.[1]).toBeCloseTo(-900)
      app.renderer.captureScreenshot(fileURLToPath(new URL("../../screenshots/window-shell.png", import.meta.url)))
    } finally { app.unmount() }
  })

  it("forwards and updates drag-region props without turning sibling controls into drag areas", async () => {
    const drag = ref(true)
    let clicked = 0
    const app = createTestApp(defineComponent({
      setup: () => () => <div style={{ display: "flex", height: 50 }}>
        <div testId="drag" windowDragRegion={drag.value} style={{ width: 200, height: 50 }}>Title</div>
        <div testId="button" onClick={() => clicked++} style={{ width: 100, height: 50 }}>Button</div>
      </div>,
    }))
    try {
      await app.settle()
      expect(app.renderer.findByTestId("drag")!.customProps?.windowDragRegion).toBe(true)
      expect(app.renderer.findByTestId("button")!.customProps?.windowDragRegion).toBeUndefined()
      const bounds = app.renderer.getElementBounds(app.renderer.findByTestId("button")!.id)!
      app.renderer.nativeSimulateClick(bounds.x + 10, bounds.y + 10)
      await app.settle()
      expect(clicked).toBe(1)
      drag.value = false
      await app.settle()
      expect(app.renderer.findByTestId("drag")!.customProps?.windowDragRegion).toBe(false)
    } finally { app.unmount() }
  })

  it("observes GPUI-clamped scroll offsets on a real native scroll container", async () => {
    const app = createTestApp(defineComponent({
      setup: () => () => <div testId="pane" style={{ width: 200, height: 100, overflow: "scroll" }}>
        <div style={{ height: 500 }}><text>Long content</text></div>
      </div>,
    }))
    const controller = createScrollController(app.renderer)
    try {
      await app.settle()
      const id = app.renderer.findByTestId("pane")!.id
      const result = await controller.scrollTo(id, { y: -1000, behavior: "smooth", duration: 32 })
      await app.settle()
      expect(result.status).toBe("finished")
      expect(result.offset?.y).toBeLessThan(0)
      expect(result.offset?.y).toBeGreaterThan(-1000)
      expect(result.offset?.y).toBe(app.renderer.getScrollOffset(id)?.[1])
    } finally { controller.dispose(); app.unmount() }
  })
})
