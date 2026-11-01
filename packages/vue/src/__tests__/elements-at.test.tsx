import { defineComponent } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("getElementsAt", () => {
  let app: ReturnType<typeof createTestApp> | undefined

  beforeEach(() => {
    app?.unmount()
  })

  it("lists elements under a point, topmost first, and honors clipping", () => {
    const Scene = defineComponent({
      setup: () => () => (
        <div style={{ display: "flex", flexDirection: "row", width: 400, height: 300 }}>
          <div
            testId="scroller"
            style={{ width: 100, height: 100, overflow: "hidden", flexDirection: "column" }}
          >
            <div testId="row" style={{ width: 100, height: 160, flexShrink: 0 }} />
          </div>
          <div testId="beside" style={{ width: 80, height: 80 }} />
        </div>
      ),
    })
    app = createTestApp(Scene)
    const id = (testId: string) => app!.renderer.findByTestId(testId)!.id

    expect(app.renderer.getElementsAt(50, 50).slice(0, 2)).toEqual([
      id("row"),
      id("scroller"),
    ])
    expect(app.renderer.getElementsAt(50, 130)).not.toContain(id("row"))
    expect(app.renderer.getElementsAt(150, 50)).toContain(id("beside"))
    expect(app.renderer.getElementsAt(5000, 5000)).toEqual([])
  })

  it("puts an anchored popover above what follows it in the tree", () => {
    const Scene = defineComponent({
      setup: () => () => (
        <div style={{ width: 400, height: 300 }}>
          <div testId="trigger" style={{ width: 60, height: 30 }}>
            <anchored position={{ x: 20, y: 20 }} anchor="topLeft" deferred priority={1}>
              <div testId="popover" style={{ width: 100, height: 100 }} />
            </anchored>
          </div>
          <div
            testId="later"
            style={{ position: "absolute", left: 0, top: 0, width: 200, height: 200 }}
          />
        </div>
      ),
    })
    app = createTestApp(Scene)
    const id = (testId: string) => app!.renderer.findByTestId(testId)!.id

    const hits = app.renderer.getElementsAt(40, 40)
    expect(hits.indexOf(id("popover"))).toBeGreaterThanOrEqual(0)
    expect(hits.indexOf(id("popover"))).toBeLessThan(hits.indexOf(id("later")))
  })

  it("skips only the element that declares pointer-events: none", () => {
    const Scene = defineComponent({
      setup: () => () => (
        <div style={{ width: 200, height: 200 }}>
          <div
            testId="overlay"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 200,
              height: 200,
              pointerEvents: "none",
            }}
          >
            <div testId="button" style={{ width: 40, height: 40 }} />
          </div>
        </div>
      ),
    })
    app = createTestApp(Scene)
    const hits = app.renderer.getElementsAt(10, 10)
    expect(hits).toContain(app.renderer.findByTestId("button")!.id)
    expect(hits).not.toContain(app.renderer.findByTestId("overlay")!.id)
    expect(app.renderer.getElementsAt(100, 100)).not.toContain(
      app.renderer.findByTestId("overlay")!.id,
    )
  })
})
