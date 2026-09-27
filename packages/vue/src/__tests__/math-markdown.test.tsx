import { defineComponent, h, ref } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { renderMathMap } from "../math/index.js"

const describeNative = describe.skipIf(!hasNativeTestRenderer)

describeNative("markdown math", () => {
  it("renders mapped display math as an image and keeps the TeX fallback readable", async () => {
    const source = "Before.\n\n$$E = mc^2$$\n\nInline $a_1 + b^2$ stays text."
    const math = await renderMathMap(source, { color: "#e8e8e8" })

    // The map covers both formulas; only the display one is block-rendered.
    expect(math["E = mc^2"].src.startsWith("data:image/svg+xml;base64,")).toBe(true)
    expect(math["E = mc^2"].width).toBeGreaterThan(0)
    expect(math["E = mc^2"].height).toBeGreaterThan(1)

    const App = defineComponent({
      setup() {
        return () => h("markdown", { source, math })
      },
    })
    const app = createTestApp(App)
    const painted = app.renderer.getPaintedText().join("\n")
    // Mapped display math paints as an image: no literal TeX in the paint log.
    expect(painted).toContain("Before.")
    expect(painted).not.toContain("E = mc^2")
    // Inline math keeps its TeX source visible as the fallback run.
    expect(painted).toContain("a_1 + b^2")
    app.unmount()
  })

  it("falls back to the literal TeX card when no map is provided", async () => {
    const App = defineComponent({
      setup() {
        return () => h("markdown", { source: "Before.\n\n$$E = mc^2$$\n\nAfter." })
      },
    })
    const app = createTestApp(App)
    const painted = app.renderer.getPaintedText().join("\n")
    expect(painted).toContain("E = mc^2")
    expect(painted).toContain("After.")
    app.unmount()
  })
})

describe("renderMathMap scanning", () => {
  it("skips fenced and inline code spans", async () => {
    const source = "$x$ text\n\n```\n$not math$\n```\n\n`$also not$` and $y$"
    const math = await renderMathMap(source)
    expect(Object.keys(math).sort()).toEqual(["x", "y"])
  })

  it("does not cross newlines for inline math", async () => {
    const math = await renderMathMap("price $5\nand $x$ here")
    expect(Object.keys(math)).toEqual(["x"])
  })
})
