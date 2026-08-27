/** GPU-backed regression tests for element bounds recorded by the automation
 *  host. The bounds canvas is laid out at an element's content-box origin with
 *  the padding-box size, so the record must be translated back to the real
 *  border box — the box GPUI's hit test uses. */

import { defineComponent } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("element bounds (vue)", () => {
  it("records the real border box of a padded row in a scroll container", async () => {
    let clicks = 0
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flexGrow: 1,
                minHeight: 0,
                overflowY: "scroll",
                paddingLeft: 10,
                paddingRight: 10,
              }}
            >
              <div
                testId="row"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  paddingLeft: 8,
                  paddingRight: 8,
                  paddingTop: 7,
                  paddingBottom: 7,
                }}
                onClick={() => clicks++}
              >
                <text>Title</text>
                <div style={{ display: "flex", flexDirection: "row" }}>
                  <text>project</text>
                </div>
              </div>
              <div style={{ height: 600 }} />
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const row = app.renderer.findByTestId("row")!
    const [bx, by, bw, bh] = app.renderer.getElementBounds(row.id)!

    // The recorded origin is the real border-box origin: the scroll container's
    // left padding puts the row at x=10, y=0. Before the fix the origin was the
    // content-box origin (18, 7).
    expect(bx).toBe(10)
    expect(by).toBe(0)

    // Every corner of the recorded box is inside the real hitbox. The corners
    // used to fall outside it, so clicks there were silently lost.
    for (const [x, y] of [
      [bx + 3, by + 3],
      [bx + bw - 3, by + 3],
      [bx + 3, by + bh - 3],
      [bx + bw - 3, by + bh - 3],
    ]) {
      const before = clicks
      app.renderer.nativeSimulateClick(x, y)
      await app.settle()
      expect(clicks, `click at (${x}, ${y}) missed the row`).toBe(before + 1)
    }
    app.unmount()
  })

  it("adds the border back into the recorded size", async () => {
    const Row = ({ bordered }: { bordered: boolean }) => (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
        <div
          testId="row"
          style={{
            display: "flex",
            flexDirection: "column",
            paddingTop: 7,
            paddingBottom: 7,
            ...(bordered
              ? { borderWidth: 2, borderColor: "#886644", paddingLeft: 8, paddingRight: 8 }
              : {}),
          }}
        >
          <text>Title</text>
        </div>
      </div>
    )
    const app = createTestApp(defineComponent({ setup: () => () => <Row bordered={false} /> }))
    const plain = app.renderer.findByTestId("row")!
    const plainBounds = app.renderer.getElementBounds(plain.id)!
    app.unmount()

    const app2 = createTestApp(defineComponent({ setup: () => () => <Row bordered={true} /> }))
    const bordered = app2.renderer.findByTestId("row")!
    const borderedBounds = app2.renderer.getElementBounds(bordered.id)!
    app2.unmount()

    // The border box grows by the border on each side; width stays the
    // stretched window width. Before the fix the recorded width was short by
    // the border on both sides and the height by the top+bottom border.
    expect(borderedBounds[2]).toBe(plainBounds[2])
    expect(borderedBounds[3]).toBe(plainBounds[3]! + 4)
    expect(borderedBounds[0]).toBe(plainBounds[0])
    expect(borderedBounds[1]).toBe(plainBounds[1])
  })
})
