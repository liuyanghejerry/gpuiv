/// GPU-backed test for the linear-gradient background port (upstream 09e0cae):
/// the structured value crosses the mutation wire and lands in the retained
/// tree's style, which is what `apply_styles` resolves into a GPUI gradient.

import { defineComponent } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

interface TreeNode {
  type: string
  id: number
  testId?: string
  style?: Record<string, unknown>
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

describeNative("linear gradient backgrounds (vue)", () => {
  it("passes a two-stop linear gradient through to the retained style", () => {
    const gradient = {
      type: "linear-gradient",
      angle: 90,
      stops: [
        { color: "#7c3aed", position: 0 },
        { color: "#06b6d4", position: 1 },
      ],
      colorSpace: "oklab",
    } as const
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", padding: 40, backgroundColor: "#101010" }}>
            <div
              testId="gradient"
              style={{ width: 360, height: 220, borderRadius: 24, background: gradient }}
            />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const node = findByTestId(app.renderer.toJSON() as TreeNode, "gradient")
    expect(node?.style?.background).toEqual(gradient)
    app.unmount()
  })
})
