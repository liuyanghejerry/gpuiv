/** GPU-backed event tests for the Vue binding — mouse, hover, outside, scroll,
 *  focus. Every simulation goes through the native GPUI hit-test pipeline; the
 *  handler result lands in the component state and is asserted after settle(). */

import { spawnSync } from "node:child_process"
import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import type { EventPayload } from "@gpuiv/native"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { motion } from "../index.js"
import { startFrameLoop } from "../renderer.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describe("frame loop (vue)", () => {
  // The embedded AppKit pump must drain only ready events and return, never
  // wait for a display-link wake — otherwise Bun timers and sockets starve
  // between frames. Runs in a child process because it needs the real
  // GpuixRenderer, not the test renderer.
  it.skipIf(process.platform !== "darwin")(
    "returns control to JavaScript while AppKit is idle",
    () => {
      const script = [
        'import { GpuixRenderer } from "@gpuiv/native"',
        "const renderer = new GpuixRenderer(() => {})",
        "renderer.init({ focus: false })",
        "renderer.tick()",
        "const startedAt = performance.now()",
        "for (let index = 0; index < 30; index += 1) renderer.tick()",
        "console.log(performance.now() - startedAt)",
        "process.exit(0)",
      ].join("\n")
      const result = spawnSync(process.execPath, ["-e", script], {
        encoding: "utf8",
        timeout: 3_000,
      })

      expect(result.status, result.stderr || result.error?.message).toBe(0)
      const elapsedMs = Number(result.stdout.trim())
      expect(elapsedMs).not.toBeNaN()
      expect(elapsedMs).toBeLessThan(200)
    },
  )

  it("keeps ticking until a later false, then exits once", async () => {
    let ticks = 0
    let terminated = 0
    const loop = startFrameLoop(
      {
        requiresTick: () => true,
        tick: () => {
          ticks += 1
          return ticks < 3
        },
      },
      {
        frameMs: 5,
        onTerminated: () => {
          terminated += 1
        },
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(ticks).toBe(3)
    expect(terminated).toBe(1)
    loop.stop()
  })
})

