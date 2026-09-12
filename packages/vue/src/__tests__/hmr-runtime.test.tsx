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
