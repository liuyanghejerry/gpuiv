import { defineComponent } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("runtime window resize", () => {
  it("records validated requests without pretending to resize an offscreen window", async () => {
    const app = createTestApp(defineComponent({
      setup: () => () => <div testId="viewport" style={{ width: "100%", height: "100%" }}>
        <div testId="edge" style={{ position: "absolute", right: 0, bottom: 0, width: 20, height: 20 }} />
      </div>,
    }), { width: 400, height: 300 })
    try {
      expect(app.renderer.getLastWindowResize()).toBeNull()
      app.renderer.resizeWindow(620, 420)
      await app.settle()
      expect(app.renderer.getLastWindowResize()).toEqual({ width: 620, height: 420 })
      expect(app.renderer.getWindowSize()).toEqual({ width: 400, height: 300 })

      app.renderer.resizeWindow(320, 240)
      await app.settle()
      expect(app.renderer.getLastWindowResize()).toEqual({ width: 320, height: 240 })
    } finally { app.unmount() }
  })

  it("rejects invalid dimensions before changing the window", async () => {
    const app = createTestApp(defineComponent({ setup: () => () => <text>Window</text> }), { width: 400, height: 300 })
    try {
      for (const value of [0, -1, NaN, Infinity, -Infinity, 1e300, Number.MIN_VALUE]) {
        expect(() => app.renderer.resizeWindow(value, 300)).toThrow(/positive, finite/)
        expect(() => app.renderer.resizeWindow(400, value)).toThrow(/positive, finite/)
      }
      await app.settle()
      expect(app.renderer.getWindowSize()).toEqual({ width: 400, height: 300 })
      expect(app.renderer.getLastWindowResize()).toBeNull()
    } finally { app.unmount() }
  })
})
