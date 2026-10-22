/// Automation client: InProcessBackend handlers, SSE transport, locators,
/// the stdio server, and launch. Headless — no native renderer involved.

import { describe, expect, it, vi } from "vitest"
import os from "node:os"
import path from "node:path"
import {
  App,
  connectStdio,
  connectTest,
  handleAutomationRequest,
  InProcessBackend,
  isServerEvent,
  launch,
  liveRendererAsTest,
  serveAutomationStdio,
  type AutomationBackend,
  type ComponentInspector,
  type LiveAutomationRenderer,
  type TestAutomationRenderer,
} from "../automation/client.js"
import {
  AutomationError,
  encodeSse,
  PROTOCOL_VERSION,
  type ElementBounds,
  type TreeNode,
} from "../automation/protocol.js"

class FakeRenderer implements TestAutomationRenderer {
  calls: Array<[name: string, args: unknown[]]> = []
  tree: unknown = null
  boundsById = new Map<number, ElementBounds>()
  scrollOffsets = new Map<number, [number, number]>()
  selected: string | null = "selected"
  screenshots: string[] = []
  getAllTextValue: unknown = ["all"]
  getPaintedTextValue: unknown = ["painted"]

  private record(name: string, ...args: unknown[]): void {
    this.calls.push([name, args])
  }

  names(): string[] {
    return this.calls.map(([name]) => name)
  }

  nativeSimulateClick(x: number, y: number, button?: number, modifiers?: string) {
    this.record("click", x, y, button, modifiers)
  }
  nativeSimulateMouseDown(x: number, y: number, button?: number, modifiers?: string) {
    this.record("mouseDown", x, y, button, modifiers)
  }
  nativeSimulateMouseUp(x: number, y: number, button?: number, modifiers?: string) {
    this.record("mouseUp", x, y, button, modifiers)
  }
  nativeSimulateMouseMove(x: number, y: number, pressedButton?: number, modifiers?: string) {
    this.record("mouseMove", x, y, pressedButton, modifiers)
  }
  nativeSimulateScrollWheel(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    modifiers?: string
  ) {
    this.record("scrollWheel", x, y, deltaX, deltaY, modifiers)
  }
  nativeSimulatePinch(
    x: number,
    y: number,
    delta: number,
    phase?: string,
    modifiers?: string
  ) {
    this.record("pinch", x, y, delta, phase, modifiers)
  }
  simulateKeystrokes(keys: string) {
    this.record("keystrokes", keys)
  }
  nativeSimulateKeystrokes(elementId: number, keys: string) {
    this.record("nativeKeystrokes", elementId, keys)
  }
  nativeSimulateKeyDown(elementId: number, keystroke: string, isHeld?: boolean) {
    this.record("keyDown", elementId, keystroke, isHeld)
  }
  nativeSimulateKeyUp(elementId: number, keystroke: string) {
    this.record("keyUp", elementId, keystroke)
  }
  scrollTo(elementId: number, x: number, y: number) {
    this.record("scrollTo", elementId, x, y)
  }
  getScrollOffset(elementId: number): [number, number] | null {
    return this.scrollOffsets.get(elementId) ?? null
  }
  getAllText(): string[] {
    return this.getAllTextValue as string[]
  }
  getPaintedText(): string[] {
    return this.getPaintedTextValue as string[]
  }
  getSelectedText(): string | null {
    return this.selected
  }
  clearSelection() {
    this.selected = null
    this.record("clearSelection")
  }
  captureScreenshot(file: string) {
    this.screenshots.push(file)
  }
  getAutomationTree(): string {
    return JSON.stringify(this.tree)
  }
  getElementBounds(elementId: number): ElementBounds | null {
    return this.boundsById.get(elementId) ?? null
  }
  clockPause() {
    this.record("clockPause")
    return 1111
  }
  clockSet(nowMs: number) {
    this.record("clockSet", nowMs)
    return nowMs
  }
  clockFastForward(deltaMs: number) {
    this.record("clockFastForward", deltaMs)
    return deltaMs
  }
  clockResume() {
    this.record("clockResume")
    return 2222
  }
  focusElement?(elementId: number) {
    this.record("focus", elementId)
  }
  blur?() {
    this.record("blur")
  }
}

