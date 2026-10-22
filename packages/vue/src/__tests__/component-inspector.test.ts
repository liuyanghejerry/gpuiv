/// Component-state inspection over the automation protocol.
///
/// Wire-path tests run everywhere against a mock renderer; the GPU-backed
/// integration tests need the native test renderer, like the rest of the
/// automation surface.

import { computed, defineComponent, h, ref, watchEffect, type App as VueApp } from "vue"
import { describe, expect, it } from "vitest"
import {
  AutomationError,
  connectTest,
  type TestAutomationRenderer,
} from "../automation/client.js"
import { createComponentInspector } from "../automation/component-inspector.js"
import type { HostNode } from "../types.js"
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

describe("component inspector (fake instance tree)", () => {
  /** Structural stand-ins for Vue internals; only the fields the walker
   *  touches exist, cast to the shapes `createComponentInspector` reads. */
  interface FakeInstance {
    type: { name?: string; __name?: string; __file?: string } | Function
    subTree?: unknown
    setupState?: unknown
    props?: unknown
    attrs?: unknown
    data?: unknown
    isUnmounted?: boolean
  }

  function hostEl(id: number | null): HostNode {
    return { id, type: "div", text: "", props: {}, parent: null, children: [], created: true }
  }

  function vnode(parts: Record<string, unknown> = {}): Record<string, unknown> {
    return parts
  }

  function instance(init: FakeInstance): FakeInstance {
    return { subTree: null, ...init }
  }

  function inspectorFor(root: unknown) {
    return createComponentInspector({
      _instance: root,
    } as unknown as VueApp<HostNode>)
  }

  it("names function components and reports no file for them", () => {
    function Named() {}
    const inspector = inspectorFor(instance({ type: Named, subTree: vnode() }))
    const [node] = inspector.getComponentTree()!
    expect(node!.name).toBe("Named")
    expect(node!.file).toBeUndefined()
  })

  it("names anonymous and options-defined components", () => {
    const anonymous = inspectorFor(
      instance({ type: (0, function () {}), subTree: vnode() })
    )
    expect(anonymous.getComponentTree()![0]!.name).toBe("Anonymous")

    const unnamed = inspectorFor(instance({ type: {}, subTree: vnode() }))
    expect(unnamed.getComponentTree()![0]!.name).toBe("Anonymous")

    const options = inspectorFor(
      instance({
        type: { __name: "Sfc", __file: "/tmp/Sfc.vue" },
        subTree: vnode(),
      })
    )
    const [sfc] = options.getComponentTree()!
    expect(sfc!.name).toBe("Sfc")
    expect(sfc!.file).toBe("/tmp/Sfc.vue")
  })

  it("serializes every value kind within the protocol bounds", () => {
    const shared = { n: 1 }
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const throwingRef = {
      __v_isRef: true,
      get value(): unknown {
        throw new Error("ref boom")
      },
    }
    const throwingGetter: Record<string, unknown> = { safe: 1 }
    Object.defineProperty(throwingGetter, "boom", {
      enumerable: true,
      get() {
        throw new Error("getter boom")
      },
    })
    const inspector = inspectorFor(
      instance({
        type: { name: "Fat" },
        subTree: vnode(),
        setupState: {
          refValue: ref(7),
          nestedRefs: ref({ inner: ref("x") }),
          throwingRef,
          nothing: undefined,
          gone: null,
          long: "x".repeat(600),
          big: 10n,
          flag: true,
          handler: function onTick() {},
          anonymous: (0, () => {}),
          tag: Symbol("tag"),
          failure: new Error("bad"),
          deep: { l1: { l2: { l3: { l4: "x" } } } },
          circular,
          sharedTwice: { a: shared, b: shared },
          fatArray: Array.from({ length: 55 }, (_, i) => i),
          fatMap: new Map(
            Array.from({ length: 55 }, (_, i) => [`k${i}`, i] as const)
          ),
          fatSet: new Set([1, 2]),
          fatObject: Object.fromEntries(
            Array.from({ length: 60 }, (_, i) => [`k${i}`, i])
          ),
          throwingGetter,
        },
      })
    )
    const state = inspector.getComponentTree()![0]!.state!

    expect(state.refValue).toBe(7)
    expect(state.nestedRefs).toEqual({ inner: "x" })
    expect(state.throwingRef).toBe("[threw: Error: ref boom]")
    expect(state.nothing).toBeNull()
    expect(state.gone).toBeNull()
    expect(state.long).toBe("x".repeat(500) + "…")
    expect(state.big).toBe("10")
    expect(state.flag).toBe(true)
    expect(state.handler).toBe("ƒ onTick()")
    expect(state.anonymous).toBe("ƒ anonymous()")
    expect(state.tag).toBe("Symbol(tag)")
    expect(state.failure).toBe("Error: bad")
    expect(state.deep).toEqual({ l1: { l2: { l3: "…" } } })
    expect(state.circular).toEqual({ self: "[circular]" })
    expect(state.sharedTwice).toEqual({ a: { n: 1 }, b: { n: 1 } })
    expect(state.fatArray).toHaveLength(51)
    expect(state.fatArray![50]).toBe("…+5 more")
    expect(Object.keys(state.fatMap as object)).toHaveLength(51)
    expect((state.fatMap as Record<string, unknown>)["…"]).toBe("+5 more")
    expect(state.fatSet).toEqual([1, 2])
    expect(Object.keys(state.fatObject as object)).toHaveLength(50)
    expect(state.throwingGetter).toEqual({
      safe: 1,
      boom: "[threw: Error: getter boom]",
    })
  })

  it("omits records that are null or undefined", () => {
    const inspector = inspectorFor(
      instance({
        type: { name: "Empty" },
        subTree: vnode(),
        setupState: null,
        props: undefined,
      })
    )
    const [node] = inspector.getComponentTree()!
    expect(node!.state).toBeUndefined()
    expect(node!.props).toBeUndefined()
  })

  it("degrades to an unavailable marker when a record cannot be read", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile")
        },
      }
    )
    const inspector = inspectorFor(
      instance({ type: { name: "Hostile" }, subTree: vnode(), setupState: hostile })
    )
    expect(inspector.getComponentTree()![0]!.state).toEqual({
      "[unavailable]": "Error: hostile",
    })
  })

  it("collects host ids from children and dynamic children", () => {
    const child = instance({ type: { name: "Child" }, subTree: vnode() })
    const empty = instance({ type: { name: "Empty" }, subTree: null })
    const inspector = inspectorFor(
      instance({
        type: { name: "Root" },
        subTree: vnode({
          el: hostEl(1),
          children: [
            null,
            "plain text",
            vnode({ el: hostEl(2) }),
            vnode({ el: hostEl(null) }),
            vnode({ component: child }),
            vnode({ component: empty }),
          ],
          dynamicChildren: [vnode({ el: hostEl(3) })],
        }),
      })
    )
    const [node] = inspector.getComponentTree()!
    expect(node!.hostIds).toEqual([1, 2, 3])
    expect(node!.children).toHaveLength(2)
    expect(node!.children![0]!.name).toBe("Child")
    expect(node!.children![0]!.id).toBe(2)
    expect(node!.children![1]!.name).toBe("Empty")
    expect(node!.children![1]!.hostIds).toEqual([])
  })

  it("skips unmounted children and walks a repeated child once", () => {
    const alive = instance({
      type: { name: "Alive" },
      subTree: vnode({ el: hostEl(10) }),
    })
    const dead = instance({
      type: { name: "Dead" },
      subTree: vnode(),
      isUnmounted: true,
    })
    const inspector = inspectorFor(
      instance({
        type: { name: "Root" },
        subTree: vnode({
          children: [
            vnode({ component: alive }),
            vnode({ component: dead }),
            vnode({ component: alive }),
          ],
        }),
      })
    )
    const [node] = inspector.getComponentTree()!
    expect(node!.children!.map((child) => child.name)).toEqual(["Alive"])
  })

  it("finds the component that owns a host element", () => {
    const leaf = instance({
      type: { name: "Leaf" },
      subTree: vnode({ el: hostEl(10) }),
    })
    const root = instance({
      type: { name: "Root", __file: "Root.vue" },
      subTree: vnode({
        el: hostEl(1),
        children: [vnode({ component: leaf })],
      }),
    })
    const inspector = inspectorFor(root)
    const leafState = inspector.getComponentState(10)
    expect(leafState).toMatchObject({ name: "Leaf" })
    expect(leafState!.children).toBeUndefined()
    expect(inspector.getComponentState(1)!.name).toBe("Root")
    expect(inspector.getComponentState(999)).toBeNull()
  })

  it("returns null when there is no live root instance", () => {
    const inspector = inspectorFor(undefined)
    expect(inspector.getComponentTree()).toBeNull()
    expect(inspector.getComponentState(1)).toBeNull()
    const unmounted = inspectorFor(
      instance({ type: { name: "Gone" }, subTree: vnode(), isUnmounted: true })
    )
    expect(unmounted.getComponentTree()).toBeNull()
    expect(unmounted.getComponentState(1)).toBeNull()
  })

  it("returns null when walking Vue internals throws", () => {
    const hostile = instance({ type: { name: "Hostile" } })
    Object.defineProperty(hostile, "subTree", {
      get() {
        throw new Error("internals moved")
      },
    })
    const inspector = inspectorFor(hostile)
    expect(inspector.getComponentTree()).toBeNull()
    expect(inspector.getComponentState(1)).toBeNull()
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
