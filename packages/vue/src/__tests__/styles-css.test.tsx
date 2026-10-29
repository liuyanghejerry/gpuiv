/// GPU-backed port of upstream a650681's layout assertions (aspectRatio,
/// space-evenly, stretch/baseline). Their screenshot pixel-diffs for dashed
/// borders and shadow stacks stay unported — no pixel harness here (PR #29
/// precedent); the shadow-list/inset wire behavior is already pinned by the
/// Rust tests in packages/native/src/style.rs.

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

interface TestApp {
  renderer: ReturnType<typeof createTestApp>["renderer"]
  settle: () => Promise<void>
  unmount: () => void
}

function rect(app: TestApp, testId: string) {
  const node = app.renderer.findByTestId(testId)
  expect(node, `missing testId ${testId}`).toBeDefined()
  const bounds = app.renderer.getElementBounds(node!.id)
  expect(bounds, `no painted bounds for ${testId}`).toBeTruthy()
  return bounds!
}

describeNative("aspectRatio (vue)", () => {
  it("derives the height from the width", async () => {
    const App = defineComponent({
      setup: () => () => <div testId="box" style={{ width: 200, aspectRatio: 2 }} />,
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      expect(rect(app, "box")).toMatchObject({ width: 200, height: 100 })
    } finally {
      app.unmount()
    }
  })

  it("derives the width from the height", async () => {
    const App = defineComponent({
      setup: () => () => <div testId="box" style={{ height: 60, aspectRatio: 3 }} />,
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      expect(rect(app, "box")).toMatchObject({ width: 180, height: 60 })
    } finally {
      app.unmount()
    }
  })

  it("ignores a ratio that is not positive", async () => {
    const App = defineComponent({
      setup: () => () => <div testId="box" style={{ width: 200, height: 50, aspectRatio: 0 }} />,
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      expect(rect(app, "box")).toMatchObject({ width: 200, height: 50 })
    } finally {
      app.unmount()
    }
  })
})

describeNative("justifyContent: space-evenly (vue)", () => {
  it("puts equal space before, between and after the children", async () => {
    const App = defineComponent({
      setup: () => () => (
        <div style={{ display: "flex", flexDirection: "row", width: 300, justifyContent: "space-evenly" }}>
          {["a", "b", "c"].map((id) => (
            <div key={id} testId={id} style={{ width: 30, height: 10 }} />
          ))}
        </div>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      // 300 - 90 = 210 free, in 4 equal gaps of 52.5. Layout rounds to whole pixels.
      const [a, b, c] = ["a", "b", "c"].map((id) => rect(app, id).x) as [number, number, number]
      expect(Math.abs(a - 52.5)).toBeLessThanOrEqual(1)
      expect(Math.abs(b - a - 82.5)).toBeLessThanOrEqual(1)
      expect(Math.abs(c - b - 82.5)).toBeLessThanOrEqual(1)
    } finally {
      app.unmount()
    }
  })
})

describeNative("alignItems (vue)", () => {
  it("stretch fills the cross axis, which center does not", async () => {
    const alignItems = ref("stretch")
    const App = defineComponent({
      setup: () => () => (
        <div style={{ display: "flex", flexDirection: "row", width: 200, height: 100, alignItems: alignItems.value }}>
          <div testId="child" style={{ width: 20 }} />
        </div>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      expect(rect(app, "child").height).toBe(100)
      alignItems.value = "center"
      await app.settle()
      expect(rect(app, "child").height).toBeLessThan(100)
    } finally {
      app.unmount()
    }
  })

  it("baseline lines up text of different sizes on one baseline", async () => {
    const alignItems = ref("start")
    const App = defineComponent({
      setup: () => () => (
        <div style={{ display: "flex", flexDirection: "row", width: 300, height: 100, alignItems: alignItems.value }}>
          <div testId="big" style={{ fontSize: 40 }}>Big</div>
          <div testId="small" style={{ fontSize: 12 }}>small</div>
        </div>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      expect(rect(app, "small").y).toBe(rect(app, "big").y)

      alignItems.value = "baseline"
      await app.settle()
      const big = rect(app, "big")
      const small = rect(app, "small")
      // The small text drops so that its bottom edge meets the big text's.
      expect(small.y).toBeGreaterThan(big.y)
      expect(Math.abs(small.y + small.height - (big.y + big.height))).toBeLessThanOrEqual(2)
    } finally {
      app.unmount()
    }
  })
})

describeNative("borderStyle wire passthrough (vue)", () => {
  it("carries borderStyle and aspectRatio into the retained style", async () => {
    interface TreeNode {
      testId?: string
      style?: Record<string, unknown>
      children?: TreeNode[]
    }
    const find = (node: TreeNode, testId: string): TreeNode | null => {
      if (node.testId === testId) return node
      for (const child of node.children ?? []) {
        const hit = find(child, testId)
        if (hit) return hit
      }
      return null
    }
    const App = defineComponent({
      setup: () => () => (
        <div
          testId="frame"
          style={{ width: 120, height: 80, borderWidth: 3, borderColor: "#89b4fa", borderStyle: "dashed" }}
        />
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      const node = find(app.renderer.toJSON() as TreeNode, "frame")
      expect(node?.style?.borderStyle).toBe("dashed")
    } finally {
      app.unmount()
    }
  })
})
