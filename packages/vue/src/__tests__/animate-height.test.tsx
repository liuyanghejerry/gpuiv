/** GPU-backed tests for AnimateHeight: the auto-height tween built on
 *  useElementBounds + motion. Content is a fixed 60px block; the wrapper
 *  must read that natural height back and animate the outer box to it. */

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import { AnimateHeight } from "../components/animate-height.js"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describeNative("AnimateHeight", () => {
  it("tweens between 0 and the measured content height", async () => {
    const height = ref<number | "auto">(0)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", flexDirection: "column", width: 200, height: 400 }}>
            <AnimateHeight height={height.value} duration={0.15} testId="drawer">
              <div style={{ height: 60, backgroundColor: "#5ca9ff" }} />
            </AnimateHeight>
          </div>
        )
      },
    })
    const app = createTestApp(App)

    const drawerId = () => app.renderer.findByTestId("drawer")!.id
    const drawerHeight = () => app.renderer.getElementBounds(drawerId())?.height ?? -1

    await app.settle()
    expect(drawerHeight()).toBe(0)

    height.value = "auto"
    await app.settle()
    // The bounds poll (100ms) plus the 150ms tween need real time.
    await wait(700)
    await app.settle()
    expect(drawerHeight()).toBeGreaterThan(55)
    expect(drawerHeight()).toBeLessThanOrEqual(60.5)

    height.value = 0
    await app.settle()
    await wait(700)
    await app.settle()
    expect(drawerHeight()).toBeLessThan(5)

    app.unmount()
  })

  it("renders content at natural height when mounted with height=\"auto\"", async () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", flexDirection: "column", width: 200, height: 400 }}>
            <AnimateHeight height="auto" testId="drawer">
              <div style={{ height: 60 }} />
            </AnimateHeight>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    await wait(300)
    await app.settle()

    const drawer = app.renderer.findByTestId("drawer")!
    expect(app.renderer.getElementBounds(drawer.id)?.height).toBeGreaterThan(55)

    app.unmount()
  })
})
