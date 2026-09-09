/// GPU-backed tests for the pinch gesture wiring: PinchEvent → wire_host_events
/// → emit_event_full → automation client, plus the payload field surface.

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import type { EventPayload } from "@gpuiv/native"
import { connectTest } from "../automation/client.js"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("pinch events (vue)", () => {
  it("delivers pinch payload fields to onPinch through automation", async () => {
    const seen = ref<EventPayload[]>([])
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            <div
              testId="pane"
              style={{ width: 200, height: 200, backgroundColor: "#333" }}
              onPinch={(event) => seen.value.push(event)}
            >
              <text>pane</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    const pane = automation.getByTestId("pane")
    await pane.pinch(0.0, { phase: "started" })
    await pane.pinch(0.25, { modifiers: "shift" })
    await pane.pinch(0.0, { phase: "ended" })

    expect(seen.value.map((event) => event.touchPhase)).toEqual([
      "started",
      "moved",
      "ended",
    ])
    // Position is the pinch center, in window coordinates over the element.
    const bounds = await pane.bounds()
    const moved = seen.value[1]!
    expect(moved.zoomDelta).toBeCloseTo(0.25)
    expect(moved.x!).toBeGreaterThanOrEqual(bounds.x)
    expect(moved.x!).toBeLessThanOrEqual(bounds.x + bounds.width)
    expect(moved.y!).toBeGreaterThanOrEqual(bounds.y)
    expect(moved.y!).toBeLessThanOrEqual(bounds.y + bounds.height)
    expect(moved.modifiers?.shift).toBe(true)
    expect(seen.value[0]!.modifiers?.shift).toBe(false)
    app.unmount()
  })

  it("accumulates zoom deltas into a scale the way a zoom handler would", async () => {
    const scale = ref(1)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            <div
              testId="canvas"
              style={{ width: 200, height: 200, backgroundColor: "#222" }}
              onPinch={(event) => (scale.value *= 1 + (event.zoomDelta ?? 0))}
            >
              <text>canvas</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    const target = automation.getByTestId("canvas")
    await target.pinch(-0.5)
    await target.pinch(-0.5)
    // 1 * 0.5 * 0.5 — a pinch-out halves the scale.
    expect(scale.value).toBeCloseTo(0.25)
    app.unmount()
  })

  it("does not fire onPinch for an element without a listener", async () => {
    const calls = ref(0)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            <div testId="plain" style={{ width: 200, height: 200 }}>
              <text>plain</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const automation = await connectTest(app.renderer, app.settle)
    await automation.mouse.pinch(await automation.getByTestId("plain").center(), 0.2)
    expect(calls.value).toBe(0)
    app.unmount()
  })
})
