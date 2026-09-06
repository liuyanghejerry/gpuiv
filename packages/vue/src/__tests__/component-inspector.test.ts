/// Component-state inspection over the automation protocol.
///
/// Wire-path tests run everywhere against a mock renderer; the GPU-backed
/// integration tests need the native test renderer, like the rest of the
/// automation surface.

import { computed, defineComponent, h, ref, watchEffect } from "vue"
import { describe, expect, it } from "vitest"
import {
  AutomationError,
  connectTest,
  type TestAutomationRenderer,
} from "../automation/client.js"
import { createComponentInspector } from "../automation/component-inspector.js"
import { createTestApp, hasNativeTestRenderer, type TestApp } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

function wireApp(inspector?: Parameters<typeof connectTest>[2]) {
  return connectTest({} as unknown as TestAutomationRenderer, undefined, inspector)
}

describe("component inspector (wire)", () => {
  it("rejects getComponentTree with Unsupported when no inspector is attached", async () => {
    const app = await wireApp()
    await expect(app.components.tree()).rejects.toMatchObject({
      code: "Unsupported" satisfies AutomationError["code"],
    })
    await app.close()
  })

  it("returns null when the walk itself is not possible", async () => {
    const app = await wireApp({
      // No real Vue app behind this inspector: rootInstance() sees a dead
      // `_instance`, and the walker must answer null, never throw.
      getComponentTree: () => null,
      getComponentState: () => null,
    })
    expect(await app.components.tree()).toBeNull()
    await app.close()
  })

  it("reports the components capability at initialize", async () => {
    const app = await wireApp({
      getComponentTree: () => [],
      getComponentState: () => null,
    })
    const tree = await app.components.tree()
    expect(tree).toEqual([])
    await app.close()
  })
})

describeNative("component inspector (gpu)", () => {
  function mountTree(): TestApp {
    const Counter = defineComponent({
      name: "Counter",
      props: { label: { type: String, required: true } },
      setup(props) {
        const count = ref(3)
        const doubled = computed(() => count.value * 2)
        return { count, doubled }
      },
      render() {
        return h(
          "div",
          { testId: `counter-${this.label}`, style: { padding: 8 } },
          [h("text", `${this.label}: ${this.count}`)]
        )
      },
    })
    const App = defineComponent({
      name: "Root",
      setup() {
        return { sidebarOpen: ref(true) }
      },
      render() {
        return h("div", { style: { width: 200, height: 100 } }, [
          h(Counter, { label: "a" }),
          h(Counter, { label: "b" }),
        ])
      },
    })
    return createTestApp(App)
  }

  it("walks the component tree with names and nesting", async () => {
    const test = mountTree()
    const automation = await connectTest(
      test.renderer,
      test.settle,
      createComponentInspector(test.app)
    )
    const tree = await automation.components.tree()
    expect(tree).not.toBeNull()
    const [root] = tree!
    expect(root!.name).toBe("Root")
    expect(root!.state!.sidebarOpen).toBe(true)
    const names = root!.children!.map((child) => child.name)
    expect(names).toEqual(["Counter", "Counter"])
    await automation.close()
    test.unmount()
  })

  it("attributes host element ids to the component that rendered them", async () => {
    const test = mountTree()
    const automation = await connectTest(
      test.renderer,
      test.settle,
      createComponentInspector(test.app)
    )
    const counterB = await automation.getByTestId("counter-b").element()
    const state = await automation.components.state(counterB.id)
    expect(state).not.toBeNull()
    expect(state!.name).toBe("Counter")
    expect(state!.props!.label).toBe("b")
    expect(state!.state!.count).toBe(3)
    expect(state!.state!.doubled).toBe(6)
    await automation.close()
    test.unmount()
  })

  it("returns null for an element no component rendered", async () => {
    const test = mountTree()
    const automation = await connectTest(
      test.renderer,
      test.settle,
      createComponentInspector(test.app)
    )
    // The mount container is ours, not any component's.
    expect(await automation.components.state(0)).toBeNull()
    await automation.close()
    test.unmount()
  })

  it("serializes bounds: circular refs, functions, long strings, depth", async () => {
    const nested = { level: { level: { level: { level: { deep: true } } } } }
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const App = defineComponent({
      name: "Fat",
      setup() {
        return {
          circular,
          nested,
          handler: function onTick() {},
          long: "x".repeat(2000),
        }
      },
      render: () => h("div", { style: { width: 10, height: 10 } }),
    })
    const test = createTestApp(App)
    const automation = await connectTest(
      test.renderer,
      test.settle,
      createComponentInspector(test.app)
    )
    const tree = await automation.components.tree()
    const state = tree![0]!.state!
    expect(state.circular).toEqual({ self: "[circular]" })
    expect(state.handler).toBe("ƒ onTick()")
    expect((state.long as string).length).toBe(501)
    expect((state.long as string).endsWith("…")).toBe(true)
    expect(state.nested).toEqual({ level: { level: { level: "…" } } })
    await automation.close()
    test.unmount()
  })

  it("reads state without registering reactive dependencies", async () => {
    // Hoisted so the test can flip it after the inspector has read it.
    const count = ref(1)
    const App = defineComponent({
      name: "Watched",
      setup() {
        return { count }
      },
      render() {
        return h("div", { style: { width: 10, height: 10 } })
      },
    })
    const test = createTestApp(App)
    const automation = await connectTest(
      test.renderer,
      test.settle,
      createComponentInspector(test.app)
    )
    const [root] = (await automation.components.tree())!
    const elementId = root!.hostIds![0]!

    // An active effect that inspects component state must not subscribe to
    // it — otherwise one debug read would re-run the effect on every change.
    let runs = 0
    const stop = watchEffect(() => {
      runs += 1
      void automation.components.state(elementId)
    })
    await test.settle()
    expect(runs).toBe(1)
    count.value = 2
    await test.settle()
    expect(runs).toBe(1)
    await automation.close()
    stop()
    test.unmount()
  })
})
