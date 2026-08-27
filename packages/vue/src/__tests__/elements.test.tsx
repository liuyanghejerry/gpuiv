/// GPU-backed assertions for the native text elements (Vue): markdown
/// typography, code line numbers and syntax tokens, diff headers.

import { defineComponent } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const SNIPPET = `export function greet(name: string) {
  return \`hello \${name}\`
}`

const PATCH = [
  "diff --git a/src/ui.ts b/src/ui.ts",
  "--- a/src/ui.ts",
  "+++ b/src/ui.ts",
  "@@ -1,4 +1,4 @@",
  "-const dark = true",
  "+const dark = false",
  " default",
].join("\n")

describeNative("native text elements (vue)", () => {
  it("renders markdown headings, links and inline code", () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ padding: 24, backgroundColor: "#060606" }}>
            <markdown
              source={"# Heading\n\nSome **bold** and a [link](https://example.com) and `code`."}
            />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const painted = app.renderer.getPaintedText().join("\n")
    expect(painted).toContain("Heading")
    expect(painted).toContain("bold")
    expect(painted).toContain("link")
    expect(painted).toContain("code")
    app.unmount()
  })

  it("renders code line numbers and tokens", () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ padding: 24, backgroundColor: "#060606" }}>
            <code code={SNIPPET} language="ts" showLineNumbers />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const painted = app.renderer.getPaintedText().join("\n")
    expect(painted).toContain("export function greet")
    expect(painted).toContain("hello ${name}")
    // Line numbers are painted as chrome text.
    expect(app.renderer.getPaintedText()).toContain("1")
    expect(app.renderer.getPaintedText()).toContain("3")
    app.unmount()
  })

  it("normalizes CRLF source lines", () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", flexDirection: "column", padding: 20 }}>
            <code code={"// one\r\n// two\r\n"} language="ts" />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    // The trailing newline still produces the final empty row.
    expect(app.renderer.getPaintedText()).toEqual(["// one", "// two", ""])
    expect(app.renderer.dragSelect(22, 25, 900, 42)).toBe("// one\n// two")
    app.unmount()
  })

  it("paints no surface of its own and never paints the language header", () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", padding: 24, backgroundColor: "#060606" }}>
            <code code={"a\nb\nc"} language="ts" />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    // Only the rows paint: no language tag, no header strip, no chrome.
    expect(app.renderer.getPaintedText()).toEqual(["a", "b", "c"])
    const node = app.renderer.findByType("code")[0]!
    const bounds = app.renderer.getElementBounds(node.id)!
    // Exactly three rows at the default line height: no padding of its own.
    expect(bounds[3]).toBe(3 * 18)
    app.unmount()
  })

  it("grows by the padding from the style prop", () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", padding: 24, backgroundColor: "#060606" }}>
            <code code={"a\nb\nc"} language="ts" style={{ padding: 20 }} />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const node = app.renderer.findByType("code")[0]!
    const bounds = app.renderer.getElementBounds(node.id)!
    expect(bounds[3]).toBe(3 * 18 + 40)
    app.unmount()
  })

  it("takes the line height and font size from the style prop", () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", padding: 24, backgroundColor: "#060606" }}>
            <code code={"a\nb\nc"} language="ts" style={{ fontSize: 20, lineHeight: 30 }} />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const node = app.renderer.findByType("code")[0]!
    const bounds = app.renderer.getElementBounds(node.id)!
    // The row height follows style.lineHeight, so tall glyphs are never clipped.
    expect(bounds[3]).toBe(3 * 30)
    app.unmount()
  })

  it("scales the rows when only fontSize is given", () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", padding: 24, backgroundColor: "#060606" }}>
            <code code={"a\nb\nc"} language="ts" style={{ fontSize: 25 }} />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const node = app.renderer.findByType("code")[0]!
    const bounds = app.renderer.getElementBounds(node.id)!
    // Double the glyphs and the rows must double too, or the lines overlap.
    expect(bounds[3]).toBe(3 * 2 * 18)
    app.unmount()
  })

  it("renders diff file headers and hunks", () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ padding: 24, backgroundColor: "#060606" }}>
            <diff patch={PATCH} wordDiff />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const painted = app.renderer.getPaintedText().join("\n")
    expect(painted).toContain("src/ui.ts")
    expect(painted).toContain("const dark = true")
    expect(painted).toContain("const dark = false")
    app.unmount()
  })

  it("renders svg icons from a data URL", () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ padding: 24, backgroundColor: "#060606" }}>
            {/* minified square icon encoded as a data URL */}
            <svg
              src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='black'/%3E%3C/svg%3E"
              style={{ width: 16, height: 16, color: "#fff" }}
            />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const icon = app.renderer.findByType("svg")[0]
    expect(icon).toBeDefined()
    expect(String(icon.customProps?.src)).toContain("data:image/svg+xml")
    app.unmount()
  })
})
