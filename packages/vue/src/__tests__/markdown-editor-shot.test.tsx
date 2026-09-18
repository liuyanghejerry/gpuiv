/** Screenshot + smoke test for the markdown-editor example app.
 *  `bun scripts/dev.ts --shots markdown-editor` renders this; the PNG lands
 *  in packages/vue/screenshots/markdown-editor.png. */

// @ts-nocheck

import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const exampleUrl = new URL("../../../../examples/markdown-editor.tsx", import.meta.url)
const { App } = await import(fileURLToPath(exampleUrl))

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("markdown-editor example screenshot", () => {
  it("renders the editor, outline and toolbar", async () => {
    const app = createTestApp(App)
    await app.settle()
    const shot = fileURLToPath(new URL("../../screenshots/markdown-editor.png", import.meta.url))
    app.renderer.captureScreenshot(shot)

    // The document painted: heading, task, table, footnote definition.
    const painted = app.renderer.getPaintedText().join("\n")
    for (const expected of [
      "Markdown, edited natively",
      "tasks toggle by click",
      "Feature",
      "definitions render at the end",
    ]) {
      expect(painted).toContain(expected)
    }
    // Outline entries are live.
    expect(app.renderer.findByTestId("outline-Blocks")).toBeTruthy()
    app.unmount()
  })

  it("smoke: search highlights matches through the example UI", async () => {
    const app = createTestApp(App)
    await app.settle()
    const input = app.renderer.findByTestId("search-input")
    app.renderer.nativeSimulateKeystrokes(input.id, "m a r k")
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    const highlighted = blocks.filter((block) => app.renderer.getInputDecorations(block.id).length > 0)
    expect(highlighted.length).toBeGreaterThanOrEqual(1)
    app.unmount()
  })
})
