/** Mutation lifecycle tests for the Vue host config.
 *
 * Covers the Vue-relevant parts of upstream's React `mutation-lifecycle.test.tsx`:
 *
 * - a removed string is freed from the retained tree (React needed an explicit
 *   fix because it never calls `detachDeletedInstance` for text nodes; Vue's
 *   `remove` op covers text vnodes, and this test proves it)
 * - element ids and handlers stay isolated across two live roots
 * - a second simultaneous root on one renderer is refused, and a new root is
 *   allowed once the previous one unmounted and detached
 *
 * Not ported: the abandoned-Suspense-render test (a React concurrent-mode
 * artifact — Vue patches synchronously and has no abandoned host-node path) and
 * the fresh-ids-on-remount test (upstream's `createRoot` allocates ids per
 * root; our ids come from the caller, and `createApp`'s remount deliberately
 * keeps one allocator per renderer). */

import { defineComponent, ref } from "vue"
import { describe, expect, it, vi } from "vitest"
import type { EventPayload } from "@gpuiv/native"
import { createGpuivRendererHost } from "../reconciler/vue-renderer.js"
import { handleGpuixEvent } from "../reconciler/event-registry.js"
import { TestRenderer, createTestApp, hasNativeTestRenderer } from "../testing.js"
import { createApp, resetApp } from "../renderer.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("mutation lifecycle", () => {
  it("keeps unchanged event handlers registered across renders", async () => {
    const onClick = vi.fn()
    const tick = ref(0)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 100, height: 100 }} onClick={onClick}>
            row {tick.value}
          </div>
        )
      },
    })

    const app = createTestApp(App)
    try {
      app.renderer.nativeSimulateClick(10, 10)
      await app.settle()
      expect(onClick).toHaveBeenCalledTimes(1)

      // An unrelated state change re-renders the whole component; the handler
      // must survive the patch without being dropped or duplicated.
      tick.value++
      await app.settle()
      app.renderer.nativeSimulateClick(10, 10)
      await app.settle()
      expect(onClick).toHaveBeenCalledTimes(2)
    } finally {
      app.unmount()
    }
  })

  it("keeps element ids and click handlers isolated across live roots", async () => {
    const onA = vi.fn()
    const onB = vi.fn()
    // An explicit <text> child with a dynamic expression, not a bare string or
    // a static element: a plain string child compiles to `setElementText`
    // (content stored on the div itself), and a fully-static JSX child gets
    // hoisted into one shared vnode, which the second mount would steal.
    const tree = (label: string, onClick: () => void) =>
      defineComponent({
        setup() {
          return () => (
            <div style={{ width: 100, height: 100 }} onClick={onClick}>
              <text>{label}</text>
            </div>
          )
        },
      })

    // Both renderers exist before either app mounts, exactly like upstream's
    // React test. The native test renderer keeps one GPUI window per thread:
    // constructing the second tears the first's window down and nulls its
    // root id, so a root mounted before that would read back as gone. Tree
    // queries and the JS event map stay per-renderer either way.
    const rendererA = new TestRenderer()
    const rendererB = new TestRenderer()
    const hostA = createGpuivRendererHost(rendererA, { nextElementId: 0 })
    const hostB = createGpuivRendererHost(rendererB, { nextElementId: 0 })
    const appA = hostA.vue.createApp(tree("row a", onA))
    appA.mount(hostA.container)
    hostA.flushMutations()
    const appB = hostB.vue.createApp(tree("row b", onB))
    appB.mount(hostB.container)
    hostB.flushMutations()

    try {
      // Both roots allocate from their own id counter, so the two trees are
      // isomorphic: same text id, same root div id under the container wrapper.
      const aText = rendererA.findByType("text")[0]?.id
      expect(aText).toBeDefined()
      expect(rendererB.findByType("text")[0]?.id).toBe(aText)
      const aRoot = rendererA.getRoot()?.children[0]
      expect(aRoot).toBeDefined()
      expect(rendererB.getRoot()?.children[0]).toBe(aRoot)

      handleGpuixEvent(
        { elementId: aRoot!, eventType: "click" } as unknown as EventPayload,
        rendererA
      )
      expect(onA).toHaveBeenCalledTimes(1)
      expect(onB).not.toHaveBeenCalled()

      handleGpuixEvent(
        { elementId: aRoot!, eventType: "click" } as unknown as EventPayload,
        rendererB
      )
      expect(onA).toHaveBeenCalledTimes(1)
      expect(onB).toHaveBeenCalledTimes(1)
    } finally {
      appA.unmount()
      hostA.flushMutations()
      hostA.detach()
      appB.unmount()
      hostB.flushMutations()
      hostB.detach()
    }
  })

  it("frees a removed text node instead of leaking it", async () => {
    const show = ref(true)
    const deep = ref(true)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 100, height: 100 }}>
            {show.value ? "hello" : null}
            {deep.value ? (
              <div>
                <text>deep</text>
              </div>
            ) : null}
          </div>
        )
      },
    })

    const app = createTestApp(App)
    try {
      const withTextAndSubtree = app.renderer.getRetainedElementCount()

      // A removed string frees exactly its own text node.
      show.value = false
      await app.settle()
      expect(app.renderer.getAllText()).toEqual(["deep"])
      const withoutText = app.renderer.getRetainedElementCount()
      expect(withoutText).toBe(withTextAndSubtree - 1)

      // A whole removed subtree frees every node in it, not just its root.
      deep.value = false
      await app.settle()
      expect(app.renderer.getAllText()).toEqual([])
      expect(app.renderer.getRetainedElementCount()).toBe(withoutText - 2)
    } finally {
      app.unmount()
    }
  })

  it("refuses a second simultaneous root on one renderer", async () => {
    const renderer = new TestRenderer()
    const first = createGpuivRendererHost(renderer, { nextElementId: 0 })
    const onFirst = vi.fn()
    const app = first.vue.createApp(
      defineComponent({
        setup() {
          return () => (
            <div style={{ width: 100, height: 100 }} onClick={onFirst}>
              <text>first</text>
            </div>
          )
        },
      })
    )
    app.mount(first.container)
    first.flushMutations()
    renderer.flush()

    try {
      expect(() => createGpuivRendererHost(renderer, { nextElementId: 0 })).toThrowError(
        "This renderer already drives a mounted GPUIX root."
      )

      // The rejected root must not have disturbed the live one. The click
      // handler sits on the app's root div, the first child of the container.
      const firstRoot = renderer.getRoot()?.children[0]!
      handleGpuixEvent(
        { elementId: firstRoot, eventType: "click" } as unknown as EventPayload,
        renderer
      )
      expect(onFirst).toHaveBeenCalledTimes(1)
    } finally {
      app.unmount()
      first.flushMutations()
      first.detach()
    }
  })

  it("allows a new root once the previous one unmounts", async () => {
    const renderer = new TestRenderer()
    const first = createGpuivRendererHost(renderer, { nextElementId: 0 })
    const firstApp = first.vue.createApp(
      defineComponent({
        setup() {
          return () => <text>first</text>
        },
      })
    )
    firstApp.mount(first.container)
    first.flushMutations()
    firstApp.unmount()
    first.flushMutations()
    first.detach()

    const second = createGpuivRendererHost(renderer, { nextElementId: 0 })
    const onSecond = vi.fn()
    try {
      const secondApp = second.vue.createApp(
        defineComponent({
          setup() {
            return () => (
              <div style={{ width: 100, height: 100 }} onClick={onSecond}>
                second
              </div>
            )
          },
        })
      )
      secondApp.mount(second.container)
      second.flushMutations()
      renderer.flush()

      const secondRoot = renderer.getRoot()?.children[0]!
      handleGpuixEvent(
        { elementId: secondRoot, eventType: "click" } as unknown as EventPayload,
        renderer
      )
      expect(onSecond).toHaveBeenCalledTimes(1)
      secondApp.unmount()
      second.flushMutations()
    } finally {
      second.detach()
    }
  })

  it("rebinds the render-level onEvent observer to each root", async () => {
    const renderer = new TestRenderer()
    const observed: string[] = []
    const App = defineComponent({
      props: { label: { type: String, required: true } },
      setup(props) {
        return () => (
          <div style={{ width: 100, height: 100 }} onClick={() => observed.push(props.label)}>
            {props.label}
          </div>
        )
      },
    })

    try {
      createApp(defineComponent({
        setup: () => () => <App label="first" />,
      }), { renderer, onEvent: () => observed.push("observer:first") })
      renderer.nativeSimulateClick(10, 10)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(observed).toEqual(["first", "observer:first"])

      // The second root's observer replaces the first's — a click must not
      // reach the stale one.
      createApp(defineComponent({
        setup: () => () => <App label="second" />,
      }), { renderer, onEvent: () => observed.push("observer:second") })
      renderer.nativeSimulateClick(10, 10)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(observed).toEqual(["first", "observer:first", "second", "observer:second"])
    } finally {
      resetApp()
    }
  })

  it("keeps root ids unique across remounts on one renderer", () => {
    const renderer = new TestRenderer()
    const App = defineComponent({
      setup: () => () => <div style={{ width: 100, height: 100 }}>tree</div>,
    })

    try {
      createApp(App, { renderer })
      const firstRoot = renderer.getRoot()?.id

      resetApp()
      createApp(App, { renderer })
      const secondRoot = renderer.getRoot()?.id

      // The allocator survives the remount, so the replacement root's id can
      // never collide with retained Rust state from the previous tree.
      expect(secondRoot).not.toBeNull()
      expect(secondRoot).not.toBe(firstRoot)
    } finally {
      resetApp()
    }
  })
})
