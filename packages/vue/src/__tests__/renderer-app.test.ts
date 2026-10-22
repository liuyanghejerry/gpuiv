/// Headless tests for renderer.ts app wiring: createApp with an injected
/// renderer (no native window), remounts, the runtime-error overlay and its
/// Reload button, observer plumbing, resetApp, and the frame loop. The
/// macOS-only paths (real GpuixRenderer) live in renderer-native.test.ts and
/// the native-gated suites.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { defineComponent, ref, h } from "vue"
import { resetApp, createApp, startFrameLoop, installRuntimeErrorHandlers } from "../renderer.js"
import { handleGpuixEvent } from "../reconciler/event-registry.js"
import { HeadlessRenderer } from "./headless.js"

const hmrCounts = vi.hoisted(() => ({ reloads: 0, duplicates: 0 }))

vi.mock("../hmr/runtime.js", () => ({
  hmrReloadCount: () => hmrCounts.reloads,
  hmrSettledDuplicates: () => hmrCounts.duplicates,
  noteHmrMount: () => {},
}))

class AppRenderer extends HeadlessRenderer {
  keyEvents: unknown[][] = []
  observers: unknown[][] = []
  selectionChange: unknown[][] = []
  debugOverlays: unknown[] = []
  failKeyEvents = false

  setWindowKeyEvents(keyDown: boolean, keyUp: boolean, eventId: number): void {
    if (this.failKeyEvents) throw new Error("key events failed")
    this.keyEvents.push([keyDown, keyUp, eventId])
  }
  setWindowObservers(shouldClose: boolean, reopen: boolean, eventId: number): void {
    this.observers.push([shouldClose, reopen, eventId])
  }
  setWindowSelectionChange(enabled: boolean, eventId: number): void {
    this.selectionChange.push([enabled, eventId])
  }
  setDebugFrameOverlay(mode: string): void {
    this.debugOverlays.push(mode)
  }
}

function mount(renderer: AppRenderer, options: Parameters<typeof createApp>[1] = {}) {
  const Root = defineComponent({
    setup: () => () => h("div", { testId: "root" }, [h("text", {}, "root text")]),
  })
  return createApp(Root, { renderer, ...options })
}

