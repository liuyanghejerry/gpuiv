/** Screenshot + smoke test for the markdown-editor example app.
 *  `bun scripts/dev.ts --shots markdown-editor` renders this; the PNG lands
 *  in packages/vue/screenshots/markdown-editor.png. */

// @ts-nocheck

import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

// The example normally loads dist. Use the same source module as the test
// renderer so Vue's renderer injection key is shared for focus/scroll APIs.
vi.mock("@gpuiv/vue", () => import("../index.js"))

const exampleUrl = new URL("../../../../examples/markdown-editor.tsx", import.meta.url)
const { App } = await import(fileURLToPath(exampleUrl))

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("markdown-editor example screenshot", () => {
  it("renders the editor, outline and toolbar", async () => {
    const app = createTestApp(App, { height: 500 })
    await app.settle()
    const shot = fileURLToPath(new URL("../../screenshots/markdown-editor.png", import.meta.url))
    app.renderer.captureScreenshot(shot)

    // The document is taller than the window: the editor column scrolls, so
    // assert the top, then scroll to the bottom and assert the tail.
    const painted = new Set(app.renderer.getPaintedText())
    const column = app.renderer.findByTestId("editor-column")
    expect(column).toBeTruthy()
    const offset = app.renderer.getScrollOffset(column.id)
    expect(offset).toBeTruthy()
    // Scroll offsets are negative pixel values (down = more negative y).
    // Visit intermediate sections too: typography and window width determine
    // which blocks fit in any one viewport.
    for (let y = 400; y <= 2400; y += 400) {
      app.renderer.scrollTo(column.id, 0, -y)
      await app.settle()
      for (const text of app.renderer.getPaintedText()) painted.add(text)
    }
    app.renderer.scrollTo(column.id, 0, -1e9)
    await app.settle()
    const bottomOffset = app.renderer.getScrollOffset(column.id)
    app.renderer.captureScreenshot(fileURLToPath(new URL("../../screenshots/markdown-editor-bottom.png", import.meta.url)))
    expect(Math.abs(bottomOffset[1])).toBeGreaterThan(Math.abs(offset[1]))
    for (const text of app.renderer.getPaintedText()) painted.add(text)
    const all = [...painted].join("\n")
    // The document painted: heading, task, table, footnote definition.
    for (const expected of [
      "Markdown, edited natively",
      "tasks toggle by click",
      "Feature",
      "definitions render at the end",
    ]) {
      expect(all).toContain(expected)
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

  it("clears selection when clicking the blank outline area outside the editor", async () => {
    const app = createTestApp(App, { width: 940, height: 720 })
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    app.renderer.focusElement(blocks[0].id)
    app.renderer.nativeSimulateKeystrokes(blocks[0].id, "cmd-a")
    await app.settle()
    expect(app.renderer.getInputDecorations(blocks[1].id).length).toBeGreaterThan(0)
    app.renderer.nativeSimulateMouseDown(900, 600, 0)
    app.renderer.nativeSimulateMouseUp(900, 600, 0)
    await app.settle()
    expect(app.renderer.getInputDecorations(blocks[1].id)).toHaveLength(0)
    app.unmount()
  })

  it("keeps source mode inside the same full-height reading column", async () => {
    const app = createTestApp(App, { width: 940, height: 720 })
    await app.settle()
    const visual = app.renderer.getElementBounds(app.renderer.findByType("textarea")[0].id)!
    const toggle = app.renderer.findByTestId("mode-toggle")!
    const button = app.renderer.getElementBounds(toggle.id)!
    app.renderer.nativeSimulateMouseDown(button.x + 4, button.y + 4, 0)
    app.renderer.nativeSimulateMouseUp(button.x + 4, button.y + 4, 0)
    await app.settle()
    const source = app.renderer.findByType("textarea")[0]
    app.renderer.focusElement(source.id)
    app.renderer.nativeSimulateKeystrokes(source.id, "cmd-up")
    await app.settle()
    const column = app.renderer.findByTestId("editor-column")!
    app.renderer.scrollTo(column.id, 0, 0)
    await app.settle()
    const bounds = app.renderer.getElementBounds(column.id)!
    const text = app.renderer.getElementBounds(source.id)!
    expect(text.height).toBeGreaterThanOrEqual(bounds.height - 80)
    expect(text.x).toBeCloseTo(visual.x, 1)
    expect(text.y).toBeCloseTo(visual.y, 1)
    expect(text.width).toBeLessThanOrEqual(bounds.width - 80)
    app.renderer.nativeSimulateKeystrokes(source.id, "cmd-down")
    await app.settle()
    expect(app.renderer.getScrollOffset(column.id)[1]).toBeLessThan(0)
    app.unmount()
  })
})
