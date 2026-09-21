/** GPU-backed regression tests for empty text nodes.
 *
 *  Vue compiles `{items.map(…)}` sitting among JSX siblings into a Fragment
 *  whose children are bracketed by empty text anchors (`createTextVNode('')`).
 *  In the DOM an empty text node has no box; GPUIV used to hand the empty
 *  string to the text shaper, which occupies a full line height (~26px at the
 *  default font) and showed up as a phantom band above and below mapped rows
 *  (e.g. between @gpuiv/beautiful-ui FilterTable's header and first row). */

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("empty text (vue)", () => {
  it("collapses fragment anchor text nodes to zero size", () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div testId="outer" style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ height: 10 }} />
            {[1, 2].map((i) => (
              <div key={i} style={{ height: 10 }} />
            ))}
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const outer = app.renderer.findByTestId("outer")!
    // 3 × 10px children; each fragment anchor used to add ~26px.
    expect(app.renderer.getElementBounds(outer.id)!.height).toBe(30)
    app.unmount()
  })

  it("grows a text node that starts empty once it gains content", async () => {
    const show = ref(false)
    const App = defineComponent({
      setup() {
        return () => (
          <div testId="outer" style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ height: 10 }} />
            {show.value ? "later" : ""}
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const outer = app.renderer.findByTestId("outer")!
    expect(app.renderer.getElementBounds(outer.id)!.height).toBe(10)

    show.value = true
    await app.settle()
    expect(app.renderer.getElementBounds(outer.id)!.height).toBeGreaterThan(10)
    app.unmount()
  })
})