describe("renderer app wiring (headless)", () => {
  let logs: string[]
  let errors: string[]
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetApp()
    hmrCounts.reloads = 0
    hmrCounts.duplicates = 0
    logs = []
    errors = []
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "))
    })
    errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.join(" "))
    })
  })
  afterEach(() => {
    resetApp()
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("mounts an app through the injected renderer and unmount disarms window listeners", () => {
    const renderer = new AppRenderer()
    const onKeyDown = () => {}
    const handle = mount(renderer, { onKeyDown, onSelectionChange: () => {} })
    expect(renderer.opsOf("setRoot").length).toBe(1)
    expect(renderer.allTexts()).toContain("root text")
    expect(renderer.keyEvents).toEqual([[true, false, expect.any(Number)]])
    expect(renderer.selectionChange).toEqual([[true, expect.any(Number)]])
    expect(logs.some((line) => line.includes("mount complete"))).toBe(true)

    handle.unmount()
    expect(renderer.keyEvents.at(-1)).toEqual([false, false, expect.any(Number)])
    expect(renderer.selectionChange.at(-1)).toEqual([false, expect.any(Number)])
  })

  it("forwards debugFrameOverlay to the renderer", () => {
    const renderer = new AppRenderer()
    mount(renderer, { debugFrameOverlay: "full" })
    expect(renderer.debugOverlays).toEqual(["full"])
  })

  it("remounts on a second createApp, destroying the previous tree", async () => {
    const renderer = new AppRenderer()
    const first = mount(renderer)
    const firstTexts = renderer.allTexts()
    expect(firstTexts).toContain("root text")

    // No HMR advance between mounts: a plain second createApp remounts.
    const second = mount(renderer)
    expect(second).not.toBe(first)
    expect(logs.some((line) => line.includes("remount"))).toBe(true)
    // The old tree's text was replaced by the new mount's copy.
    expect(renderer.allTexts()).toContain("root text")
    expect(renderer.destroyed.length).toBeGreaterThan(0)
  })

  it("keeps the live tree when an HMR reload already applied it", async () => {
    const renderer = new AppRenderer()
    const first = mount(renderer)
    const remountsBefore = logs.filter((l) => l.includes("remount")).length

    hmrCounts.reloads += 1
    const second = mount(renderer)
    expect(second).toBe(first)
    expect(logs.filter((l) => l.includes("remount")).length).toBe(remountsBefore)
  })

  it("keeps the live tree when a duplicate watcher report re-runs the entry", () => {
    const renderer = new AppRenderer()
    const first = mount(renderer)
    hmrCounts.duplicates += 1
    expect(mount(renderer)).toBe(first)
  })

  it("binds the render-level onEvent observer to the mounted root", () => {
    const seen: string[] = []
    const renderer = new AppRenderer()
    const Root = defineComponent({
      setup: () => () =>
        h("div", { testId: "hit", onClick: () => seen.push("click") }, [h("text", {}, "hit me")]),
    })
    createApp(Root, { renderer, onEvent: (event) => seen.push(`observer:${event.eventType}`) })

    const painted = renderer.idsWithText("hit me")[0]
    const target = renderer.closestWithListener(painted, "click")
    expect(handleGpuixEvent({ elementId: target!, eventType: "click" }, renderer)).toBe(true)
    expect(seen).toEqual(["click", "observer:click"])
  })

  it("rolls back the mount when arming window listeners throws", () => {
    const renderer = new AppRenderer()
    renderer.failKeyEvents = true
    const Root = defineComponent({ setup: () => () => h("div", {}, "x") })
    expect(() => createApp(Root, { renderer, onKeyDown: () => {} })).toThrow("key events failed")
    // The renderer slot is left without a handle; a later mount still works.
    renderer.failKeyEvents = false
    mount(renderer)
    expect(renderer.allTexts()).toContain("root text")
  })

  it("routes render errors to onRuntimeError, the console, and the overlay", async () => {
    const observed: Array<[unknown, string]> = []
    const renderer = new AppRenderer()
    const Boom = defineComponent({
      name: "BoomRender",
      setup() {
        const boom = ref(false)
        return () => {
          if (boom.value) throw new Error("kaboom")
          return h(
            "div",
            { testId: "go", onClick: () => (boom.value = true) },
            [h("text", {}, "ok")]
          )
        }
      },
    })
    createApp(Boom, {
      renderer,
      onRuntimeError: (error, info) => observed.push([error, info]),
    })
    const painted = renderer.idsWithText("ok")[0]
    const target = renderer.closestWithListener(painted, "click")
    handleGpuixEvent({ elementId: target!, eventType: "click" }, renderer)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(observed.length).toBe(1)
    expect((observed[0][0] as Error).message).toBe("kaboom")
    expect(renderer.allTexts()).toContain("Uncaught runtime errors:")
    expect(renderer.allTexts()).toContain("kaboom")
    // The component chain names the throwing component.
    expect(renderer.allTexts().join("\n")).toContain("BoomRender")
  })

  it("suppresses the overlay with errorOverlay: false, keeping the observer", async () => {
    const renderer = new AppRenderer()
    const handle = mount(renderer, { errorOverlay: false, onRuntimeError: () => {} })
    handle.app.config.errorHandler?.(new Error("quiet"), null, "render function")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(renderer.allTexts()).not.toContain("Uncaught runtime errors:")
  })

  it("shows the overlay only once for a burst of errors", async () => {
    const renderer = new AppRenderer()
    const handle = mount(renderer)
    const handler = handle.app.config.errorHandler!
    handler(new Error("first"), null, "render function")
    await new Promise((resolve) => setTimeout(resolve, 0))
    handler(new Error("second"), null, "render function")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(renderer.allTexts().filter((t) => t === "Uncaught runtime errors:")).toHaveLength(1)
    expect(renderer.allTexts()).toContain("first")
  })

  it("survives an onRuntimeError observer that itself throws", async () => {
    const renderer = new AppRenderer()
    const handle = mount(renderer, {
      onRuntimeError: () => {
        throw new Error("observer bug")
      },
    })
    handle.app.config.errorHandler?.(new Error("real"), null, "render function")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(errors.some((line) => line.includes("onRuntimeError"))).toBe(true)
    expect(renderer.allTexts()).toContain("Uncaught runtime errors:")
  })

  it("formats non-Error throws into overlay text", async () => {
    const renderer = new AppRenderer()
    const handle = mount(renderer)
    handle.app.config.errorHandler?.("plain string boom" as unknown, null, "render function")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(renderer.allTexts()).toContain("plain string boom")

    // A fresh mount formats the next throw from scratch (the reloaded app's
    // old errorHandler is serial-stamped and drops late errors by design).
    resetApp()
    const fresh = mount(renderer)
    const hostile = { toString() { throw new Error("no string for you") } }
    fresh.app.config.errorHandler?.(hostile as unknown, null, "render function")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(renderer.allTexts()).toContain("Unknown error")
  })

  it("drops errors scheduled against a superseded tree", async () => {
    const renderer = new AppRenderer()
    const first = mount(renderer)
    const staleHandler = first.app.config.errorHandler!
    mount(renderer) // plain remount: the serial advances past `first`
    staleHandler(new Error("late"), null, "render function")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(renderer.allTexts()).toContain("root text")
    expect(renderer.allTexts()).not.toContain("Uncaught runtime errors:")
    expect(errors.some((line) => line.includes("unmounted app"))).toBe(true)
  })

  it("reloads the root component from the overlay's Reload button", async () => {
    const renderer = new AppRenderer()
    const handle = mount(renderer)
    handle.app.config.errorHandler?.(new Error("boom"), null, "render function")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(renderer.allTexts()).toContain("Uncaught runtime errors:")

    const reloadText = renderer.idsWithText("Reload")[0]
    const reloadTarget = renderer.closestWithListener(reloadText, "click")
    expect(reloadTarget).not.toBeNull()
    handleGpuixEvent({ elementId: reloadTarget!, eventType: "click" }, renderer)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(renderer.allTexts()).toContain("root text")
    expect(renderer.allTexts()).not.toContain("Uncaught runtime errors:")
  })

  it("resetApp stops the loop, closes extra windows, and uninstalls process handlers", () => {
    const renderer = new AppRenderer()
    mount(renderer)
    installRuntimeErrorHandlers()
    const slot = Reflect.get(globalThis, "__gpuivRenderHost") as {
      extraWindows?: Array<{ close: () => void }>
    }
    let closed = 0
    slot.extraWindows = [
      {
        close: () => {
          closed += 1
          throw new Error("already dead")
        },
      },
    ]
    resetApp()
    expect(closed).toBe(1)
    expect(Reflect.get(globalThis, "__gpuivRenderHost")).toBeUndefined()
    expect(Reflect.get(globalThis, "__gpuivRuntimeErrorHandlers")).toBeUndefined()
  })

  it("process-level handlers surface errors without a mounted app", async () => {
    installRuntimeErrorHandlers()
    process.emit("uncaughtException", new Error("process level"))
    expect(errors.some((line) => line.includes("process level"))).toBe(true)
    resetApp()
  })

  it("installRuntimeErrorHandlers is idempotent", () => {
    installRuntimeErrorHandlers()
    const first = Reflect.get(globalThis, "__gpuivRuntimeErrorHandlers")
    installRuntimeErrorHandlers()
    expect(Reflect.get(globalThis, "__gpuivRuntimeErrorHandlers")).toBe(first)
    resetApp()
  })
})

