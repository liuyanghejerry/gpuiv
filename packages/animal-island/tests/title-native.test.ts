/** Actual GPUI/Taffy bounds and text selection; Linux currently lacks the
 * headless test renderer. SVG geometry/host regressions run in title.test.ts.
 */
import { defineComponent, h } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../../vue/src/testing.js"
import { Title, type TitleVariant } from "../src/components/Title.js"
import { createTitleDecoration } from "../src/components/title-decoration.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip
describeNative("Title GPUI decoration bounds", () => {
  it.each(["ribbon", "layer", "tab"] as TitleVariant[])("reserves %s silhouette space and aligns the decoration to native text", async variant => {
    const app = createTestApp(defineComponent({ setup: () => () => h("div", {
      style: { display: "flex", padding: 40, alignItems: "flex-start", width: 600, height: 240 },
    }, [h(Title, { variant, testId: "title" }, { default: () => ["小岛 ", h("text", null, "🐱"), " e\u0301"] })]) }), { width: 600, height: 240 })
    try {
      await app.settle()
      // Bounds are last-painted snapshots. Let the component's next size
      // sample create the image, then settle the resulting native frame.
      await new Promise(resolve => setTimeout(resolve, 120))
      await app.settle()
      const bounds = (testId: string) => app.renderer.getElementBounds(app.renderer.findByTestId(testId)!.id)!
      const root = bounds("title"), surface = bounds("title-surface"), image = bounds("title-decoration"), text = bounds("title-text")
      expect(surface.height).toBeCloseTo(variant === "layer" ? 42 : 40, 1)
      expect(root.width - surface.width).toBeCloseTo(variant === "ribbon" ? 24 : variant === "layer" ? 5.2 : 0, 1)
      expect(root.height - surface.height).toBeCloseTo(variant === "ribbon" ? 8 : variant === "layer" ? 6 : 0, 1)
      // Leaf images report their own GPUI paint bounds. A padded div's
      // embedded canvas tracker can have a flex static-position offset; use
      // its reliable dimensions and reconstruct the surface origin from the
      // leaf's known bleed rather than asserting that tracker x/y.
      const art = createTitleDecoration(variant, 20, surface.width, surface.height, {
        front: "#27d039", back: "#20992a", fold: "#115017", text: "#ffffff",
      })
      const surfaceX = image.x - art.left, surfaceY = image.y - art.top
      expect(text.x - surfaceX).toBeCloseTo(variant === "ribbon" ? 32 : variant === "layer" ? 31 : 38, 0)
      expect(surfaceX + surface.width - text.x - text.width).toBeCloseTo(variant === "ribbon" ? 32 : variant === "layer" ? 31 : 30, 0)
      expect(image.x + image.width).toBeGreaterThan(surfaceX + surface.width)
      expect(image.y + image.height).toBeGreaterThan(surfaceY + surface.height)
      expect(text.height).toBeLessThanOrEqual(23)
      expect(app.renderer.getPaintedText()).toContain("小岛 🐱 e\u0301")
      expect(app.renderer.dragSelect(text.x - 2, text.y + text.height / 2, text.x + text.width + 2, text.y + text.height / 2)).toBe("小岛 🐱 e\u0301")
    } finally {
      app.unmount()
    }
  })
})