function makeTree(): TreeNode {
  return {
    id: 1,
    type: "div",
    testId: "root",
    children: [
      {
        id: 2,
        type: "div",
        testId: "row",
        bounds: { x: 0, y: 0, width: 100, height: 20 },
        children: [{ id: 3, type: "text", text: "Hello" }],
      },
      {
        id: 4,
        type: "div",
        testId: "row",
        bounds: { x: 0, y: 20, width: 100, height: 20 },
        children: [{ id: 5, type: "text", text: "World" }],
      },
      {
        id: 6,
        type: "input",
        testId: "name",
        bounds: { x: 0, y: 40, width: 80, height: 24 },
      },
      { id: 7, type: "div", testId: "fallback" },
      { id: 8, type: "div", testId: "vanish" },
    ],
  }
}

const inspector: ComponentInspector = {
  getComponentTree: () => [{ id: 1, name: "Root", children: [{ id: 2, name: "Child" }] }],
  getComponentState: (elementId) => (elementId === 6 ? { id: 9, name: "Owner" } : null),
}

async function makeApp(withInspector = false) {
  const fake = new FakeRenderer()
  fake.tree = makeTree()
  fake.boundsById.set(7, { x: 5, y: 5, width: 10, height: 10 })
  fake.scrollOffsets.set(6, [3, 7])
  const settle = vi.fn()
  const app = await connectTest(fake, settle, withInspector ? inspector : undefined)
  return { app, fake, settle }
}

describe("connectTest / InProcessBackend", () => {
  it("initializes with capabilities", async () => {
    const { app } = await makeApp()
    const info = await app.call("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      client: "test",
    })
    expect(info.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(info.pid).toBe(process.pid)
    expect(info.capabilities).toContain("tree")
    expect(info.window).toEqual({ width: 800, height: 600 })
  })

  it("dispatches pointer input and settles", async () => {
    const { app, fake, settle } = await makeApp()
    await app.call("click", { x: 1, y: 2, button: 2, modifiers: "cmd" })
    await app.call("mouseDown", { x: 3, y: 4, button: 1 })
    await app.call("mouseUp", { x: 5, y: 6 })
    await app.call("mouseMove", { x: 7, y: 8, pressedButton: 0, modifiers: "alt" })
    await app.call("scrollWheel", { x: 9, y: 10, deltaX: -1, deltaY: 2 })
    await app.call("pinch", { x: 11, y: 12, delta: 3, phase: "started" })
    expect(fake.calls).toEqual([
      ["click", [1, 2, 2, "cmd"]],
      ["mouseDown", [3, 4, 1, undefined]],
      ["mouseUp", [5, 6, undefined, undefined]],
      ["mouseMove", [7, 8, 0, "alt"]],
      ["scrollWheel", [9, 10, -1, 2, undefined]],
      ["pinch", [11, 12, 3, "started", undefined]],
    ])
    expect(settle).toHaveBeenCalledTimes(6)
  })

  it("routes keystrokes with and without an element", async () => {
    const { app, fake } = await makeApp()
    await app.call("keystrokes", { keys: "a b" })
    await app.call("keystrokes", { keys: "c", elementId: 6 })
    await app.call("keyDown", { key: "shift", isHeld: true })
    await app.call("keyDown", { key: "a", elementId: 6 })
    await app.call("keyUp", { key: "a" })
    await app.call("keyUp", { key: "shift", elementId: 6 })
    expect(fake.calls).toEqual([
      ["keystrokes", ["a b"]],
      ["nativeKeystrokes", [6, "c"]],
      ["keyDown", [0, "shift", true]],
      ["keyDown", [6, "a", undefined]],
      ["keyUp", [0, "a"]],
      ["keyUp", [6, "shift"]],
    ])
  })

  it("focus, blur, scrollTo, and scroll offset", async () => {
    const { app, fake } = await makeApp()
    await app.call("focus", { elementId: 6 })
    await app.call("blur", {})
    await app.call("scrollTo", { elementId: 6, x: 4, y: 5 })
    expect(await app.call("getScrollOffset", { elementId: 6 })).toEqual({ offset: [3, 7] })
    expect(await app.call("getScrollOffset", { elementId: 99 })).toEqual({ offset: null })
    expect(fake.names()).toEqual(["focus", "blur", "scrollTo"])
  })

  it("tolerates a renderer without optional focus methods", async () => {
    const bare = new FakeRenderer()
    bare.focusElement = undefined
    bare.blur = undefined
    const app = await connectTest(bare)
    await app.call("focus", { elementId: 1 })
    await app.call("blur", {})
    expect(bare.calls).toEqual([])
  })

  it("reads text, tree, bounds, and selection", async () => {
    const { app, fake } = await makeApp()
    expect(await app.call("getPaintedText", {})).toEqual({ text: ["painted"] })
    expect(await app.call("getAllText", {})).toEqual({ text: ["all"] })
    const { tree } = await app.call("getTree", {})
    expect(tree?.id).toBe(1)
    fake.tree = null
    expect(await app.call("getTree", {})).toEqual({ tree: null })
    expect(await app.call("getBounds", { elementId: 7 })).toEqual({
      bounds: { x: 5, y: 5, width: 10, height: 10 },
    })
    expect(await app.call("getBounds", { elementId: 99 })).toEqual({ bounds: null })
    expect(await app.call("getSelectedText", {})).toEqual({ text: "selected" })
    await app.call("clearSelection", {})
    expect(fake.selected).toBeNull()
  })

  it("screenshots and drives the clock", async () => {
    const { app, fake } = await makeApp()
    await app.call("screenshot", { path: "/tmp/a.png" })
    expect(fake.screenshots).toEqual(["/tmp/a.png"])
    expect(await app.call("clockPause", {})).toEqual({ nowMs: 1111 })
    expect(await app.call("clockSet", { nowMs: 50 })).toEqual({ nowMs: 50 })
    expect(await app.call("clockFastForward", { deltaMs: 25 })).toEqual({ nowMs: 25 })
    expect(await app.call("clockResume", {})).toEqual({ nowMs: 2222 })
    expect(await app.call("cancel", { id: 4 })).toEqual({ ok: true })
  })

  it("rejects invalid params and malformed results", async () => {
    const { app, fake } = await makeApp()
    await expect(app.call("click", { x: "no", y: 0 } as never)).rejects.toThrow()
    await expect(app.call("clockSet", { nowMs: -1 })).rejects.toThrow()
    fake.getAllTextValue = 42
    await expect(app.call("getAllText", {})).rejects.toThrow()
  })

  it("refuses calls after close", async () => {
    const { app } = await makeApp()
    await app.close()
    await app.close()
    await expect(app.call("blur", {})).rejects.toMatchObject({ code: "Closed" })
  })

  it("requires a component inspector", async () => {
    const { app } = await makeApp()
    await expect(app.components.tree()).rejects.toMatchObject({ code: "Unsupported" })
    await expect(app.components.state(6)).rejects.toMatchObject({ code: "Unsupported" })
  })

  it("late-attaches a component inspector", async () => {
    const backend = new InProcessBackend(new FakeRenderer())
    const app = new App(backend)
    await expect(app.components.tree()).rejects.toMatchObject({ code: "Unsupported" })
    backend.setComponentInspector(inspector)
    expect((await app.components.tree())?.[0]?.name).toBe("Root")
    expect((await app.components.state(6))?.name).toBe("Owner")
    expect(await app.components.state(1)).toBeNull()
  })
})