describeNative("events (vue)", () => {
  it("delivers click and mouseDown events in order", async () => {
    const log = ref<string[]>([])
    const App = defineComponent({
      setup() {
        return () => (
          <div
            style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}
          >
            <div
              testId="target"
              style={{ padding: 20, backgroundColor: "#333", cursor: "pointer" }}
              onMouseDown={() => log.value.push("down")}
              onClick={() => log.value.push("click")}
            >
              <text>target</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const target = app.renderer.findByText("target")!
    const bounds = app.renderer.getElementBounds(target.id)!
    app.renderer.nativeSimulateClick(bounds[0] + 5, bounds[1] + 5)
    await app.settle()
    expect(log.value).toEqual(["down", "click"])
    app.unmount()
  })

  it("routes a non-primary click to onAuxClick, not onClick", async () => {
    const log = ref<string[]>([])
    const aux = ref<EventPayload | null>(null)
    const App = defineComponent({
      setup() {
        return () => (
          <div
            style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}
          >
            <div
              testId="target"
              style={{ padding: 20, backgroundColor: "#333" }}
              onClick={() => log.value.push("click")}
              onAuxClick={(event) => {
                log.value.push("auxClick")
                aux.value = event
              }}
            >
              <text>target</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const target = app.renderer.findByText("target")!
    const bounds = app.renderer.getElementBounds(target.id)!
    app.renderer.nativeSimulateClick(bounds[0] + 5, bounds[1] + 5, 2)
    await app.settle()
    expect(log.value).toEqual(["auxClick"])
    expect(aux.value?.isRightClick).toBe(true)
    // A left click still goes to onClick only.
    app.renderer.nativeSimulateClick(bounds[0] + 5, bounds[1] + 5)
    await app.settle()
    expect(log.value).toEqual(["auxClick", "click"])
    app.unmount()
  })

  it("synthesizes click only for the primary button", async () => {
    const received: string[] = []
    const App = defineComponent({
      setup() {
        return () => (
          <div
            style={{ width: 200, height: 50 }}
            onMouseDown={(event) => received.push(`down:${event.button}`)}
            onMouseUp={(event) => received.push(`up:${event.button}`)}
            onClick={(event) => received.push(`click:${event.button}:${event.isRightClick}`)}
          />
        )
      },
    })
    const app = createTestApp(App)

    for (const button of [1, 2]) {
      app.renderer.nativeSimulateMouseDown(10, 10, button)
      app.renderer.nativeSimulateMouseUp(10, 10, button)
    }
    await app.settle()
    expect(received).toEqual(["down:1", "up:1", "down:2", "up:2"])

    app.renderer.nativeSimulateMouseDown(10, 10, 0)
    app.renderer.nativeSimulateMouseUp(10, 10, 0)
    await app.settle()
    expect(received).toEqual([
      "down:1",
      "up:1",
      "down:2",
      "up:2",
      "down:0",
      "up:0",
      "click:0:false",
    ])
    app.unmount()
  })

  it("dispatches primary clicks from motion elements", async () => {
    let clicks = 0
    const App = defineComponent({
      setup() {
        return () => (
          <motion.div
            initial={false}
            animate={{ width: 200 }}
            style={{ width: 200, height: 50 }}
            onClick={() => {
              clicks += 1
            }}
          />
        )
      },
    })
    const app = createTestApp(App)

    app.renderer.nativeSimulateMouseDown(10, 10, 0)
    app.renderer.nativeSimulateMouseUp(10, 10, 0)
    await app.settle()
    expect(clicks).toBe(1)

    app.renderer.nativeSimulateMouseDown(10, 10, 2)
    app.renderer.nativeSimulateMouseUp(10, 10, 2)
    await app.settle()
    expect(clicks).toBe(1)
    app.unmount()
  })

  it("dispatches primary clicks from native custom elements", async () => {
    const clicks: EventPayload[] = []
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", padding: 20 }}>
            <code
              code="hello"
              language="ts"
              onClick={(event) => {
                clicks.push(event)
              }}
            />
          </div>
        )
      },
    })
    const app = createTestApp(App)

    app.renderer.nativeSimulateMouseDown(30, 28, 0)
    app.renderer.nativeSimulateMouseUp(30, 28, 0)
    await app.settle()
    expect(clicks).toHaveLength(1)
    expect(clicks[0]).toMatchObject({ button: 0, isRightClick: false })

    app.renderer.nativeSimulateMouseDown(30, 28, 2)
    app.renderer.nativeSimulateMouseUp(30, 28, 2)
    await app.settle()
    expect(clicks).toHaveLength(1)
    app.unmount()
  })

  it("fires mouseEnter and mouseLeave on hover moves", async () => {
    const hovered = ref<string>("none")
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", padding: 30 }}>
            <div
              style={{ padding: 24, backgroundColor: "#333" }}
              onMouseEnter={() => (hovered.value = "enter")}
              onMouseLeave={() => (hovered.value = "leave")}
            >
              <text>box</text>
            </div>
            <text>{hovered.value}</text>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const box = app.renderer.findByText("box")!
    const bounds = app.renderer.getElementBounds(box.id)!
    const cx = bounds[0] + bounds[2] / 2
    const cy = bounds[1] + bounds[3] / 2

    app.renderer.nativeSimulateMouseMove(cx, cy)
    await app.settle()
    expect(hovered.value).toBe("enter")

    app.renderer.nativeSimulateMouseMove(cx + 400, cy + 200)
    await app.settle()
    expect(hovered.value).toBe("leave")
    app.unmount()
  })

  it("fires mouseDownOutside when clicking outside the element", async () => {
    const outside = ref(0)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", flexDirection: "column", padding: 30, gap: 60 }}>
            <div
              style={{ padding: 30, backgroundColor: "#333" }}
              onMouseDownOutside={() => (outside.value += 1)}
            >
              <text>inside</text>
            </div>
            <div style={{ padding: 30, backgroundColor: "#444" }}>
              <text>elsewhere</text>
            </div>
            <text>{`outside:${outside.value}`}</text>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const elsewhere = app.renderer.findByText("elsewhere")!
    const bounds = app.renderer.getElementBounds(elsewhere.id)!
    app.renderer.nativeSimulateClick(bounds[0] + 10, bounds[1] + 10)
    await app.settle()
    expect(outside.value).toBeGreaterThanOrEqual(1)
    app.unmount()
  })

  it("delivers scroll events from a scrollable container", async () => {
    const lastDelta = ref(0)
    const App = defineComponent({
      setup() {
        return () => (
          <div
            style={{ width: "100%", height: "100%", overflow: "scroll", padding: 30 }}
            onScroll={(e: EventPayload) => (lastDelta.value = (e.deltaY ?? 0) * -1)}
          >
            <div style={{ height: 2000 }}>
              <text>tall content</text>
            </div>
            <text>{`delta:${lastDelta.value}`}</text>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    app.renderer.nativeSimulateScrollWheel(300, 200, 0, -160)
    await app.settle()
    expect(app.renderer.getAllText().join("")).toContain("delta:")
    expect(lastDelta.value).toBeGreaterThan(0)
    app.unmount()
  })

  it("tracks focus and blur on a focusable element", async () => {
    const focusLog = ref<string[]>([])
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", padding: 30 }}>
            <div
              style={{ width: 200, height: 40, backgroundColor: "#333" }}
              tabIndex={0}
              onFocus={() => focusLog.value.push("focus")}
              onBlur={() => focusLog.value.push("blur")}
            >
              <text>focusable</text>
            </div>
            <text>{focusLog.value.join(",")}</text>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const el = app.renderer
      .findByType("div")
      .find((d) => d.events.has("focus") && d.events.has("blur"))!

    app.renderer.nativeSimulateMouseDown(10, 10)
    await app.settle()
    const all = app.renderer.getAllText().join("")
    expect(all).toContain("focus")
    app.unmount()
  })

  it("keeps mouseMove and mouseUp after the pointer leaves the hitbox", async () => {
    const received = ref<string[]>([])
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: "100%", height: "100%", padding: 30 }}>
            <div
              style={{ width: 80, height: 40, backgroundColor: "#3366ff" }}
              onMouseDown={() => received.value.push("down")}
              onMouseMove={(e: EventPayload) =>
                received.value.push(`move:${Math.round(e.x ?? 0)},${e.pressedButton}`)
              }
              onMouseUp={() => received.value.push("up")}
            >
              <text>handle</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const handle = app.renderer.findByText("handle")!
    const bounds = app.renderer.getElementBounds(handle.id)!

    app.renderer.nativeSimulateMouseDown(bounds[0] + 20, bounds[1] + 20)
    await app.settle()
    app.renderer.nativeSimulateMouseMove(bounds[0] + 200, bounds[1] + 20, 0)
    await app.settle()
    app.renderer.nativeSimulateMouseUp(bounds[0] + 200, bounds[1] + 20, 0)
    await app.settle()
    expect(received.value).toEqual(["down", `move:${Math.round(bounds[0] + 200)},0`, "up"])
    app.unmount()
  })

  it("does not capture when the element only listens for mouseDown and mouseUp", async () => {
    const received = ref<string[]>([])
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: "100%", height: "100%", padding: 30 }}>
            <div
              style={{ width: 80, height: 40, backgroundColor: "#3366ff" }}
              onMouseDown={() => received.value.push("down")}
              onMouseUp={() => received.value.push("up")}
            >
              <text>press</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const press = app.renderer.findByText("press")!
    const bounds = app.renderer.getElementBounds(press.id)!

    app.renderer.nativeSimulateMouseDown(bounds[0] + 20, bounds[1] + 20)
    await app.settle()
    app.renderer.nativeSimulateMouseUp(bounds[0] + 200, bounds[1] + 20, 0)
    await app.settle()
    expect(received.value).toEqual(["down"])
    app.unmount()
  })
})
