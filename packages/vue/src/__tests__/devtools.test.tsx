/** Vue DevTools pipeline tests. The standalone devtools' component tree is
 *  driven entirely by the events Vue emits into __VUE_DEVTOOLS_GLOBAL_HOOK__
 *  (framework-level — no DOM involved). A fake hook, no server: mount, edit
 *  state, unmount, and assert the custom renderer drives that pipeline. */

import { defineComponent, h, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { connectVueDevtools, installDevtoolsShims } from "../devtools.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const devtoolsMock = vi.hoisted(() => ({
  connectCalls: [] as Array<[string | undefined, number | undefined | null]>,
  fail: false,
}))
vi.mock("@vue/devtools", () => ({
  devtools: {
    // Upstream's connect() installs the hook synchronously; the await stands
    // in for it here.
    connect: async (host?: string, port?: number | null) => {
      devtoolsMock.connectCalls.push([host, port ?? null])
      if (devtoolsMock.fail) throw new Error("simulated client failure")
    },
  },
}))

interface HookCall {
  event: string
  args: unknown[]
}

function installFakeHook(): { calls: HookCall[]; uninstall: () => void } {
  const g = globalThis as Record<string, unknown>
  const previous = g.__VUE_DEVTOOLS_GLOBAL_HOOK__
  const calls: HookCall[] = []
  g.__VUE_DEVTOOLS_GLOBAL_HOOK__ = {
    enabled: false,
    emit(event: string, ...args: unknown[]) {
      calls.push({ event, args })
    },
    // The real hook buffers added components; cleanupBuffer returning false
    // means "this component reached the client", so component:removed fires.
    cleanupBuffer: () => false,
  }
  return {
    calls,
    uninstall: () => {
      if (previous === undefined) delete g.__VUE_DEVTOOLS_GLOBAL_HOOK__
      else g.__VUE_DEVTOOLS_GLOBAL_HOOK__ = previous
    },
  }
}

describe("devtools shims", () => {
  it("installs window as globalThis plus inert document/window methods", () => {
    const g = globalThis as Record<string, unknown>
    const previousWindow = g.window
    const previousDocument = g.document
    const previousAdd = g.addEventListener
    try {
      delete g.window
      delete g.document
      delete g.addEventListener
      const installed = installDevtoolsShims()
      // The return value is what a failed connect rolls back.
      expect(installed).toContain("window")
      expect(installed).toContain("document")
      expect(installed).toContain("addEventListener")
      // window must BE globalThis: @vue/devtools-shared computes its global
      // target as window ?? globalThis, and the hook has to land where Vue
      // reads it.
      expect(g.window).toBe(g)
      expect(typeof g.addEventListener).toBe("function")
      expect(typeof g.removeEventListener).toBe("function")
      const doc = g.document as {
        createElement: () => {
          style: Record<string, unknown>
          scrollIntoView: (options?: { behavior?: string }) => void
        }
        body: { appendChild: (node: unknown) => void; removeChild: (node: unknown) => void }
        querySelectorAll: () => unknown[]
        getElementById: () => unknown
      }
      expect(doc.querySelectorAll()).toEqual([])
      expect(doc.getElementById()).toBeNull()
      expect(doc.createElement().style).toEqual({})

      // The user-app measures hook targets with createRange + getBoundingClientRect.
      const range = (g.document as { createRange: () => {
        selectNode: (node: unknown) => void
        getBoundingClientRect: () => { top: number; bottom: number; left: number; right: number; width: number; height: number }
      } }).createRange()
      expect(() => range.selectNode(doc.createElement())).not.toThrow()
      expect(range.getBoundingClientRect()).toEqual({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 })

      // `scrollToComponent` in @vue/devtools-electron@8.2.1
      // (dist/user-app.js, inlined in dist/index.js) falls back to exactly
      // this when the inspected component's root element has no
      // scrollIntoView — the stub has to survive it, not raise.
      const scrollTarget = doc.createElement()
      Object.assign(scrollTarget.style, { position: "absolute" })
      doc.body.appendChild(scrollTarget)
      expect(() => scrollTarget.scrollIntoView({ behavior: "smooth" })).not.toThrow()
      doc.body.removeChild(scrollTarget)

      // Idempotent, never clobbers an existing window, and installs nothing
      // the second time (so a rollback can never delete a foreign global).
      const marker = { custom: true }
      g.window = marker
      expect(installDevtoolsShims()).toEqual([])
      expect(g.window).toBe(marker)
    } finally {
      if (previousWindow === undefined) delete g.window
      else g.window = previousWindow
      if (previousDocument === undefined) delete g.document
      else g.document = previousDocument
      if (previousAdd === undefined) delete g.addEventListener
      else g.addEventListener = previousAdd
    }
  })
})

