/** End-to-end tests for the native focus-within APIs: getFocusedElementId,
 *  focusNextWithin / focusPreviousWithin walk GPUI's painted TabStopMap but
 *  are confined to the requested subtree. */

// @ts-nocheck

import { defineComponent, ref } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("focus within a subtree", () => {
  let app: ReturnType<typeof createTestApp> | undefined

  beforeEach(() => {
    app?.unmount()
  })

  const FocusTree = defineComponent({
    setup() {
      return () => (
        <div style={{ width: 400, height: 300 }}>
          <div testId="trap" style={{ width: 200, height: 200 }}>
            <div testId="trap-a" tabIndex={0} style={{ width: 50, height: 50 }} />
            <div testId="trap-b" tabIndex={0} style={{ width: 50, height: 50 }} />
          </div>
          <div testId="outside" tabIndex={0} style={{ width: 50, height: 50 }} />
        </div>
      )
    },
  })

  function testId(name: string): number {
    const node = app!.renderer.findByTestId(name)!
    expect(node, `missing testId: ${name}`).toBeDefined()
    return node.id
  }

  it("reports the focused element id", async () => {
    const Auto = defineComponent({
      setup() {
        return () => (
          <div testId="first" tabIndex={0} autoFocus style={{ width: 50, height: 50 }} />
        )
      },
    })
    app = createTestApp(Auto)
    await app.settle()

    expect(app.renderer.getFocusedElementId()).toBe(testId("first"))
  })

  it("moves focus within a subtree without escaping it", async () => {
    app = createTestApp(FocusTree)
    await app.settle()

    const trapA = testId("trap-a")
    const trapB = testId("trap-b")
    const trap = testId("trap")
    const outside = testId("outside")
    const renderer = app.renderer

    renderer.focusElement(trapA)
    await app.settle()
    expect(renderer.getFocusedElementId()).toBe(trapA)

    // Forward from A lands on B, never on the sibling outside the subtree.
    renderer.focusNextWithin(trap)
    await app.settle()
    expect(renderer.getFocusedElementId()).toBe(trapB)

    // And the walk wraps back inside the trap.
    renderer.focusNextWithin(trap)
    await app.settle()
    expect(renderer.getFocusedElementId()).toBe(trapA)

    // Backward from A wraps to the last item of the subtree.
    renderer.focusPreviousWithin(trap)
    await app.settle()
    expect(renderer.getFocusedElementId()).toBe(trapB)

    // The outside tab stop is still reachable through the plain walk.
    renderer.focusElement(outside)
    await app.settle()
    expect(renderer.getFocusedElementId()).toBe(outside)
  })
})
