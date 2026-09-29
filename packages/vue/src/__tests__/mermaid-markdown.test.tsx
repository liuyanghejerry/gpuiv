/// GPU-backed assertions for the markdown mermaid map: mapped fences paint
/// as images, unmapped fences degrade to the labelled code card.

import { defineComponent, h } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = describe.skipIf(!hasNativeTestRenderer)

const DIAGRAM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#ff5500"/></svg>`
const DIAGRAM_SRC = `data:image/svg+xml;base64,${Buffer.from(DIAGRAM_SVG).toString("base64")}`

const SOURCE = "Before.\n\n```mermaid\ngraph TD;\n  A-->B;\n```\n\nAfter."

const App = (props: { source: string; mermaid?: Record<string, { src: string }> }) =>
  defineComponent({
    setup() {
      return () => h("markdown", { ...props })
    },
  })

describeNative("markdown mermaid", () => {
  it("renders a mapped fence as an image and keeps the card fallback readable", () => {
    // Mapped: the fence paints as an image — the diagram source and the
    // card's `mermaid` label never appear in the paint log.
    const mapped = createTestApp(
      App({ source: SOURCE, mermaid: { "graph TD;\n  A-->B;": { src: DIAGRAM_SRC } } }),
    )
    const painted = mapped.renderer.getPaintedText().join("\n")
    expect(painted).toContain("Before.")
    expect(painted).toContain("After.")
    expect(painted).not.toContain("graph TD;")
    expect(painted).not.toContain("A-->B;")
    mapped.unmount()

    // Unmapped: the degraded card shows the label and the source, so the
    // diagram stays readable as text.
    const unmapped = createTestApp(App({ source: SOURCE }))
    const fallback = unmapped.renderer.getPaintedText().join("\n")
    expect(fallback).toContain("mermaid")
    expect(fallback).toContain("graph TD;")
    expect(fallback).toContain("A-->B;")
    unmapped.unmount()
  })

  it("matches fences through trimmed map keys", () => {
    // The fence source keeps its inner blank lines; the lookup trims both
    // sides, the same convention as the math map.
    const source = "```mermaid\n\nflow\n\n```"
    const app = createTestApp(App({ source, mermaid: { flow: { src: DIAGRAM_SRC } } }))
    expect(app.renderer.getPaintedText().join("\n")).not.toContain("flow")
    app.unmount()
  })

  it("ignores an empty src instead of rendering a broken image", () => {
    const app = createTestApp(
      App({ source: SOURCE, mermaid: { "graph TD;\n  A-->B;": { src: "" } } }),
    )
    const painted = app.renderer.getPaintedText().join("\n")
    expect(painted).toContain("graph TD;")
    app.unmount()
  })
})
