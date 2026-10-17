/** Native layout/paint proof for `display: none`. Linux has no readback test
 * renderer; host tests and the Animal Island Carousel suite still run there. */
import { defineComponent, h } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("display none", () => {
  it("keeps the subtree mounted while removing it from layout and paint", async () => {
    const app = createTestApp(defineComponent(() => () => h("div", {
      style: { width: 400, height: 300, backgroundColor: "white", padding: 20 },
    }, [
      h("div", { testId: "visible", style: { width: 100, height: 20, backgroundColor: "red" } }, [h("text", "visible")]),
      h("div", { testId: "hidden", style: { display: "none", width: 100, height: 20, backgroundColor: "blue" } }, [h("text", "hidden")]),
    ])))
    try {
      await app.settle()
      expect(app.renderer.getAllText()).toEqual(expect.arrayContaining(["visible", "hidden"]))
      expect(app.renderer.getPaintedText()).toContain("visible")
      expect(app.renderer.getPaintedText()).not.toContain("hidden")
      const node = app.renderer.findByTestId("hidden")
      expect(node).toBeDefined()
      const bounds = app.renderer.getElementBounds(node!.id)
      expect(bounds?.width ?? 0).toBe(0)
      expect(bounds?.height ?? 0).toBe(0)
    } finally {
      app.unmount()
    }
  })
})
