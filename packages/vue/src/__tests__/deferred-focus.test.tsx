/** Deferred focus: a focusElement() call that arrives before the element has
 *  a native focus handle waits for a render that creates the handle. A later
 *  click or Tab move cancels the request; explicit focus still beats autoFocus.
 *
 *  The native test renderer repaints inside focusElement (flush() is
 *  notify + run_until_parked), so the queue window that a test can hit is
 *  "element already in the retained tree, but no frame painted since" —
 *  hence flushMutations() to update the tree without painting. */

// @ts-nocheck

import { defineComponent, nextTick, ref } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer, TestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("deferred focus", () => {
  let app: ReturnType<typeof createTestApp> | undefined

  beforeEach(() => {
    app?.unmount()
  })

  function testId(name: string): number {
    const node = app!.renderer.findByTestId(name)!
    expect(node, `missing testId: ${name}`).toBeDefined()
    return node.id
  }

  it("keeps a request across a frame before the target is created", () => {
    const renderer = new TestRenderer()
    renderer.applyBatch(JSON.stringify([
      ["createElement", 1, "div"],
      ["setRoot", 1],
    ]))
    renderer.flush()

    renderer.focusElement(42)
    expect(renderer.getFocusedElementId()).toBeNull()

    renderer.applyBatch(JSON.stringify([
      ["createElement", 42, "div"],
      ["setCustomProp", 42, "tabIndex", 0],
      ["appendChild", 1, 42],
    ]))
    renderer.flush()
    expect(renderer.getFocusedElementId()).toBe(42)
  })

  it("drops an early request when Tab moves focus before the target mounts", () => {
    const renderer = new TestRenderer()
    renderer.applyBatch(JSON.stringify([
      ["createElement", 1, "div"],
      ["setRoot", 1],
      ["createElement", 2, "div"],
      ["setCustomProp", 2, "tabIndex", 0],
      ["appendChild", 1, 2],
      ["createElement", 3, "div"],
      ["setCustomProp", 3, "tabIndex", 0],
      ["appendChild", 1, 3],
    ]))
    renderer.flush()
    renderer.focusElement(2)
    expect(renderer.getFocusedElementId()).toBe(2)

    renderer.focusElement(42)
    renderer.focusNext()
    expect(renderer.getFocusedElementId()).toBe(3)

    renderer.applyBatch(JSON.stringify([
      ["createElement", 42, "div"],
      ["setCustomProp", 42, "tabIndex", 0],
      ["appendChild", 1, 42],
    ]))
    renderer.flush()
    expect(renderer.getFocusedElementId()).toBe(3)
  })

  it("applies a focus request made before the focus handle exists", async () => {
    const show = ref(false)
    const Late = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 100, height: 100 }}>
            {show.value ? (
              <div testId="late" tabIndex={0} style={{ width: 10, height: 10 }} />
            ) : null}
          </div>
        )
      },
    })
    app = createTestApp(Late)
    await app.settle()

    // The tree gains the element without a frame: no focus handle exists yet.
    show.value = true
    await nextTick()
    app.flushMutations()
    const late = testId("late")

    app.renderer.focusElement(late)
    expect(app.renderer.getFocusedElementId()).toBe(late)
  })

  it("an explicit focus request beats autoFocus on the same frame", async () => {
    const show = ref(false)
    const Race = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 100, height: 100 }}>
            {show.value ? (
              <div>
                <div testId="auto" tabIndex={0} autoFocus style={{ width: 10, height: 10 }} />
                <div testId="pend" tabIndex={0} style={{ width: 10, height: 10 }} />
              </div>
            ) : null}
          </div>
        )
      },
    })
    app = createTestApp(Race)
    await app.settle()

    show.value = true
    await nextTick()
    app.flushMutations()

    app.renderer.focusElement(testId("pend"))
    expect(app.renderer.getFocusedElementId()).toBe(testId("pend"))
  })
})
