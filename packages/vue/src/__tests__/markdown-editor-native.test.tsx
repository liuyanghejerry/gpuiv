/** M2 native block editing layer: the `<input>`/`<textarea>` elements render
 *  styled spans (the `spans` prop), paint decoration rects, and accept a
 *  programmatic `selection` — the three channels the headless-ProseMirror
 *  WYSIWYG architecture needs from the native side (docs/markdown-editor-plan.md). */

// @ts-nocheck

import { defineComponent, ref } from "vue"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("editor spans / decorations / selection props", () => {
  it("renders themed selection over inline code and highlight backgrounds", async () => {
    const App = defineComponent({
      setup: () => () => (
        <div style={{ width: 600, height: 140, padding: 24, backgroundColor: "#f0edea" }}>
          <textarea testId="themed-selection" value="plain code highlight" selection={[0, 20]}
            spans={[{ start: 6, end: 10, background: "#e8e4df" }, { start: 11, end: 20, background: "#f0d9a8" }]}
            style={{ width: "100%", fontSize: 20, lineHeight: 38, color: "#2c2c2c", selectionColor: "rgba(196, 75, 43, 0.2)" }} />
        </div>
      ),
    })
    const app = createTestApp(App, { width: 600, height: 140 })
    await app.settle()
    const input = app.renderer.findByTestId("themed-selection")!
    app.renderer.focusElement(input.id)
    await app.settle()
    app.renderer.captureScreenshot(fileURLToPath(new URL("../../screenshots/markdown-selection-inline.png", import.meta.url)))
    expect(app.renderer.getPaintedInputRuns(input.id).map((run) => run.text).join("")).toBe("plain code highlight")
    app.unmount()
  })

  it.each(["center", "right"])("aligns %s text hit testing and decoration rectangles", async (textAlign) => {
    const App = defineComponent({
      setup: () => () => <textarea testId="aligned" value="Status" minRows={1}
        decorations={[{ start: 0, end: 6, color: "#8888ff88" }]}
        style={{ width: 300, textAlign, fontSize: 16 }} />,
    })
    const app = createTestApp(App)
    await app.settle()
    const block = app.renderer.findByTestId("aligned")!
    const bounds = app.renderer.getElementBounds(block.id)!
    const start = app.renderer.getInputTextPosition(block.id, 0)
    const end = app.renderer.getInputTextPosition(block.id, 6)
    if (textAlign === "right") expect(end[0]).toBeCloseTo(bounds.x + bounds.width, 1)
    else expect((start[0] + end[0]) / 2).toBeCloseTo(bounds.x + bounds.width / 2, 1)
    for (const offset of [0, 2, 6]) {
      const [x, y] = app.renderer.getInputTextPosition(block.id, offset)
      expect(app.renderer.getInputTextOffset(block.id, x, y + 2)).toBe(offset)
    }
    const rect = app.renderer.getInputDecorations(block.id)[0].rects[0]
    expect(rect.x).toBeCloseTo(start[0], 1)
    expect(rect.x + rect.width).toBeCloseTo(end[0], 1)
    app.unmount()
  })

  it("extends a delegated drag to the block boundary regardless of horizontal position", async () => {
    const drags: any[] = []
    const App = defineComponent({
      setup: () => () => (
        <div style={{ paddingTop: 80, width: 400 }}>
          <textarea testId="drag-block" value={"first line\nsecond line"} minRows={2}
            onSelectionDrag={(event) => drags.push(event)} />
        </div>
      ),
    })
    const app = createTestApp(App)
    await app.settle()
    const block = app.renderer.findByTestId("drag-block")!
    const bounds = app.renderer.getElementBounds(block.id)!
    const [x, y] = app.renderer.getInputTextPosition(block.id, 3)
    app.renderer.nativeSimulateMouseDown(x, y + 2, 0)
    app.renderer.nativeSimulateMouseMove(x, bounds.y + bounds.height + 30, 0)
    await app.settle()
    expect(drags.at(-1)).toMatchObject({ startIndex: 3, endIndex: 22 })
    app.renderer.nativeSimulateMouseMove(x, bounds.y - 30, 0)
    await app.settle()
    expect(drags.at(-1)).toMatchObject({ startIndex: 3, endIndex: 0 })
    const [backX, backY] = app.renderer.getInputTextPosition(block.id, 6)
    app.renderer.nativeSimulateMouseMove(backX, backY + 2, 0)
    await app.settle()
    expect(drags.at(-1)).toMatchObject({ startIndex: 3, endIndex: 6 })
    app.renderer.nativeSimulateMouseUp(backX, backY + 2, 0)
    app.unmount()
  })

  // "hello world": bold "hello", italic+underline "world"
  const spansFor = (text: string) => {
    if (!text.startsWith("hello")) return []
    return [
      { start: 0, end: 5, fontWeight: 700 },
      { start: 6, end: 11, fontStyle: "italic", underline: true },
    ]
  }

  function editorApp(initial = "hello world") {
    const value = ref(initial)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 400, padding: 8 }}>
            <input
              testId="block"
              value={value.value}
              spans={spansFor(value.value)}
              onChange={(e) => {
                value.value = e.value
              }}
            />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    return { app, value }
  }

  it("renders styled runs from the spans prop", async () => {
    const { app } = editorApp()
    await app.settle()
    const input = app.renderer.findByTestId("block")
    const runs = app.renderer.getPaintedInputRuns(input.id)
    expect(runs.map((run) => run.text)).toEqual(["hello", " ", "world"])
    expect(runs[0].bold).toBe(true)
    expect(runs[0].italic).toBe(false)
    expect(runs[1].bold).toBe(false)
    expect(runs[2].italic).toBe(true)
    expect(runs[2].underline).toBe(true)
    app.unmount()
  })

  it("keeps spans when the value round-trips through JS (echo suppression)", async () => {
    const { app, value } = editorApp()
    await app.settle()
    const input = app.renderer.findByTestId("block")
    app.renderer.nativeSimulateKeystrokes(input.id, "cmd-a")
    app.renderer.nativeSimulateKeystrokes(input.id, "x")
    await app.settle()
    // select-all + x replaces, it does not append ("hello worldx").
    expect(value.value).toBe("x")
    value.value = "hello world"
    await app.settle()
    const runs = app.renderer.getPaintedInputRuns(input.id)
    expect(runs.length).toBeGreaterThanOrEqual(3)
    expect(runs[0].text).toBe("hello")
    expect(runs[0].bold).toBe(true)
    app.unmount()
  })

  it("carries the IME preedit underline across span boundaries", async () => {
    const { app } = editorApp()
    await app.settle()
    const input = app.renderer.findByTestId("block")
    app.renderer.simulateMarkedText(input.id, "nihao", 0, 5)
    await app.settle()
    const runs = app.renderer.getPaintedInputRuns(input.id)
    // The composed segment renders as an underlined run regardless of spans.
    expect(runs.some((run) => run.underline && run.text.includes("nihao"))).toBe(true)
    app.renderer.simulateImeCommit(input.id, "nihao")
    await app.settle()
    app.unmount()
  })

  it("paints decoration rects for search-style ranges", async () => {
    const value = ref("hello world")
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 400, padding: 8 }}>
            <input
              testId="block"
              value={value.value}
              decorations={[{ start: 6, end: 11, color: "#ffe06666" }]}
              onChange={(e) => {
                value.value = e.value
              }}
            />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    const input = app.renderer.findByTestId("block")
    const decorations = app.renderer.getInputDecorations(input.id)
    expect(decorations.length).toBe(1)
    expect(decorations[0].start).toBe(6)
    expect(decorations[0].end).toBe(11)
    // Hsla round-trip shifts the last bit of a channel; assert the shape,
    // not the exact value.
    expect(decorations[0].color.toLowerCase()).toMatch(/^#[0-9a-f]{8}$/)
    expect(decorations[0].rects.length).toBeGreaterThanOrEqual(1)
    for (const rect of decorations[0].rects) {
      expect(rect.width).toBeGreaterThan(0)
      expect(rect.height).toBeGreaterThan(0)
    }
    app.unmount()
  })

  it("applies a programmatic selection that the next keystroke replaces", async () => {
    const value = ref("hello world")
    const selection = ref([0, 5])
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 400, padding: 8 }}>
            <input
              testId="block"
              value={value.value}
              selection={selection.value}
              onChange={(e) => {
                value.value = e.value
              }}
            />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    const input = app.renderer.findByTestId("block")
    // The external selection [0,5) covers "hello"; typing J replaces it.
    app.renderer.nativeSimulateKeystrokes(input.id, "j")
    await app.settle()
    expect(value.value).toBe("j world")
    app.unmount()
  })

  it("supports background spans for highlight marks", async () => {
    const value = ref("marked")
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 400, padding: 8 }}>
            <input
              testId="block"
              value={value.value}
              spans={[{ start: 0, end: 6, background: "#88440088", strikethrough: true }]}
              onChange={(e) => {
                value.value = e.value
              }}
            />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    const input = app.renderer.findByTestId("block")
    const runs = app.renderer.getPaintedInputRuns(input.id)
    expect(runs.length).toBe(1)
    expect(runs[0].background).toBeTruthy()
    expect(runs[0].strikethrough).toBe(true)
    app.unmount()
  })

  it("measures caret positions and hit-tests points back to offsets", async () => {
    const { app } = editorApp()
    await app.settle()
    const input = app.renderer.findByTestId("block")
    const p0 = app.renderer.getInputTextPosition(input.id, 0)
    const p5 = app.renderer.getInputTextPosition(input.id, 5)
    const p11 = app.renderer.getInputTextPosition(input.id, 11)
    expect(p0.length).toBe(2)
    expect(p5.length).toBe(2)
    expect(p5[0]).toBeGreaterThan(p0[0])
    expect(p11[0]).toBeGreaterThan(p5[0])
    // Same visual line: y equal for all offsets of a single-line input.
    expect(p5[1]).toBeCloseTo(p0[1], 5)
    // Round trip: the point of an offset hit-tests back to that offset.
    expect(app.renderer.getInputTextOffset(input.id, p5[0], p5[1])).toBe(5)
    expect(app.renderer.getInputTextOffset(input.id, p0[0], p0[1])).toBe(0)
    expect(app.renderer.getInputTextOffset(input.id, p11[0], p11[1])).toBe(11)
    app.unmount()
  })
})
