/** GPU-backed tests for the Vue Fast Refresh runtime (src/hmr/runtime.ts):
 *  a simulated save drives __gpuivHmrFile/__gpuivHmrComponent exactly the
 *  way the hmr-preload transform's injected calls would, and Vue's HMR
 *  runtime must reload the edited component in place while the rest of the
 *  tree keeps its state. */

import { defineComponent, h, ref, type Component } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer, TestRenderer } from "../testing.js"
import { createApp, resetApp, type GpuivAppHandle } from "../renderer.js"
import { __gpuivHmrComponent, __gpuivHmrFile } from "../hmr/runtime.js"

/** The runtime half keeps its pinned runtime and file records here. */
const HMR_STATE_KEY = "__gpuivHmr"

/** vue's own HMR runtime, as a fresh process has it installed. The tests
 *  swap in stand-ins for later `bun --hot` generations; this is the original
 *  to hand back afterwards. */
const realHmrRuntime = Reflect.get(globalThis, "__VUE_HMR_RUNTIME__") as
  | { reload: (id: string, component: unknown) => void }
  | undefined

const describeNative = hasNativeTestRenderer ? describe : describe.skip

/** A stateful labeled component factory — the two versions of one "edited"
 *  component. The label stands in for the edited source. */
function makeCounter(tag: string, label: string): Component {
  return defineComponent({
    setup() {
      const count = ref(0)
      return () =>
        h(
          "div",
          {
            testId: tag,
            style: { height: 40, width: 200 },
            onClick: () => (count.value += 1),
          },
          `${tag} ${label} ${count.value}`
        )
    },
  })
}

function clickTestId(app: { renderer: TestRenderer }, testId: string): void {
  const el = app.renderer.findByTestId(testId)
  expect(el).toBeDefined()
  const bounds = app.renderer.getElementBounds(el!.id)!
  app.renderer.nativeSimulateClick(bounds.x + 4, bounds.y + 4)
}

