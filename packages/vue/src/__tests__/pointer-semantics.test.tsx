/// GPU-backed tests for the pointer-semantics additions: the `contextMenu`
/// event, explicit pointer capture (`setPointerCapture` /
/// `releasePointerCapture`), and the `stopWheelPropagation` wheel opt-out.

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import type { EventPayload } from "@gpuiv/native"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

interface TreeNode {
  testId?: string
  id: number
  children?: TreeNode[]
}

function findByTestId(node: TreeNode, testId: string): TreeNode | null {
  if (node.testId === testId) return node
  for (const child of node.children ?? []) {
    const hit = findByTestId(child, testId)
    if (hit) return hit
  }
  return null
}

describeNative("pointer semantics (vue)", () => {
  it("fires contextMenu on right-button release, like macOS", async () => {
    const log = ref<string[]>([])
    const payload = ref<EventPayload | null>(null)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            <div
              testId="target"
              style={{ padding: 20, backgroundColor: "#333" }}
              onClick={() => log.value.push("click")}
              onAuxClick={() => log.value.push("auxClick")}
              onContextMenu={(event) => {
                log.value.push("contextMenu")
                payload.value = event
              }}
            >
              <text>target</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const target = app.renderer.findByText("target")!
    const bounds = app.renderer.getElementBounds(target.id)!

    // auxClick and contextMenu are both right-button-up events; their relative
    // order is not part of the contract, only that both fire.
    app.renderer.nativeSimulateClick(bounds[0] + 5, bounds[1] + 5, 2)
    await app.settle()
    expect(log.value.sort()).toEqual(["auxClick", "contextMenu"])
    expect(payload.value?.button).toBe(2)
    expect(payload.value?.isRightClick).toBe(true)

    // A left click must not fire contextMenu.
    log.value = []
    app.renderer.nativeSimulateClick(bounds[0] + 5, bounds[1] + 5)
    await app.settle()
    expect(log.value).toEqual(["click"])
    app.unmount()
  })

  it("keeps delivering mouse moves outside the bounds while capture is set", async () => {
    const moves = ref<string[]>([])
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", padding: 30, gap: 60 }}>
            <div
              testId="captured"
              style={{ width: 120, height: 120, backgroundColor: "#333" }}
              onMouseMove={(event) => moves.value.push(`captured:${Math.round(event.x ?? 0)}`)}
            />
            <div
              testId="free"
              style={{ width: 120, height: 120, backgroundColor: "#555" }}
              onMouseMove={(event) => moves.value.push(`free:${Math.round(event.x ?? 0)}`)}
            />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    const tree = app.renderer.toJSON() as TreeNode
    const captured = findByTestId(tree, "captured")!
    const free = findByTestId(tree, "free")!
    const capturedBounds = app.renderer.getElementBounds(captured.id)!
    const freeBounds = app.renderer.getElementBounds(free.id)!

    // `captured` listens for mouseMove only — without setPointerCapture it
    // would never see a move that leaves its bounds.
    app.renderer.setPointerCapture(captured.id)
    app.renderer.nativeSimulateMouseDown(
      capturedBounds[0] + capturedBounds[2] / 2,
      capturedBounds[1] + capturedBounds[3] / 2,
      0,
    )
    app.renderer.nativeSimulateMouseMove(freeBounds[0] + 10, freeBounds[1] + 10)
    app.renderer.nativeSimulateMouseMove(20, 20)
    await app.settle()
    expect(moves.value.some((move) => move.startsWith("captured:"))).toBe(true)

    // Release: the same gesture now lands on whatever is under the pointer.
    moves.value = []
    app.renderer.releasePointerCapture()
    app.renderer.nativeSimulateMouseDown(
      capturedBounds[0] + capturedBounds[2] / 2,
      capturedBounds[1] + capturedBounds[3] / 2,
      0,
    )
    app.renderer.nativeSimulateMouseMove(20, 20)
    await app.settle()
    expect(moves.value.some((move) => move.startsWith("captured:"))).toBe(false)
    app.unmount()
  })

  it("stopWheelPropagation keeps an ancestor scroller from consuming the wheel", async () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", padding: 30 }}>
            <div
              testId="scroller"
              style={{ width: 300, height: 300, overflow: "scroll", backgroundColor: "#222" }}
            >
              <div
                testId="stopper"
                stopWheelPropagation
                style={{ width: 200, height: 100, backgroundColor: "#7c3aed" }}
              />
              <div style={{ width: 200, height: 400 }} />
              <div style={{ width: 200, height: 400 }} />
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    const tree = app.renderer.toJSON() as TreeNode
    const scroller = findByTestId(tree, "scroller")!
    const stopper = findByTestId(tree, "stopper")!
    const stopperBounds = app.renderer.getElementBounds(stopper.id)!
    const cx = stopperBounds[0] + stopperBounds[2] / 2
    const cy = stopperBounds[1] + stopperBounds[3] / 2

    // Wheel over the stopper: the scroller must not move.
    app.renderer.nativeSimulateScrollWheel(cx, cy, 0, -40)
    await app.settle()
    const atRest = app.renderer.getScrollOffset(scroller.id)
    expect(atRest === null || atRest[1] === 0).toBe(true)

    // Wheel over plain filler inside the same scroller: it scrolls.
    app.renderer.nativeSimulateScrollWheel(cx, cy + 120, 0, -40)
    await app.settle()
    const offset = app.renderer.getScrollOffset(scroller.id)
    expect(offset).not.toBeNull()
    expect(offset![1]!).toBeLessThan(0)
    app.unmount()
  })
})
