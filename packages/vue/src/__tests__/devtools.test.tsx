/** Vue DevTools pipeline tests. The standalone devtools' component tree is
 *  driven entirely by the events Vue emits into __VUE_DEVTOOLS_GLOBAL_HOOK__
 *  (framework-level — no DOM involved). A fake hook, no server: mount, edit
 *  state, unmount, and assert the custom renderer drives that pipeline. */

import { defineComponent, h, ref } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { installDevtoolsShims } from "../devtools.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

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