describeNative("vue hmr runtime", () => {
  afterEach(() => {
    // The pinned runtime is shared global state: hand vue's own copy back so
    // a test that swapped in stand-in generations cannot leak into the next.
    Reflect.set(globalThis, "__VUE_HMR_RUNTIME__", realHmrRuntime)
    const state = Reflect.get(globalThis, HMR_STATE_KEY) as
      | { runtime?: unknown }
      | undefined
    if (state) state.runtime = realHmrRuntime
    resetApp()
  })

  it("reloads an edited component in place and keeps parent state", async () => {
    const url = "/virtual/hmr-runtime/entry-a.tsx"
    const parentCount = ref(0)
    const Parent = defineComponent({
      setup(_, { slots }) {
        return () =>
          h("div", { style: { width: 300, height: 200 } }, [
            h(
              "div",
              {
                testId: "parent",
                style: { height: 40, width: 200 },
                onClick: () => (parentCount.value += 1),
              },
              `parent ${parentCount.value}`
            ),
            slots.default?.(),
          ])
      },
    })
    const ChildV1 = makeCounter("child", "v1")
    const ChildV2 = makeCounter("child", "v2")
    const childId = "test_Child"
    // What the transform injects: __hmrId on every generation, plus the
    // registration calls below.
    ;(ChildV1 as { __hmrId?: string }).__hmrId = childId
    ;(ChildV2 as { __hmrId?: string }).__hmrId = childId

    // Generation 1 (cold): register, then mount.
    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, childId, ChildV1, "stmt-1")
    const app = createTestApp({
      setup: () => () => h(Parent, () => h(ChildV1)),
    })
    await app.settle()
    // Slot/comment normalization leaves empty text runs around components;
    // they carry no signal here.
    const texts = () => app.renderer.getAllText().filter((text) => text.length > 0)
    expect(texts()).toEqual(["parent 0", "child v1 0"])

    clickTestId(app, "parent")
    clickTestId(app, "child")
    await app.settle()
    expect(texts()).toEqual(["parent 1", "child v1 1"])

    // Generation 2 (save): only the child statement changed.
    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, childId, ChildV2, "stmt-2")
    await app.settle()

    // Vue reload remounts the edited component (its count resets) while the
    // parent and the tree itself are untouched.
    expect(texts()).toEqual(["parent 1", "child v2 0"])
    app.unmount()
  })

  it("reloads every component when the module body changed", async () => {
    const url = "/virtual/hmr-runtime/entry-b.tsx"
    const idA = "test_BodyA"
    const idB = "test_BodyB"
    const A1 = makeCounter("aaa", "v1")
    const B1 = makeCounter("bbb", "v1")
    const A2 = makeCounter("aaa", "v2")
    const B2 = makeCounter("bbb", "v2")
    ;(A1 as { __hmrId?: string }).__hmrId = idA
    ;(B1 as { __hmrId?: string }).__hmrId = idB
    ;(A2 as { __hmrId?: string }).__hmrId = idA
    ;(B2 as { __hmrId?: string }).__hmrId = idB

    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, idA, A1, "stmt-a")
    __gpuivHmrComponent(url, idB, B1, "stmt-b")
    const app = createTestApp({
      setup: () => () => h("div", { style: { width: 300, height: 200 } }, [h(A1), h(B1)]),
    })
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["aaa v1 0", "bbb v1 0"])

    // Same statement hashes, new body hash — a module-level edit reloads all.
    __gpuivHmrFile(url, "body-2")
    __gpuivHmrComponent(url, idA, A2, "stmt-a")
    __gpuivHmrComponent(url, idB, B2, "stmt-b")
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["aaa v2 0", "bbb v2 0"])
    app.unmount()
  })

  it("keeps reloading after a classic remount mounted a newer vue copy", async () => {
    const url = "/virtual/hmr-runtime/entry-d.tsx"
    const childId = "test_RemountChild"
    const ChildV1 = makeCounter("child", "v1")
    const ChildV2 = makeCounter("child", "v2")
    ;(ChildV1 as { __hmrId?: string }).__hmrId = childId
    ;(ChildV2 as { __hmrId?: string }).__hmrId = childId

    // Each bun --hot generation re-evaluates vue and installs a fresh
    // __VUE_HMR_RUNTIME__ whose component map starts empty, and Vue records a
    // tree in the copy that mounted it. Stand in for three generations:
    // gen1 mounted the first tree and its instances were unregistered by the
    // remount's unmount (a reload through it finds nothing — the stale pin's
    // behaviour), gen2 mounted the live tree, gen3 is the copy the next save
    // installs before the injected calls run.
    type Runtime = {
      createRecord: (id: string, initialDef: unknown) => boolean
      rerender: (id: string, newRender: unknown) => void
      reload: (id: string, newComp: unknown) => void
    }
    const real = Reflect.get(globalThis, "__VUE_HMR_RUNTIME__") as Runtime
    let gen1Calls = 0
    let gen1Live = true
    let gen2Calls = 0
    let gen3Calls = 0
    const delegate = (count: () => void, live: () => boolean): Runtime => ({
      createRecord: real.createRecord,
      rerender: (id, render) => {
        count()
        if (live()) real.rerender(id, render)
      },
      reload: (id, component) => {
        count()
        if (live()) real.reload(id, component)
      },
    })
    const gen1 = delegate(() => (gen1Calls += 1), () => gen1Live)
    const gen2 = delegate(() => (gen2Calls += 1), () => true)
    const gen3 = delegate(() => (gen3Calls += 1), () => true)
    // A fresh process starts with no pinned runtime and no file records.
    Reflect.deleteProperty(globalThis, HMR_STATE_KEY)

    const makeEntry = (child: Component): Component => ({
      setup: () => () => h("div", { style: { width: 300, height: 200 } }, [h(child)]),
    })
    const renderer = new TestRenderer()
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      renderer.flush()
    }
    const clickChild = async () => {
      const el = renderer.findByTestId("child")!
      const bounds = renderer.getElementBounds(el.id)!
      renderer.nativeSimulateClick(bounds.x + 4, bounds.y + 4)
      await settle()
    }

    // Generation 1 cold start: register, mount. mountTree pins gen1.
    Reflect.set(globalThis, "__VUE_HMR_RUNTIME__", gen1)
    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, childId, ChildV1, "stmt-1")
    const first = createApp(makeEntry(ChildV1), { renderer })
    renderer.flush()
    expect(renderer.getAllText()).toEqual(["child v1 0"])
    await clickChild()
    expect(renderer.getAllText()).toEqual(["child v1 1"])

    // A save that changes no reloadable component (an asset edit): the entry
    // re-evaluates into generation 2, createApp sees no reloads, and the tree
    // remounts — registered in gen2's map now.
    gen1Live = false
    Reflect.set(globalThis, "__VUE_HMR_RUNTIME__", gen2)
    const second = createApp(makeEntry(ChildV1), { renderer })
    renderer.flush()
    expect(second).not.toBe(first)
    expect(renderer.getAllText()).toEqual(["child v1 0"])
    await clickChild()
    expect(renderer.getAllText()).toEqual(["child v1 1"])

    // The next save edits the component: generation 3 installs its runtime,
    // then the injected calls must reload through the copy that owns the live
    // tree (gen2) so createApp keeps it.
    Reflect.set(globalThis, "__VUE_HMR_RUNTIME__", gen3)
    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, childId, ChildV2, "stmt-2")
    const third: GpuivAppHandle = createApp(makeEntry(ChildV2), { renderer })
    expect(third).toBe(second)
    expect(gen1Calls).toBe(0)
    expect(gen2Calls).toBe(1)
    expect(gen3Calls).toBe(0)
    await settle()
    // The edit applied in place: the child remounted with fresh state, the
    // tree (and its parent state) stayed.
    expect(renderer.getAllText()).toEqual(["child v2 0"])
    resetApp()
  })

  it("createApp keeps the live tree when a hot turn reloaded components", async () => {
    const url = "/virtual/hmr-runtime/entry-c.tsx"
    const childId = "test_EntryChild"
    const ChildV1 = makeCounter("child", "v1")
    const ChildV2 = makeCounter("child", "v2")
    ;(ChildV1 as { __hmrId?: string }).__hmrId = childId
    ;(ChildV2 as { __hmrId?: string }).__hmrId = childId
    // The root's setup runs once per mount — the remount detector.
    let rootMounts = 0
    const makeEntry = (child: Component): Component => ({
      setup: () => {
        rootMounts += 1
        return () => h("div", { style: { width: 300, height: 200 } }, [h(child)])
      },
    })
    const EntryV1 = makeEntry(ChildV1)
    const EntryV2 = makeEntry(ChildV2)

    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, childId, ChildV1, "stmt-1")
    const renderer = new TestRenderer()
    // createApp has no settle() — pump Vue's microtask flush by hand.
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      renderer.flush()
    }
    const first = createApp(EntryV1, { renderer })
    renderer.flush()
    expect(rootMounts).toBe(1)
    expect(renderer.getAllText()).toEqual(["child v1 0"])

    const child = renderer.findByTestId("child")!
    const bounds = renderer.getElementBounds(child.id)!
    renderer.nativeSimulateClick(bounds.x + 4, bounds.y + 4)
    await settle()
    expect(renderer.getAllText()).toEqual(["child v1 1"])

    // The save: the child statement changed, then the entry re-runs createApp.
    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, childId, ChildV2, "stmt-2")
    const second: GpuivAppHandle = createApp(EntryV2, { renderer })
    // No remount: same handle, the root never re-mounted, and the edited
    // child shows its new label with Vue's fresh local state.
    expect(second).toBe(first)
    expect(rootMounts).toBe(1)
    await settle()
    expect(renderer.getAllText()).toEqual(["child v2 0"])

    // Control: with no reloads in the turn, createApp remounts as before.
    // (ChildV1 itself was mutated to v2 code by the in-place reload, so the
    // control mounts a fresh v3 child.)
    const third = createApp(makeEntry(makeCounter("child", "v3")), { renderer })
    renderer.flush()
    expect(third).not.toBe(first)
    expect(rootMounts).toBe(2)
    expect(renderer.getAllText()).toEqual(["child v3 0"])
    resetApp()
  })
})
