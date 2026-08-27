/// GPU-backed tests for the expanded automation surface: drag interpolation,
/// hover, wheel with modifiers, and textContent descendants.

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import { connectTest } from "../automation/client.js"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("automation surface (vue)", () => {
  it("hover moves the pointer onto the element", async () => {
    const state = ref("none")
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            <div testId="box" style={{ padding: 20, backgroundColor: "#333" }} onMouseEnter={() => (state.value = "enter")}>
              <text>box</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    await automation.getByTestId("box").hover()
    expect(state.value).toBe("enter")
    app.unmount()
  })

  it("sends a wheel event with modifiers over the element", async () => {
    const seen = ref<{ dx: number; dy: number; cmd: boolean } | null>(null)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            <div
              testId="pane"
              style={{ width: 200, height: 200, backgroundColor: "#333" }}
              onScroll={(event) =>
                (seen.value = { dx: event.deltaX ?? 0, dy: event.deltaY ?? 0, cmd: event.modifiers?.cmd ?? false })
              }
            >
              <text>pane</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    await automation.getByTestId("pane").wheel(0, -120, { modifiers: "cmd" })
    expect(seen.value).not.toBeNull()
    expect(seen.value!.dy).toBe(-120)
    expect(seen.value!.cmd).toBe(true)
    app.unmount()
  })

  it("dragBy sends interpolated moves from the press to the release", async () => {
    const moves = ref<{ x: number; y: number }[]>([])
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            <div
              testId="handle"
              style={{ width: 40, height: 40, backgroundColor: "#333" }}
              onMouseDown={() => (moves.value = [])}
              onMouseMove={(event) => moves.value.push({ x: event.x, y: event.y })}
            >
              <text>h</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    const handle = automation.getByTestId("handle")
    await handle.hover()
    await handle.dragBy(80, 0, { steps: 4 })
    // Interpolated moves fire while the pointer is still over the element;
    // later steps travel past its edge, so only the in-bounds ones land.
    expect(moves.value.length).toBeGreaterThanOrEqual(2)
    const last = moves.value[moves.value.length - 1]!
    const first = moves.value[0]!
    expect(last.x - first.x).toBeGreaterThan(0)
    app.unmount()
  })

  it("textContent concatenates descendants in document order", async () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            <div testId="wrap">
              <text>hello </text>
              <text>world</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    // The wrapper itself carries no text; the strings live on child nodes.
    expect(await automation.getByTestId("wrap").textContent()).toBe("hello world")
    app.unmount()
  })

  it("app.mouse.click with button 2 fires auxClick, not click", async () => {
    const log = ref<string[]>([])
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            <div
              testId="menu"
              style={{ padding: 20, backgroundColor: "#333" }}
              onClick={() => log.value.push("click")}
              onAuxClick={() => log.value.push("auxClick")}
            >
              <text>menu</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    await automation.mouse.click(automation.getByTestId("menu"), { button: 2 })
    expect(log.value).toEqual(["auxClick"])
    app.unmount()
  })
})