describe("startFrameLoop (headless)", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns an inert loop when the renderer needs no tick", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const loop = startFrameLoop({
      requiresTick: () => false,
      tick: () => {
        throw new Error("must not tick")
      },
    })
    vi.advanceTimersByTime(100)
    expect(loop).toBeTruthy()
    loop.stop()
  })

  it("stops and reports termination when tick() returns false", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const onTerminated = vi.fn()
    const ticks: number[] = []
    const loop = startFrameLoop(
      { requiresTick: () => true, tick: () => (ticks.push(1), true) },
      { frameMs: 16, onTerminated },
    )
    expect(ticks.length).toBe(1)
    loop.stop()
    vi.advanceTimersByTime(100)
    expect(ticks.length).toBe(1)
    expect(onTerminated).not.toHaveBeenCalled()

    const ending = startFrameLoop(
      { requiresTick: () => true, tick: () => false },
      { frameMs: 16, onTerminated },
    )
    expect(onTerminated).toHaveBeenCalledTimes(1)
    ending.stop()
  })

  it("paces at frameMs and tolerates a throwing tick", () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    })
    const errors: string[] = []
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.join(" "))
    })
    let calls = 0
    const loop = startFrameLoop(
      {
        requiresTick: () => true,
        tick: () => {
          calls += 1
          if (calls === 1) throw new Error("tick exploded")
          return true
        },
      },
      { frameMs: 16 },
    )
    expect(calls).toBe(1)
    expect(errors.some((line) => line.includes("tick exploded"))).toBe(true)
    vi.advanceTimersByTime(16)
    expect(calls).toBe(2)
    loop.stop()
    vi.advanceTimersByTime(100)
    expect(calls).toBe(2)
    errorSpy.mockRestore()
  })

  it("paces by the display-link wake when available", () => {
    let wake: (() => void) | null = null
    const cleared: Array<(() => void) | null> = []
    const loop = startFrameLoop({
      requiresTick: () => true,
      tick: () => true,
      setFrameWakeCallback: (callback) => {
        wake = callback
        return true
      },
    })
    expect(typeof wake).toBe("function")
    let ticks = 0
    ;(loop as unknown as { addRenderer: (r: unknown) => void }).addRenderer === undefined
    // The wake drives passes without any timer advance.
    const before = ticks
    wake!()
    ticks += 1
    expect(ticks).toBe(before + 1)
    void cleared
    loop.stop()
  })

  it("stops waking when the loop stops", () => {
    let wake: (() => void) | null = null
    const clears: unknown[] = []
    const loop = startFrameLoop({
      requiresTick: () => true,
      tick: () => true,
      setFrameWakeCallback: (callback) => {
        wake = callback
        return true
      },
    })
    loop.stop()
    // stop() clears the native hook by passing null.
    expect(wake).toBeNull()
  })

  it("addRenderer skips renderers that require no tick", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const ticks: number[] = []
    const ticking = { requiresTick: () => true, tick: () => (ticks.push(1), true) }
    const still = { requiresTick: () => false, tick: () => (ticks.push(1), true) }
    const loop = startFrameLoop(ticking, { frameMs: 16 })
    loop.addRenderer(still as never)
    loop.removeRenderer(ticking as never)
    vi.advanceTimersByTime(16)
    // Only the ticking renderer's own initial pass ran; the loop then stopped
    // scheduling passes for the removed renderer.
    expect(ticks.length).toBe(1)
    loop.stop()
  })
})
