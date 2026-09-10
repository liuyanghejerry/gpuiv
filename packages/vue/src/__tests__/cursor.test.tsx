/// GPU-backed tests for the CSS cursor keyword mapping: every supported
/// keyword applies without crashing the frame, hit-testing stays unchanged,
/// and an unsupported value is ignored instead of breaking the render.

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import type { CursorStyle } from "../types.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const KEYWORDS: CursorStyle[] = [
  "auto",
  "default",
  "pointer",
  "text",
  "vertical-text",
  "crosshair",
  "grab",
  "grabbing",
  "move",
  "all-scroll",
  "context-menu",
  "not-allowed",
  "no-drop",
  "alias",
  "copy",
  "col-resize",
  "row-resize",
  "ew-resize",
  "ns-resize",
  "nesw-resize",
  "nwse-resize",
  "n-resize",
  "e-resize",
  "s-resize",
  "w-resize",
  "ne-resize",
  "nw-resize",
  "se-resize",
  "sw-resize",
]

// `none` has no gpui counterpart yet (needs the GPUI fork); exercising the
// unsupported path is exactly what this suite is for.
const unsupportedCursor = "none" as unknown as CursorStyle

describeNative("cursor styles (vue)", () => {
  it("applies every supported keyword without crashing the frame", () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
            {KEYWORDS.map((keyword) => (
              <div key={keyword} style={{ cursor: keyword, padding: 2 }}>
                <text>{keyword}</text>
              </div>
            ))}
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const painted = app.renderer.getAllText().join(" ")
    for (const keyword of KEYWORDS) {
      expect(painted).toContain(keyword)
    }
  })

  it("keeps click hit-testing unchanged under a cursor style", async () => {
    const clicks = ref<string[]>([])
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            <div
              testId="target"
              style={{ padding: 20, backgroundColor: "#333", cursor: "crosshair" }}
              onClick={() => clicks.value.push("target")}
            >
              <text>target</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const target = app.renderer.findByText("target")!
    const bounds = app.renderer.getElementBounds(target.id)!

    app.renderer.nativeSimulateClick(bounds[0] + 5, bounds[1] + 5, 0)
    await app.settle()
    expect(clicks.value).toEqual(["target"])
  })

  it("ignores an unsupported cursor value without breaking the render", async () => {
    const clicks = ref(0)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
            <div
              testId="brush"
              style={{ padding: 20, backgroundColor: "#222", cursor: unsupportedCursor }}
              onClick={() => clicks.value++}
            >
              <text>brush</text>
            </div>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const target = app.renderer.findByText("brush")!
    const bounds = app.renderer.getElementBounds(target.id)!

    app.renderer.nativeSimulateClick(bounds[0] + 5, bounds[1] + 5, 0)
    await app.settle()
    expect(clicks.value).toBe(1)
    expect(app.renderer.getAllText()).toContain("brush")
  })
})
