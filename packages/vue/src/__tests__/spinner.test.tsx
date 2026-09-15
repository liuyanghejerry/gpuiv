/** Spinner: three pulsing dots by default, an indeterminate sliding bar on
 *  `variant="pulse"`. `phase` pins the animation for deterministic asserts. */

// @ts-nocheck

import { defineComponent } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { Spinner } from "../index.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

function styledDivs(app, predicate) {
  const out = []
  const walk = (node) => {
    if (node && typeof node === "object") {
      if (node.type === "div" && node.style && predicate(node.style)) out.push(node)
      for (const child of node.children ?? []) walk(child)
    }
  }
  const tree = app.renderer.toJSON()
  for (const node of tree.children ?? []) walk(node)
  return out
}

describeNative("spinner (vue)", () => {
  it("announces itself through the status role", async () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ padding: 24 }}>
            <Spinner phase={0} label="Thinking" />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    const nodes = Object.values(app.renderer.getA11yTree().nodes ?? {})
    expect(
      nodes.some((node) => node.aria?.role === "Status" && node.aria?.label === "Thinking")
    ).toBe(true)
    app.unmount()
  })

  it("renders three dots whose opacity follows the phase", () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ padding: 24 }}>
            <Spinner phase={300} />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const dots = styledDivs(app, (style) => style.width === 8)
    expect(dots.length).toBe(3)
    // cycleTone(300, 0) is the peak; each later dot lags its stagger.
    const opacities = dots.map((dot) => dot.style.opacity)
    expect(opacities[0]).toBeGreaterThan(opacities[1])
    expect(opacities[1]).toBeGreaterThan(opacities[2])
    expect(opacities[0]).toBeLessThanOrEqual(1)
    expect(opacities[2]).toBeGreaterThanOrEqual(0.25)
    app.unmount()
  })

  it("renders the pulse variant as a track with a sliding segment", () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ padding: 24 }}>
            <Spinner variant="pulse" phase={600} width={100} size={4} />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const track = styledDivs(app, (style) => style.width === 100)[0]
    expect(track).toBeTruthy()
    expect(track.style.height).toBe(4)
    // Halfway through the cycle the segment sits at the far end.
    const segment = styledDivs(app, (style) => style.width === 35)[0]
    expect(segment).toBeTruthy()
    expect(segment.style.left).toBe(65)
    app.unmount()
  })
})
