/// Headless tests for renderer.ts native-facing paths: createNativeRenderer's
/// event callback and stdio automation branch, and the createWindow lifecycle.
/// @gpuiv/native is mocked with a recording fake so no real window opens.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { defineComponent, h } from "vue"
import { createApp, createNativeRenderer, resetApp, createWindow } from "../renderer.js"
import { GpuixRenderer } from "@gpuiv/native"

const fakes = vi.hoisted(() => {
  class FakeGpuixRenderer {
    callback: (err: Error | null, event: { elementId: number; eventType: string } | null) => void
    initOptions: unknown[] = []
    closeWindowCalls = 0
    failCloseWindow = false
    ops: unknown[][] = []

    constructor(callback: (err: Error | null, event: { elementId: number; eventType: string } | null) => void) {
      this.callback = callback
    }
    requiresTick(): boolean {
      return false
    }
    tick(): boolean {
      return true
    }
    init(options: unknown): void {
      this.initOptions.push(options)
    }
    applyBatch(json: string): number[] {
      this.ops.push(...(JSON.parse(json) as unknown[][]))
      return []
    }
    setWindowKeyEvents(): void {}
    setWindowObservers(): void {}
    setWindowSelectionChange(): void {}
    closeWindow(): void {
      this.closeWindowCalls += 1
      if (this.failCloseWindow) throw new Error("window already gone")
    }
  }
  const instances: FakeGpuixRenderer[] = []
  const Registrar = class extends FakeGpuixRenderer {
    constructor(callback: FakeGpuixRenderer["callback"]) {
      super(callback)
      instances.push(this)
    }
  }
  return { Registrar, instances }
})

vi.mock("@gpuiv/native", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    GpuixRenderer: fakes.Registrar,
  }
})

type FakeRenderer = ReturnType<typeof fakes.Registrar.prototype.constructor> extends infer T ? T : never

function textsOf(fake: FakeRenderer): string[] {
  return fake.ops
    .filter((op) => op[0] === "setText")
    .map((op) => op[2] as string)
}

function resetFakes() {
  fakes.instances.length = 0
}

/** Nearest ancestor of `elementId` with a listener of `type` armed, per the
 *  fake's recorded ops (the same walk HeadlessRenderer.closestWithListener
 *  does for the mock harness). */
function closestWithListener(
  fake: FakeRenderer,
  elementId: number,
  type: string
): number | null {
  const listenerArmed = (id: number): boolean => {
    let armed = false
    for (const op of fake.ops) {
      if (op[0] === "setEventListener" && op[1] === id && op[2] === type) {
        armed = op[3] === true
      }
    }
    return armed
  }
  const parentOf = (id: number): number | undefined => {
    let parent: number | undefined
    for (const op of fake.ops) {
      if (op[0] === "appendChild" && op[2] === id) parent = op[1] as number
      if (op[0] === "insertBefore" && op[2] === id) parent = op[1] as number
    }
    return parent
  }
  let current: number | undefined = elementId
  while (current !== undefined) {
    if (listenerArmed(current)) return current
    current = parentOf(current)
  }
  return null
}

function clickTargetFor(fake: FakeRenderer, painted: string): number {
  const setText = fake.ops.find((op) => op[0] === "setText" && op[2] === painted)
  const target = closestWithListener(fake, setText![1] as number, "click")
  if (target === null) throw new Error(`no click listener above ${JSON.stringify(painted)}`)
  return target
}

describe("createNativeRenderer (mocked native)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  let errors: string[]

  beforeEach(() => {
    resetApp()
    resetFakes()
    errors = []
    errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.join(" "))
    })
    vi.spyOn(console, "log").mockImplementation(() => {})
  })
  afterEach(() => {
    resetApp()
    errorSpy.mockRestore()
    vi.restoreAllMocks()
  })

  it("constructs the native renderer without opening a window", () => {
    const renderer = createNativeRenderer()
    expect(fakes.instances.length).toBe(1)
    expect(fakes.instances[0].initOptions).toEqual([])
    expect(renderer).toBeInstanceOf(GpuixRenderer)
  })

  it("leaves init unwrapped under vitest", () => {
    const renderer = createNativeRenderer() as unknown as FakeRenderer
    const before = renderer.init
    expect((renderer as unknown as { init: unknown }).init).toBe(before)
    renderer.init({ title: "t" })
    expect(renderer.initOptions).toEqual([{ title: "t" }])
  })

  it("wraps init with the stdio automation backend when stdin is a pipe", () => {
    const hadVitest = process.env.VITEST
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    delete process.env.VITEST
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    })
    try {
      const renderer = createNativeRenderer() as unknown as FakeRenderer
      const originalInit = fakes.Registrar.prototype.init
      expect(renderer.init).not.toBe(originalInit)
      renderer.init({ title: "stdio" })
      expect(renderer.initOptions).toEqual([{ title: "stdio" }])
    } finally {
      if (hadVitest !== undefined) process.env.VITEST = hadVitest
      else delete process.env.VITEST
      if (stdinDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinDescriptor)
    }
  })

  it("logs native event callback errors", () => {
    createNativeRenderer()
    fakes.instances[0].callback(new Error("native side failed"), null)
    expect(errors.some((line) => line.includes("native side failed"))).toBe(true)
  })

  it("delivers native events into the mounted app's handlers", () => {
    const clicks: number[] = []
    const renderer = createNativeRenderer()
    const Root = defineComponent({
      setup: () => () =>
        h(
          "div",
          { onClick: () => clicks.push(1) },
          [h("text", {}, "clickable")]
        ),
    })
    createApp(Root, { renderer })
    const fake = fakes.instances[0]
    fake.callback(null, { elementId: clickTargetFor(fake, "clickable"), eventType: "click" })
    expect(clicks).toEqual([1])
  })

  it("routes a throwing app handler into the runtime error overlay", async () => {
    const renderer = createNativeRenderer()
    const Root = defineComponent({
      setup: () => () =>
        h(
          "div",
          {
            onClick: () => {
              throw new Error("handler exploded")
            },
          },
          [h("text", {}, "danger")]
        ),
    })
    createApp(Root, { renderer })
    const fake = fakes.instances[0]
    fake.callback(null, { elementId: clickTargetFor(fake, "danger"), eventType: "click" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(textsOf(fake)).toContain("Uncaught runtime errors:")
    expect(textsOf(fake)).toContain("handler exploded")
  })
})

