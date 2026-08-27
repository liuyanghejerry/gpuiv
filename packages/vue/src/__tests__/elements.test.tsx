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
            <code code={"// one\r\n// two\r\n"} language="ts" showHeader={false} />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    // The trailing newline still produces the final empty row.
    expect(app.renderer.getPaintedText()).toEqual(["// one", "// two", ""])
    expect(app.renderer.dragSelect(22, 35, 900, 60)).toBe("// one\n// two")
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