describe("SseBackend", () => {
  const initResult = {
    protocolVersion: PROTOCOL_VERSION,
    pid: 1,
    capabilities: [],
    window: { width: 1, height: 1 },
  }

  async function makeSseApp(
    handle: (message: { id: number; method: string; params: unknown }) => unknown,
    onClose = vi.fn()
  ) {
    let listener: ((chunk: string) => void) | undefined
    const written: string[] = []
    const app = await connectStdio({
      write(chunk: string) {
        written.push(chunk)
        const message = JSON.parse(chunk.replace(/^data: /, "").trim())
        const reply = handle(message)
        if (reply !== undefined) {
          queueMicrotask(() => listener?.(encodeSse(reply as never)))
        }
      },
      feed(l: (chunk: string) => void) {
        listener = l
      },
      close: onClose,
    })
    return {
      app,
      written,
      onClose,
      feed(chunk: string) {
        listener?.(chunk)
      },
    }
  }

  it("round-trips requests", async () => {
    const { app, written } = await makeSseApp((m) =>
      m.method === "getPaintedText" ? { id: m.id, result: { text: ["hi"] } } : { id: m.id, result: initResult }
    )
    expect(await app.call("getPaintedText", {})).toEqual({ text: ["hi"] })
    expect(JSON.parse(written[0].replace(/^data: /, "").trim()).method).toBe("initialize")
  })

  it("surfaces error payloads with data", async () => {
    const { app } = await makeSseApp((m) =>
      m.method === "initialize"
        ? { id: m.id, result: initResult }
        : { id: m.id, error: { code: "NotFound", message: "nope", data: { hint: 1 } } }
    )
    const error: AutomationError = await app.call("blur", {}).then(
      () => {
        throw new Error("expected rejection")
      },
      (e) => e
    )
    expect(error).toBeInstanceOf(AutomationError)
    expect(error.code).toBe("NotFound")
    expect(error.data).toEqual({ hint: 1 })
  })

  it("tags requests with the window index", async () => {
    const { app, written, feed } = await makeSseApp((m) =>
      m.method === "initialize" ? { id: m.id, result: initResult } : { id: m.id, result: { ok: true } }
    )
    const pending = app.window(1).call("blur", {})
    const request = JSON.parse(written.at(-1)!.replace(/^data: /, "").trim())
    expect(request.window).toBe(1)
    feed(encodeSse({ id: request.id, result: { ok: true } }))
    await expect(pending).resolves.toEqual({ ok: true })
  })

  it("rejects requests whose write throws", async () => {
    let first = true
    let listener: ((chunk: string) => void) | undefined
    const app = await connectStdio({
      write(chunk: string) {
        if (first) {
          first = false
          listener?.(
            encodeSse({
              id: JSON.parse(chunk.replace(/^data: /, "").trim()).id,
              result: initResult,
            } as never)
          )
          return
        }
        throw new Error("pipe broken")
      },
      feed(l: (chunk: string) => void) {
        listener = l
      },
    })
    await expect(app.call("blur", {})).rejects.toThrow("pipe broken")
  })

  it("ignores events, requests, and unknown ids on the feed", async () => {
    const { app, feed } = await makeSseApp((m) =>
      m.method === "getPaintedText"
        ? { id: m.id, result: { text: ["after noise"] } }
        : { id: m.id, result: initResult }
    )
    feed(encodeSse({ event: "console", params: { text: "noise" } }))
    feed(encodeSse({ id: 77, method: "blur", params: {} }))
    feed(encodeSse({ id: 999, result: { ok: true } }))
    expect(await app.call("getPaintedText", {})).toEqual({ text: ["after noise"] })
  })

  it("close rejects pending requests and runs onClose once", async () => {
    const onClose = vi.fn()
    const { app } = await makeSseApp(
      (m) => (m.method === "initialize" ? { id: m.id, result: initResult } : undefined),
      onClose
    )
    const pending = app.call("blur", {})
    for (let i = 0; i < 20; i++) await Promise.resolve()
    await app.close()
    await expect(pending).rejects.toMatchObject({ code: "Closed" })
    await app.close()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe("locators", () => {
  it("queries by testId, text, and type", async () => {
    const { app } = await makeApp()
    expect(await app.getByTestId("root").count()).toBe(1)
    expect((await app.getByTestId("root").element()).id).toBe(1)
    expect((await app.getByText("Wor").element()).id).toBe(5)
    expect((await app.getByType("input").element()).id).toBe(6)
    const rows = await app.getByTestId("row").all()
    expect(rows.map((n) => n.id)).toEqual([2, 4])
    await expect(app.getByTestId("nope").element()).rejects.toMatchObject({ code: "NotFound" })
    await expect(app.getByTestId("row").element()).rejects.toMatchObject({ code: "Ambiguous" })
  })

  it("chains selectors and walks shared subtrees once", async () => {
    const fake = new FakeRenderer()
    fake.tree = {
      id: 1,
      type: "div",
      children: [
        {
          id: 10,
          type: "div",
          testId: "p",
          children: [
            { id: 11, type: "div", testId: "p", children: [{ id: 12, type: "text", text: "x" }] },
            { id: 13, type: "div", children: [{ id: 14, type: "text", text: "y" }] },
          ],
        },
      ],
    }
    const app = new App(new InProcessBackend(fake))
    const texts = await app.getByTestId("p").getByType("text").all()
    expect(texts.map((n) => n.id)).toEqual([12, 14])
  })

  it("resolves bounds from the node, the backend, or fails", async () => {
    const { app } = await makeApp()
    // On the node itself
    expect(await app.getByTestId("name").bounds()).toEqual({ x: 0, y: 40, width: 80, height: 24 })
    // Falling back to getBounds
    expect(await app.getByTestId("fallback").bounds()).toEqual({ x: 5, y: 5, width: 10, height: 10 })
    // Nowhere
    await expect(app.getByTestId("vanish").bounds()).rejects.toMatchObject({ code: "NotFound" })
    expect(await app.getByTestId("name").center()).toEqual({ x: 40, y: 52 })
  })

  it("clicks, hovers, wheels, and pinches at the centre", async () => {
    const { app, fake } = await makeApp()
    await app.getByTestId("name").click({ button: 2, modifiers: "cmd" })
    await app.getByTestId("name").hover({ modifiers: "alt" })
    await app.getByTestId("name").wheel(-3, 7)
    await app.getByTestId("name").pinch(4, { phase: "started" })
    expect(fake.calls).toEqual([
      ["click", [40, 52, 2, "cmd"]],
      ["mouseMove", [40, 52, undefined, "alt"]],
      ["scrollWheel", [40, 52, -3, 7, undefined]],
      ["pinch", [40, 52, 4, "started", undefined]],
    ])
  })

  it("drags between points with interpolated moves", async () => {
    const { app, fake } = await makeApp()
    await app.mouse.drag({ x: 0, y: 0 }, { x: 10, y: 0 }, { steps: 1 })
    expect(fake.calls).toEqual([
      ["mouseMove", [0, 0, undefined, undefined]],
      ["mouseDown", [0, 0, 0, undefined]],
      ["mouseMove", [10, 0, 0, undefined]],
      ["mouseUp", [10, 0, 0, undefined]],
    ])
    fake.calls.length = 0
    await app.mouse.drag({ x: 0, y: 0 }, { x: 10, y: 0 }, { steps: 2, button: 1, modifiers: "cmd", offset: { x: 1, y: 2 } })
    expect(fake.calls).toEqual([
      ["mouseMove", [1, 2, undefined, "cmd"]],
      ["mouseDown", [1, 2, 1, "cmd"]],
      ["mouseMove", [5.5, 1, 1, "cmd"]],
      ["mouseMove", [10, 0, 1, "cmd"]],
      ["mouseUp", [10, 0, 1, "cmd"]],
    ])
  })

  it("drags from a locator to a locator or by an offset", async () => {
    const { app, fake } = await makeApp()
    // name centre (40, 52) → fallback centre (10, 10), two interpolated moves
    await app.getByTestId("name").dragTo(app.getByTestId("fallback"), { steps: 2 })
    expect(fake.calls).toEqual([
      ["mouseMove", [40, 52, undefined, undefined]],
      ["mouseDown", [40, 52, 0, undefined]],
      ["mouseMove", [25, 31, 0, undefined]],
      ["mouseMove", [10, 10, 0, undefined]],
      ["mouseUp", [10, 10, 0, undefined]],
    ])
    fake.calls.length = 0
    await app.getByTestId("name").dragBy(10, 5, { steps: 1, offset: { x: 1, y: 1 } })
    expect(fake.calls).toEqual([
      ["mouseMove", [41, 53, undefined, undefined]],
      ["mouseDown", [41, 53, 0, undefined]],
      ["mouseMove", [51, 58, 0, undefined]],
      ["mouseUp", [51, 58, 0, undefined]],
    ])
  })

  it("raw mouse verbs resolve locator targets", async () => {
    const { app, fake } = await makeApp()
    await app.mouse.move({ x: 1, y: 2 }, { pressedButton: 0 })
    await app.mouse.down(app.getByTestId("name"))
    await app.mouse.up({ x: 3, y: 4 })
    await app.mouse.click({ x: 5, y: 6 }, { button: 1 })
    await app.mouse.wheel({ x: 7, y: 8 }, 1, 2)
    await app.mouse.pinch({ x: 9, y: 10 }, 3, { phase: "ended" })
    expect(fake.calls).toEqual([
      ["mouseMove", [1, 2, 0, undefined]],
      ["mouseDown", [40, 52, undefined, undefined]],
      ["mouseUp", [3, 4, undefined, undefined]],
      ["click", [5, 6, 1, undefined]],
      ["scrollWheel", [7, 8, 1, 2, undefined]],
      ["pinch", [9, 10, 3, "ended", undefined]],
    ])
  })

  it("fill selects all then types, translating specials", async () => {
    const { app, fake } = await makeApp()
    const platform = process.platform
    await app.getByTestId("name").fill("a c")
    await app.getByTestId("name").fill("x\ny\tz")
    await app.getByTestId("name").fill("")
    const keys = fake.calls.filter(([name]) => name === "nativeKeystrokes").map(([, args]) => args[1])
    const selectAll = platform === "darwin" ? "cmd-a" : "ctrl-a"
    expect(keys).toEqual([
      `${selectAll} a space c`,
      `${selectAll} x enter y tab z`,
      `${selectAll} backspace`,
    ])
  })

  it("press sends a raw key string to the element", async () => {
    const { app, fake } = await makeApp()
    await app.getByTestId("name").press("enter")
    expect(fake.calls).toEqual([["nativeKeystrokes", [6, "enter"]]])
  })

  it("textContent joins descendants in document order", async () => {
    const { app } = await makeApp()
    expect(await app.getByTestId("root").textContent()).toBe("HelloWorld")
    expect(await app.getByText("Wor").textContent()).toBe("World")
  })

  it("waitFor returns immediately when exactly one match exists", async () => {
    const { app } = await makeApp()
    expect((await app.getByTestId("name").waitFor()).id).toBe(6)
  })

  it("waitFor times out with Timeout or Ambiguous", async () => {
    const { app } = await makeApp()
    await expect(app.getByTestId("nope").waitFor({ timeoutMs: 0 })).rejects.toMatchObject({
      code: "Timeout",
    })
    await expect(app.getByTestId("row").waitFor({ timeoutMs: 0 })).rejects.toMatchObject({
      code: "Ambiguous",
    })
  })

  it("waitFor retries until the element appears", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] })
    try {
      const { app, fake } = await makeApp()
      const pending = app.getByTestId("late").waitFor({ timeoutMs: 5000 })
      for (let i = 0; i < 30; i++) await Promise.resolve()
      fake.tree = { id: 50, type: "div", testId: "late" }
      await vi.advanceTimersByTimeAsync(16)
      expect((await pending).id).toBe(50)
    } finally {
      vi.useRealTimers()
    }
  })

  it("window views validate the index and route the context", async () => {
    const { app } = await makeApp()
    expect(() => app.window(-1)).toThrow(AutomationError)
    expect(() => app.window(1.5)).toThrow(AutomationError)
    expect(() => app.window(0)).not.toThrow()
    // Routing of the window tag over the wire is covered by the SSE suite;
    // in-process backends ignore it.
    await expect(app.window(2).call("blur", {})).resolves.toEqual({ ok: true })
  })

  it("clock, screenshot, and component views", async () => {
    const { app, fake } = await makeApp(true)
    expect(await app.clock.pause()).toBe(1111)
    expect(await app.clock.set(60)).toBe(60)
    expect(await app.clock.fastForward(5)).toBe(5)
    expect(await app.clock.resume()).toBe(2222)
    expect(await app.screenshot({ path: "/tmp/shot.png" })).toBe("/tmp/shot.png")
    expect(fake.screenshots).toEqual(["/tmp/shot.png"])
    expect((await app.components.tree())?.[0]?.name).toBe("Root")
    expect((await app.components.state(6))?.name).toBe("Owner")
  })

  it("captureFrames pauses the clock and screenshots each timestamp", async () => {
    const { app, fake } = await makeApp()
    const dir = path.join(os.tmpdir(), `gpuiv-frames-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const files = await app.captureFrames(dir, [100, 200])
    expect(files).toEqual([path.join(dir, "t100.png"), path.join(dir, "t200.png")])
    expect(fake.names()).toEqual(["clockPause", "clockSet", "clockSet"])
    expect(fake.screenshots).toEqual(files)
  })
})

describe("liveRendererAsTest", () => {
  function liveFake(withKeys = true) {
    const calls: Array<[name: string, args: unknown[]]> = []
    const record = (name: string, ...args: unknown[]) => calls.push([name, args])
    const renderer: LiveAutomationRenderer = {
      simulateClick: (x, y, b, m) => record("click", x, y, b, m),
      simulateMouseDown: (x, y, b, m) => record("mouseDown", x, y, b, m),
      simulateMouseUp: (x, y, b, m) => record("mouseUp", x, y, b, m),
      simulateMouseMove: (x, y, p, m) => record("mouseMove", x, y, p, m),
      simulateScrollWheel: (x, y, dx, dy, m) => record("scrollWheel", x, y, dx, dy, m),
      simulatePinch: (x, y, d, p, m) => record("pinch", x, y, d, p, m),
      ...(withKeys
        ? {
            simulateKeystrokes: (k: string) => record("keystrokes", k),
            simulateKeyDown: (k: string, held?: boolean) => record("keyDown", k, held),
            simulateKeyUp: (k: string) => record("keyUp", k),
          }
        : {}),
      tick: () => record("tick"),
      focusElement: (id) => record("focus", id),
      blur: () => record("blur"),
      scrollTo: (id, x, y) => record("scrollTo", id, x, y),
      getScrollOffset: (id) => (id === 1 ? [3, 4] : null),
      getAllText: () => ["a"],
      getPaintedText: () => ["p"],
      getSelectedText: () => null,
      clearSelection: () => record("clearSelection"),
      captureScreenshot: (file) => record("screenshot", file),
      getAutomationTree: () => "null",
      getElementBounds: () => null,
      clockPause: () => 1,
      clockSet: (n) => n,
      clockFastForward: (d) => d,
      clockResume: () => 2,
    }
    return { renderer, calls }
  }

  it("wraps pointer calls and ticks after each", () => {
    const { renderer, calls } = liveFake()
    const t = liveRendererAsTest(renderer)
    t.nativeSimulateClick(1, 2, 2, "cmd")
    t.nativeSimulateMouseDown(3, 4)
    t.nativeSimulateMouseUp(5, 6)
    t.nativeSimulateMouseMove(7, 8, 0)
    t.nativeSimulateScrollWheel(9, 10, -1, 2)
    t.nativeSimulatePinch(11, 12, 3, "started")
    expect(calls).toEqual([
      ["click", [1, 2, 2, "cmd"]],
      ["tick", []],
      ["mouseDown", [3, 4, undefined, undefined]],
      ["tick", []],
      ["mouseUp", [5, 6, undefined, undefined]],
      ["tick", []],
      ["mouseMove", [7, 8, 0, undefined]],
      ["tick", []],
      ["scrollWheel", [9, 10, -1, 2, undefined]],
      ["tick", []],
      ["pinch", [11, 12, 3, "started", undefined]],
      ["tick", []],
    ])
  })

  it("keystroke wrappers focus the element first", () => {
    const { renderer, calls } = liveFake()
    const t = liveRendererAsTest(renderer)
    t.simulateKeystrokes("a b")
    t.nativeSimulateKeystrokes(5, "c")
    t.nativeSimulateKeyDown(5, "shift", true)
    t.nativeSimulateKeyDown(0, "a")
    t.nativeSimulateKeyUp(5, "shift")
    t.nativeSimulateKeyUp(0, "a")
    expect(calls).toEqual([
      ["keystrokes", ["a b"]],
      ["tick", []],
      ["focus", [5]],
      ["keystrokes", ["c"]],
      ["tick", []],
      ["focus", [5]],
      ["keyDown", ["shift", true]],
      ["tick", []],
      ["keyDown", ["a", undefined]],
      ["tick", []],
      ["focus", [5]],
      ["keyUp", ["shift"]],
      ["tick", []],
      ["keyUp", ["a"]],
      ["tick", []],
    ])
  })

  it("throws Unsupported when live input hooks are missing", () => {
    const { renderer } = liveFake(false)
    const t = liveRendererAsTest(renderer)
    expect(() => t.simulateKeystrokes("a")).toThrow(AutomationError)
    expect(() => t.nativeSimulateKeystrokes(1, "a")).toThrow(AutomationError)
    expect(() => t.nativeSimulateKeyDown(1, "a")).toThrow(AutomationError)
    expect(() => t.nativeSimulateKeyUp(1, "a")).toThrow(AutomationError)
  })

  it("passes queries and clock through", () => {
    const { renderer, calls } = liveFake()
    const t = liveRendererAsTest(renderer)
    t.scrollTo(7, 1, 2)
    expect(t.getScrollOffset(1)).toEqual([3, 4])
    expect(t.getScrollOffset(2)).toBeNull()
    expect(t.getAllText()).toEqual(["a"])
    expect(t.getPaintedText()).toEqual(["p"])
    expect(t.getSelectedText()).toBeNull()
    t.clearSelection()
    t.captureScreenshot("/x.png")
    expect(t.getAutomationTree()).toBe("null")
    expect(t.getElementBounds(1)).toBeNull()
    expect(t.clockPause()).toBe(1)
    expect(t.clockSet(9)).toBe(9)
    expect(t.clockFastForward(4)).toBe(4)
    expect(t.clockResume()).toBe(2)
    t.focusElement?.(8)
    t.blur?.()
    expect(calls.map(([name]) => name)).toEqual([
      "scrollTo",
      "clearSelection",
      "screenshot",
      "focus",
      "blur",
    ])
  })
})

describe("handleAutomationRequest", () => {
  const okBackend: AutomationBackend = {
    call: async () => ({ text: ["x"] }),
    close: async () => {},
  }

  it("encodes success replies", async () => {
    const out = await handleAutomationRequest({ id: 7, method: "getAllText", params: {} }, okBackend)
    expect(out).toBe(encodeSse({ id: 7, result: { text: ["x"] } }))
  })

  it("encodes AutomationError replies with data", async () => {
    const backend: AutomationBackend = {
      call: async () => {
        throw new AutomationError("NotFound", "gone", { hint: 2 })
      },
      close: async () => {},
    }
    const out = await handleAutomationRequest({ id: 8, method: "blur", params: {} }, backend)
    expect(out).toBe(
      encodeSse({ id: 8, error: { code: "NotFound", message: "gone", data: { hint: 2 } } })
    )
  })

  it("wraps plain failures as Protocol errors", async () => {
    const backend: AutomationBackend = {
      call: async () => {
        throw new Error("boom")
      },
      close: async () => {},
    }
    const out = await handleAutomationRequest({ id: 9, method: "blur", params: {} }, backend)
    expect(out).toBe(
      encodeSse({ id: 9, error: { code: "Protocol", message: "Error: boom" } })
    )
  })

  it("rejects non-request wire messages", () => {
    expect(() => handleAutomationRequest({ id: 1, result: {} }, okBackend)).toThrow(AutomationError)
    expect(() => handleAutomationRequest(42, okBackend)).toThrow(AutomationError)
  })
})

describe("stdio server", () => {
  it("routes window requests over stdin and replies on stdout", async () => {
    const fake = new FakeRenderer()
    fake.getAllTextValue = ["main"]
    serveAutomationStdio(new InProcessBackend(fake))
    const secondFake = new FakeRenderer()
    secondFake.getAllTextValue = ["second"]
    serveAutomationStdio(new InProcessBackend(secondFake))

    const writes: string[] = []
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: Uint8Array | string) => {
        writes.push(String(chunk))
        return true
      }) as typeof process.stdout.write)
    // The server installs a permanent stdin listener; other suites that ran
    // earlier in this worker (e.g. renderer-native's stdio branch) may have
    // one too and answer the same request id. Scan for our payload rather
    // than asserting on the last write.
    const repliesOf = (id: number): unknown[] =>
      writes
        .map((w) => {
          try {
            return JSON.parse(w.replace(/^data: /, "").trim())
          } catch {
            return null
          }
        })
        .filter((m) => m !== null && m.id === id)
    try {
      process.stdin.emit("data", encodeSse({ id: 41, method: "getAllText", params: {} }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(repliesOf(41)).toContainEqual({ id: 41, result: { text: ["main"] } })

      process.stdin.emit("data", encodeSse({ id: 42, method: "getAllText", params: {}, window: 1 }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(repliesOf(42)).toContainEqual({ id: 42, result: { text: ["second"] } })

      process.stdin.emit("data", encodeSse({ id: 43, method: "blur", params: {}, window: 5 }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(repliesOf(43)).toContainEqual({
        id: 43,
        error: {
          code: "NotFound",
          message: "window 5 is not open (2 window(s) registered)",
        },
      })
    } finally {
      spy.mockRestore()
    }
  })
})

describe("launch", () => {
  it("handshakes with a child process and closes it", { timeout: 15000 }, async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    try {
      const childScript = `
        process.stderr.write("child-alive\\n")
        process.stdout.write("data: " + JSON.stringify({
          id: 1,
          result: {
            protocolVersion: 1,
            pid: process.pid,
            capabilities: [],
            window: { width: 10, height: 20 },
          },
        }) + "\\n\\n")
      `
      const app = await launch({ command: process.execPath, args: ["-e", childScript] })
      await app.close()
      await vi.waitFor(() => {
        expect(errSpy.mock.calls.some((call) => String(call[0]).includes("child-alive"))).toBe(true)
      })
    } finally {
      errSpy.mockRestore()
    }
  })
})

describe("isServerEvent", () => {
  it("accepts event messages without a method", () => {
    expect(isServerEvent({ event: "console", params: { text: "x" } })).toBe(true)
    expect(isServerEvent({ id: 1, method: "blur", params: {} })).toBe(false)
    expect(isServerEvent(null)).toBe(false)
    expect(isServerEvent("event")).toBe(false)
  })
})