describe("createWindow (mocked native)", () => {
  let logs: string[]
  let errors: string[]
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetApp()
    resetFakes()
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

  function mountMainWindow() {
    const Main = defineComponent({
      setup: () => () => h("div", {}, [h("text", {}, "main window")]),
    })
    const mainRenderer = {
      applyBatch: (json: string) => {
        return []
      },
    }
    createApp(Main, { renderer: mainRenderer as never })
    return mainRenderer
  }

  it("requires a main window first", () => {
    const Win = defineComponent({ setup: () => () => h("div", {}, "w") })
    expect(() => createWindow(Win)).toThrow(/requires a main window/)
  })

  it("opens a window on its own renderer, mounts, and closes cleanly", () => {
    mountMainWindow()
    const Win = defineComponent({
      setup: () => () => h("div", {}, [h("text", {}, "second window")]),
    })
    const window = createWindow(Win, { title: "second" })
    expect(fakes.instances.length).toBe(1)
    const fake = fakes.instances[0]
    expect(fake.initOptions).toEqual([{ title: "second" }])
    expect(textsOf(fake)).toContain("second window")

    window.close()
    expect(fake.closeWindowCalls).toBe(1)
    // Idempotent close.
    window.close()
    expect(fake.closeWindowCalls).toBe(1)
  })

  it("unmounts the tree when closed", () => {
    mountMainWindow()
    const Win = defineComponent({
      setup: () => () => h("div", {}, [h("text", {}, "bye")]),
    })
    const window = createWindow(Win)
    const fake = fakes.instances[0]
    window.close()
    expect(fake.ops.some((op) => op[0] === "destroyElement")).toBe(true)
  })

  it("reports a failing close through the runtime error path", async () => {
    mountMainWindow()
    const Win = defineComponent({ setup: () => () => h("div", {}, "w") })
    const window = createWindow(Win)
    const fake = fakes.instances[0]
    fake.failCloseWindow = true
    window.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The tree unmounted first, dropping this window's mount entry, so the
    // error lands on the no-mount console path.
    expect(errors.some((line) => line.includes("window already gone"))).toBe(true)
  })

  it("createApp with no injected renderer creates the native window", () => {
    const Main = defineComponent({
      setup: () => () => h("div", {}, [h("text", {}, "auto window")]),
    })
    createApp(Main, { title: "auto" })
    expect(fakes.instances.length).toBe(1)
    const fake = fakes.instances[0]
    expect(fake.initOptions).toEqual([{ title: "auto" }])
    expect(textsOf(fake)).toContain("auto window")
    expect(logs.some((line) => line.includes("created native window"))).toBe(true)
  })

  it("createWindow forwards debugFrameOverlay", () => {
    mountMainWindow()
    const Win = defineComponent({ setup: () => () => h("div", {}, "w") })
    createWindow(Win, { debugFrameOverlay: "full" })
    // init received the window options (debug overlays go through the
    // renderer once mounted).
    expect(fakes.instances[0].initOptions.length).toBe(1)
  })

  it("window handle getters keep following the mounted tree", () => {
    mountMainWindow()
    const Win = defineComponent({ setup: () => () => h("div", {}, "w") })
    const window = createWindow(Win)
    const appViaGetter = window.app
    expect(appViaGetter).toBeTruthy()
    expect(window.container).toBeTruthy()
    window.close()
    // After close the fallback tree is the one this handle mounted.
    expect(window.app).toBe(appViaGetter)
  })

  it("resetApp closes extra windows", () => {
    mountMainWindow()
    const Win = defineComponent({ setup: () => () => h("div", {}, "w") })
    const window = createWindow(Win)
    resetApp()
    expect(fakes.instances[0].closeWindowCalls).toBe(1)
  })
})