describeNative("vue devtools event pipeline", () => {
  let hook: ReturnType<typeof installFakeHook> | undefined

  afterEach(() => {
    hook?.uninstall()
    hook = undefined
  })

  it("emits app:init, component:added/updated/removed, app:unmount", async () => {
    hook = installFakeHook()
    const Child = defineComponent({
      name: "DtChild",
      setup() {
        const count = ref(0)
        return () =>
          h(
            "div",
            { testId: "child", style: { height: 40, width: 120 }, onClick: () => (count.value += 1) },
            `child ${count.value}`,
          )
      },
    })
    const App = defineComponent({
      name: "DtApp",
      setup: () => () => h("div", { style: { width: 200, height: 100 } }, [h(Child)]),
    })
    const app = createTestApp(App)
    await app.settle()

    const events = () => hook!.calls.map((call) => call.event)
    expect(events()).toContain("app:init")
    const added = hook!.calls.filter((call) => call.event === "component:added")
    // Root + child (and no renderer plumbing in between).
    expect(added.length).toBeGreaterThanOrEqual(2)
    const addedNames = added.map((call) => {
      const component = call.args[3] as { type: { name?: string } }
      return component.type.name
    })
    expect(addedNames).toContain("DtApp")
    expect(addedNames).toContain("DtChild")

    const child = app.renderer.findByTestId("child")!
    const bounds = app.renderer.getElementBounds(child.id)!
    hook!.calls.length = 0
    app.renderer.nativeSimulateClick(bounds.x + 4, bounds.y + 4)
    await app.settle()
    expect(events()).toContain("component:updated")

    hook!.calls.length = 0
    app.unmount()
    expect(events()).toContain("component:removed")
    expect(events()).toContain("app:unmount")
  })
})

describe("connectVueDevtools", () => {
  const SHIM_KEYS = ["window", "document", "location", "addEventListener", "removeEventListener"]
  const CONNECTED_KEY = "__gpuivDevtoolsConnected"
  let warn: ReturnType<typeof vi.spyOn>
  let previous: Map<string, unknown>

  const snapshot = (): Map<string, unknown> => {
    const g = globalThis as Record<string, unknown>
    return new Map([...SHIM_KEYS, CONNECTED_KEY].map((key) => [key, g[key]]))
  }
  const restore = (state: Map<string, unknown>): void => {
    const g = globalThis as Record<string, unknown>
    for (const [key, value] of state) {
      if (value === undefined) delete g[key]
      else g[key] = value
    }
  }

  beforeEach(() => {
    previous = snapshot()
    const g = globalThis as Record<string, unknown>
    delete g[CONNECTED_KEY]
    for (const key of SHIM_KEYS) delete g[key]
    devtoolsMock.connectCalls.length = 0
    devtoolsMock.fail = false
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    restore(previous)
  })

  it("connects once, keeps the shims, and short-circuits a later call", async () => {
    await expect(connectVueDevtools()).resolves.toBe(true)
    expect(devtoolsMock.connectCalls).toEqual([[undefined, null]])
    const g = globalThis as Record<string, unknown>
    expect(g[CONNECTED_KEY]).toBe(true)
    expect(g.window).toBe(g)

    // A hot reload reconnects through the flag, never a second client.
    await expect(connectVueDevtools()).resolves.toBe(true)
    expect(devtoolsMock.connectCalls).toHaveLength(1)
  })

  it("passes the host and port through, including a null port", async () => {
    await expect(connectVueDevtools({ host: "http://localhost", port: 1234 })).resolves.toBe(true)
    // A fresh process for the second call: the connected flag short-circuits.
    delete (globalThis as Record<string, unknown>)[CONNECTED_KEY]
    await expect(connectVueDevtools({ host: "http://gpuiv.dev", port: null })).resolves.toBe(true)
    expect(devtoolsMock.connectCalls).toEqual([
      ["http://localhost", 1234],
      ["http://gpuiv.dev", null],
    ])
  })

  it("warns, rolls every shim back, and leaves the process unconnected on failure", async () => {
    devtoolsMock.fail = true
    const g = globalThis as Record<string, unknown>
    await expect(connectVueDevtools()).resolves.toBe(false)
    expect(warn).toHaveBeenCalledWith(
      "[gpuiv] connectVueDevtools: could not start the devtools client.",
      expect.any(Error),
    )
    for (const key of SHIM_KEYS) expect(g[key], `${key} was not rolled back`).toBeUndefined()
    expect(g[CONNECTED_KEY]).toBeUndefined()

    // The rollback leaves a retry exactly as it found the process.
    devtoolsMock.fail = false
    await expect(connectVueDevtools()).resolves.toBe(true)
    expect(devtoolsMock.connectCalls).toHaveLength(2)
  })
})
