/** M3 features: footnote rendering, ⌘F search decorations, and source-mode
 *  switching with scroll-ratio restore. docs/markdown-editor-plan.md
 *  M0-leftover / M3.7 / M3.5. */

// @ts-nocheck

import { defineComponent, h, ref } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { MarkdownEditor } from "../markdown-editor/component.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

function editorApp(opts: { source?: string; query?: string; active?: number; mode?: string } = {}) {
  const state = ref({ query: opts.query ?? "", active: opts.active ?? -1, mode: opts.mode ?? "wysiwyg" })
  const matches = ref(-1)
  const changes: string[] = []
  let editor: any = null
  const App = defineComponent({
    setup() {
      return () =>
        h("div", { style: { width: 600, padding: 8 } }, () => [
          h(MarkdownEditor, {
            ref: (el: any) => {
              editor = el
            },
            source: opts.source ?? "",
            searchQuery: state.value.query,
            searchActiveIndex: state.value.active,
            mode: state.value.mode,
            onSearchMatches: (count: number) => {
              matches.value = count
            },
            onChange: (md: string) => changes.push(md),
          }),
        ])
    },
  })
  const app = createTestApp(App)
  return { app, state, matches, changes, md: () => editor.getMarkdown() }
}

describeNative("markdown-editor footnotes / search / source mode", () => {
  it("renders footnote references inline and definitions as blocks", async () => {
    const { app } = editorApp({ source: "See[^1] here.\n\n[^1]: The note\n" })
    await app.settle()
    const textareas = app.renderer.findByType("textarea")
    expect(textareas.length).toBe(2)
    const runs = app.renderer.getPaintedInputRuns(textareas[0].id)
    const joined = runs.map((run) => run.text).join("")
    expect(joined).toContain("See")
    // The reference renders as one accent-underlined object char.
    const refRun = runs.find((run) => run.underline && run.color !== "#00000000")
    expect(refRun.text).toBe("\uFFFC")
    expect(app.renderer.getPaintedText()).toContain("The note")
    app.unmount()
  })

  it("decorates search matches and reports the count", async () => {
    const { app, state, matches } = editorApp({ source: "hello world\n\nsay hello again\n" })
    await app.settle()
    state.value = { ...state.value, query: "hello" }
    await app.settle()
    expect(matches.value).toBe(2)
    const blocks = app.renderer.findByType("textarea")
    const first = app.renderer.getInputDecorations(blocks[0].id)
    expect(first.length).toBe(1)
    expect(first[0].start).toBe(0)
    expect(first[0].end).toBe(5)
    const second = app.renderer.getInputDecorations(blocks[1].id)
    expect(second.length).toBe(1)
    expect(second[0].start).toBe(4)
    app.unmount()
  })

  it("focuses the active match block and selects it", async () => {
    const { app, state } = editorApp({ source: "hello world\n\nsay hello again\n" })
    await app.settle()
    // A query change alone updates decorations only; it must not move focus
    // (the find box keeps it). Navigation focuses the match.
    state.value = { ...state.value, query: "hello" }
    await app.settle()
    state.value = { ...state.value, active: 1 }
    await app.settle()
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    expect(app.renderer.getFocusedElementId()).toBe(blocks[1].id)
    app.unmount()
  })

  it("clears decorations when the query empties", async () => {
    const { app, state } = editorApp({ source: "hello world\n" })
    await app.settle()
    state.value = { ...state.value, query: "hello" }
    await app.settle()
    state.value = { ...state.value, query: "" }
    await app.settle()
    const block = app.renderer.findByType("textarea")[0]
    expect(app.renderer.getInputDecorations(block.id)).toEqual([])
    app.unmount()
  })

  it("source mode shows one textarea with the full markdown", async () => {
    const { app, state, md } = editorApp({ source: "# Title\n\nbody text\n" })
    await app.settle()
    state.value = { ...state.value, mode: "source" }
    await app.settle()
    const source = app.renderer.findByTestId("md-source")
    expect(source).toBeTruthy()
    expect(app.renderer.findByType("textarea").length).toBe(1)
    app.unmount()
  })

  it("edits in source mode flow back into the blocks", async () => {
    const { app, state, md } = editorApp({ source: "# Title\n" })
    await app.settle()
    state.value = { ...state.value, mode: "source" }
    await app.settle()
    const source = app.renderer.findByTestId("md-source")
    app.renderer.nativeSimulateKeystrokes(source.id, "cmd-end")
    await app.settle()
    // cmd-end lands after the trailing newline; step left onto the heading.
    app.renderer.nativeSimulateKeystrokes(source.id, "left")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(source.id, "space")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(source.id, "t e x t")
    await app.settle()
    state.value = { ...state.value, mode: "wysiwyg" }
    await app.settle()
    expect(md()).toBe("# Title text\n")
    app.unmount()
  })

  it("getMarkdown returns the live source text in source mode", async () => {
    const { app, state, md } = editorApp({ source: "# Title\n" })
    await app.settle()
    state.value = { ...state.value, mode: "source" }
    await app.settle()
    const source = app.renderer.findByTestId("md-source")
    app.renderer.nativeSimulateKeystrokes(source.id, "cmd-end")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(source.id, "left")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(source.id, "space")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(source.id, "x")
    await app.settle()
    // No switch back to wysiwyg: the source buffer is the answer.
    expect(md()).toBe("# Title x\n")
    app.unmount()
  })

  it("source mode fills the visible column with the textarea", async () => {
    const App = defineComponent({
      setup() {
        return () =>
          h("div", { style: { width: 600, height: 500, padding: 8 } }, () => [
            h(MarkdownEditor, { source: "short\n", mode: "source" }),
          ])
      },
    })
    const app = createTestApp(App)
    await app.settle()
    const source = app.renderer.findByTestId("md-source")
    const bounds = app.renderer.getElementBounds(source.id)!
    // The column's visible height is 500 - 2*8 padding = 484. A minRows-only
    // strip would be 4 * 21 = 84.
    expect(bounds.height).toBeGreaterThanOrEqual(480)
    app.unmount()
  })

  it("typing in the find box never steals focus to a search match", async () => {
    const state = ref({ query: "", active: -1 })
    const App = defineComponent({
      setup() {
        return () =>
          h("div", { style: { width: 600 } }, () => [
            h("input", {
              testId: "find-box",
              value: state.value.query,
              onChange: (event: { value?: string | null }) => {
                const query = event.value ?? ""
                state.value = { query, active: query ? 0 : -1 }
              },
            }),
            h(MarkdownEditor, {
              source: "hello world\n\nsay hello again\n",
              searchQuery: state.value.query,
              searchActiveIndex: state.value.active,
            }),
          ])
      },
    })
    const app = createTestApp(App)
    await app.settle()
    const findBox = app.renderer.findByTestId("find-box")
    // The first typed char sets query AND activeIndex=0 — that pair change is
    // a query edit, not navigation, so the match must not take focus.
    app.renderer.nativeSimulateKeystrokes(findBox.id, "h")
    await app.settle()
    await app.settle()
    expect(app.renderer.getFocusedElementId()).toBe(findBox.id)
    app.unmount()
  })

  it("table cells paint text in the theme text color", async () => {
    const { app } = editorApp({ source: "| a | b |\n| :--- | ---: |\n| c | d |\n" })
    await app.settle()
    const cells = app.renderer
      .findByType("textarea")
      .filter((el) => el.testId?.startsWith("md-cell-"))
    expect(cells.length).toBe(4)
    for (const cell of cells) {
      const runs = app.renderer.getPaintedInputRuns(cell.id)
      expect(runs.length).toBeGreaterThan(0)
      for (const run of runs) {
        // The default theme text color — cells painted #000000ff before the fix.
        expect(run.color).toBe("#e8e8e8ff")
      }
    }
    app.unmount()
  })

  it("table cells stay inside the editor width", async () => {
    // The native editor measures a fixed 320px under indefinite width, so a
    // bare flex cell overflows the row; cells get an explicit percentage width.
    const { app } = editorApp({ source: "| a | b |\n| :--- | ---: |\n| c | d |\n\nend\n" })
    await app.settle()
    const cells = app.renderer
      .findByType("textarea")
      .filter((el) => el.testId?.startsWith("md-cell-"))
      .map((el) => app.renderer.getElementBounds(el.id)!)
      .sort((a, b) => a.y - b.y || a.x - b.x)
    expect(cells.length).toBe(4)
    const paragraph = app.renderer
      .findByType("textarea")
      .filter((el) => !el.testId?.startsWith("md-cell-"))
      .map((el) => app.renderer.getElementBounds(el.id)!)
      .at(-1)!
    for (const cell of cells) {
      expect(cell.x + cell.width).toBeLessThanOrEqual(paragraph.x + paragraph.width + 0.5)
    }
    // Header row: left cell abuts the right cell without a gap or overlap.
    expect(cells[1].x - (cells[0].x + cells[0].width)).toBeLessThanOrEqual(12)
    app.unmount()
  })

  it("replacing the source prop resets the document", async () => {
    const source = ref("# A\n")
    let editor: any = null
    const App = defineComponent({
      setup() {
        return () =>
          h(MarkdownEditor, {
            ref: (el: any) => {
              editor = el
            },
            source: source.value,
          })
      },
    })
    const app = createTestApp(App)
    await app.settle()
    expect(editor.getMarkdown()).toBe("# A\n")
    const block = app.renderer.findByType("textarea")[0]
    app.renderer.nativeSimulateKeystrokes(block.id, "end")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(block.id, "!")
    await app.settle()
    expect(editor.getMarkdown()).toBe("# A!\n")
    source.value = "# B\n\nnew para\n"
    await app.settle()
    expect(editor.getMarkdown()).toBe("# B\n\nnew para\n")
    const blocks = app.renderer.findByType("textarea")
    expect(blocks.length).toBe(2)
    // Typing lands in the new document, not in stale per-key state.
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "home")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "x")
    await app.settle()
    expect(editor.getMarkdown()).toBe("# B\n\nxnew para\n")
    app.unmount()
  })
})

describeNative("markdown-editor cross-block selection / clipboard / anchors", () => {
  function selApp(source: string) {
    let editor: any = null
    const App = defineComponent({
      setup() {
        return () =>
          h(MarkdownEditor, {
            ref: (el: any) => {
              editor = el
            },
            source,
          })
      },
    })
    const app = createTestApp(App)
    return { app, editor }
  }

  it("shift-click extends the selection across blocks and decorates them", async () => {
    const { app, editor } = selApp("first block\n\nsecond block\n")
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    // Caret at the start of block 1...
    app.renderer.focusElement(blocks[0].id)
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(blocks[0].id, "home")
    await app.settle()
    // ...then shift-click block 2.
    const bounds = app.renderer.getElementBounds(blocks[1].id)!
    app.renderer.nativeSimulateMouseDown(bounds.x + bounds.width - 20, bounds.y + 8, 0, "shift")
    app.renderer.nativeSimulateMouseUp(bounds.x + bounds.width - 20, bounds.y + 8, 0, "shift")
    await app.settle()
    await app.settle()
    const first = app.renderer.getInputDecorations(blocks[0].id)
    expect(first.length).toBeGreaterThanOrEqual(1)
    expect(first[0].start).toBe(0)
    const second = app.renderer.getInputDecorations(blocks[1].id)
    expect(second.length).toBeGreaterThanOrEqual(1)
    app.unmount()
  })

  it("cmd-c serializes a cross-block selection as markdown", async () => {
    const { app } = selApp("first block\n\nsecond *block*\n")
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    app.renderer.focusElement(blocks[0].id)
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(blocks[0].id, "home")
    await app.settle()
    const bounds = app.renderer.getElementBounds(blocks[1].id)!
    app.renderer.nativeSimulateMouseDown(bounds.x + bounds.width - 20, bounds.y + 8, 0, "shift")
    app.renderer.nativeSimulateMouseUp(bounds.x + bounds.width - 20, bounds.y + 8, 0, "shift")
    await app.settle()
    await app.settle()
    app.renderer.writeClipboardText("")
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "cmd-c")
    await app.settle()
    const copied = app.renderer.readClipboardText()
    expect(copied).toContain("first block")
    expect(copied).toContain("second *block*")
    app.unmount()
  })

  it("pasting multi-block markdown inserts parsed blocks", async () => {
    const { app, editor } = selApp("anchor\n")
    await app.settle()
    const block = app.renderer.findByTestId("md-b0")
    app.renderer.focusElement(block.id)
    await app.settle()
    app.renderer.writeClipboardText("# Head\n\npasted para\n")
    app.renderer.nativeSimulateKeystrokes(block.id, "cmd-end")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(block.id, "cmd-v")
    await app.settle()
    expect(editor.getMarkdown()).toBe("anchor\n\n# Head\n\npasted para\n")
    app.unmount()
  })

  it("jumpToHeading focuses the heading and flashes it", async () => {
    const { app, editor } = selApp("intro\n\n# Target\n\ntail\n")
    await app.settle()
    expect(editor.jumpToHeading("Target")).toBe(true)
    await app.settle()
    const heading = app.renderer.findByTestId("md-b7")
    expect(app.renderer.getFocusedElementId()).toBe(heading.id)
    expect(app.renderer.findByTestId("md-flash")).toBeTruthy()
    expect(editor.jumpToHeading("missing")).toBe(false)
    app.unmount()
  })

  it("cmd-x serializes and deletes a cross-block selection", async () => {
    const { app, editor } = selApp("first block\n\nsecond *block*\n")
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    app.renderer.focusElement(blocks[0].id)
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(blocks[0].id, "home")
    await app.settle()
    // Shift-click exactly at offset 4 of the second block (native hit-test).
    const [x, y] = app.renderer.getInputTextPosition(blocks[1].id, 4)
    app.renderer.nativeSimulateMouseDown(x, y, 0, "shift")
    app.renderer.nativeSimulateMouseUp(x, y, 0, "shift")
    await app.settle()
    app.renderer.writeClipboardText("")
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "cmd-x")
    await app.settle()
    const copied = app.renderer.readClipboardText()
    expect(copied).toContain("first block")
    expect(copied).toContain("seco")
    expect(editor.getMarkdown()).toBe("nd *block*\n")
    app.unmount()
  })

  it("an edit clears the cross-block selection decorations", async () => {
    const { app } = selApp("first block\n\nsecond block\n")
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    app.renderer.focusElement(blocks[0].id)
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(blocks[0].id, "home")
    await app.settle()
    const bounds = app.renderer.getElementBounds(blocks[1].id)!
    app.renderer.nativeSimulateMouseDown(bounds.x + bounds.width - 20, bounds.y + 8, 0, "shift")
    app.renderer.nativeSimulateMouseUp(bounds.x + bounds.width - 20, bounds.y + 8, 0, "shift")
    await app.settle()
    expect(app.renderer.getInputDecorations(blocks[0].id).length).toBeGreaterThanOrEqual(1)
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "z")
    await app.settle()
    expect(app.renderer.getInputDecorations(blocks[0].id)).toEqual([])
    expect(app.renderer.getInputDecorations(blocks[1].id)).toEqual([])
    app.unmount()
  })

  it("pasting single-newline markdown inserts it as structure", async () => {
    const { app, editor } = selApp("anchor\n")
    await app.settle()
    const block = app.renderer.findByTestId("md-b0")
    app.renderer.nativeSimulateKeystrokes(block.id, "end")
    await app.settle()
    app.renderer.writeClipboardText("- a\n- b")
    app.renderer.nativeSimulateKeystrokes(block.id, "cmd-v")
    await app.settle()
    expect(editor.getMarkdown()).toBe("anchor\n\n- a\n- b\n")
    app.unmount()
  })

  it("pasting markdown into a code block stays literal", async () => {
    const { app, editor } = selApp("```js\nline\n```\n")
    await app.settle()
    const block = app.renderer.findByTestId("md-b0")
    app.renderer.nativeSimulateKeystrokes(block.id, "end")
    await app.settle()
    app.renderer.writeClipboardText("# H\n\npara")
    app.renderer.nativeSimulateKeystrokes(block.id, "cmd-v")
    await app.settle()
    expect(editor.getMarkdown()).toBe("```js\nline# H\n\npara\n```\n")
    // The caret sits right after the pasted text.
    app.renderer.nativeSimulateKeystrokes(block.id, "!")
    await app.settle()
    expect(editor.getMarkdown()).toBe("```js\nline# H\n\npara!\n```\n")
    app.unmount()
  })

  it("restores the caret after a plain paste", async () => {
    const { app, editor } = selApp("hello\n")
    await app.settle()
    const block = app.renderer.findByTestId("md-b0")
    app.renderer.nativeSimulateKeystrokes(block.id, "home")
    await app.settle()
    app.renderer.writeClipboardText("say ")
    app.renderer.nativeSimulateKeystrokes(block.id, "cmd-v")
    await app.settle()
    expect(editor.getMarkdown()).toBe("say hello\n")
    // Without the selection push the resync would have teleported the caret
    // to the block end.
    app.renderer.nativeSimulateKeystrokes(block.id, "x")
    await app.settle()
    expect(editor.getMarkdown()).toBe("say xhello\n")
    app.unmount()
  })

  it("typing in another block does not steal focus back to the search match", async () => {
    const { app, state, md } = editorApp({ source: "hello\n\nworld\n" })
    await app.settle()
    // Query first (no focus move), then navigate to the match.
    state.value = { ...state.value, query: "hello" }
    await app.settle()
    state.value = { ...state.value, active: 0 }
    await app.settle()
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    // The active match took focus and selection...
    expect(app.renderer.getFocusedElementId()).toBe(blocks[0].id)
    // ...but editing another block must not pull focus back to the match.
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "home")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "x")
    await app.settle()
    // Untargeted keystrokes go to whatever holds focus right now.
    app.renderer.simulateKeystrokes("y")
    await app.settle()
    expect(app.renderer.getFocusedElementId()).toBe(blocks[1].id)
    expect(md()).toBe("hello\n\nxyworld\n")
    app.unmount()
  })

  it("cmd-a selects every block and cmd-c copies the whole document", async () => {
    const { app } = selApp("first block\n\nsecond *block*\n")
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    expect(blocks.length).toBe(2)
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "cmd-a")
    await app.settle()
    await app.settle()
    // The doc-wide selection decorates every block.
    for (const block of blocks) {
      expect(app.renderer.getInputDecorations(block.id).length).toBeGreaterThanOrEqual(1)
    }
    app.renderer.writeClipboardText("")
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "cmd-c")
    await app.settle()
    expect(app.renderer.readClipboardText()).toBe("first block\n\nsecond *block*\n")
    app.unmount()
  })

  it("cmd-a in a single-block document selects the block in place", async () => {
    let editor: any = null
    const App = defineComponent({
      setup() {
        return () =>
          h(MarkdownEditor, {
            ref: (el: any) => {
              editor = el
            },
            source: "hello\n",
          })
      },
    })
    const app = createTestApp(App)
    await app.settle()
    const block = app.renderer.findByTestId("md-b0")
    app.renderer.nativeSimulateKeystrokes(block.id, "cmd-a")
    await app.settle()
    await app.settle()
    // The selection prop selected the whole block: typing replaces it.
    app.renderer.nativeSimulateKeystrokes(block.id, "x")
    await app.settle()
    expect(editor.getMarkdown()).toBe("x\n")
    app.unmount()
  })

  it("right-click opens the context menu and the backdrop closes it", async () => {
    const { app } = selApp("hello\n\nworld\n")
    await app.settle()
    const block = app.renderer.findByTestId("md-b0")
    const bounds = app.renderer.getElementBounds(block.id)!
    app.renderer.nativeSimulateMouseDown(bounds.x + 10, bounds.y + 8, 2)
    app.renderer.nativeSimulateMouseUp(bounds.x + 10, bounds.y + 8, 2)
    await app.settle()
    expect(app.renderer.findByTestId("md-menu")).toBeTruthy()
    const backdrop = app.renderer.findByTestId("md-menu-backdrop")!
    const bd = app.renderer.getElementBounds(backdrop.id)!
    app.renderer.nativeSimulateMouseDown(bd.x + 1, bd.y + 1, 0)
    app.renderer.nativeSimulateMouseUp(bd.x + 1, bd.y + 1, 0)
    await app.settle()
    expect(app.renderer.findByTestId("md-menu")).toBeUndefined()
    app.unmount()
  })

  it("context menu Copy writes a cross-block selection as markdown", async () => {
    const { app } = selApp("first block\n\nsecond *block*\n")
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    app.renderer.focusElement(blocks[0].id)
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(blocks[0].id, "home")
    await app.settle()
    // Shift-click offset 4 of the second block: a docSelection exists.
    const [x, y] = app.renderer.getInputTextPosition(blocks[1].id, 4)
    app.renderer.nativeSimulateMouseDown(x, y, 0, "shift")
    app.renderer.nativeSimulateMouseUp(x, y, 0, "shift")
    await app.settle()
    // Right-click inside the selection must keep it for the menu.
    app.renderer.nativeSimulateMouseDown(x, y, 2)
    app.renderer.nativeSimulateMouseUp(x, y, 2)
    await app.settle()
    const copy = app.renderer.findByTestId("md-menu-copy")!
    const cb = app.renderer.getElementBounds(copy.id)!
    app.renderer.writeClipboardText("")
    app.renderer.nativeSimulateMouseDown(cb.x + 4, cb.y + 4, 0)
    app.renderer.nativeSimulateMouseUp(cb.x + 4, cb.y + 4, 0)
    await app.settle()
    const copied = app.renderer.readClipboardText()
    expect(copied).toContain("first block")
    expect(copied).toContain("seco")
    // The menu closed after the action.
    expect(app.renderer.findByTestId("md-menu")).toBeUndefined()
    app.unmount()
  })

  it("context menu Select All selects every block", async () => {
    const { app } = selApp("first block\n\nsecond block\n")
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    const bounds = app.renderer.getElementBounds(blocks[0].id)!
    app.renderer.nativeSimulateMouseDown(bounds.x + 10, bounds.y + 8, 2)
    app.renderer.nativeSimulateMouseUp(bounds.x + 10, bounds.y + 8, 2)
    await app.settle()
    const item = app.renderer.findByTestId("md-menu-select-all")!
    const ib = app.renderer.getElementBounds(item.id)!
    app.renderer.nativeSimulateMouseDown(ib.x + 4, ib.y + 4, 0)
    app.renderer.nativeSimulateMouseUp(ib.x + 4, ib.y + 4, 0)
    await app.settle()
    await app.settle()
    for (const block of blocks) {
      expect(app.renderer.getInputDecorations(block.id).length).toBeGreaterThanOrEqual(1)
    }
    app.unmount()
  })

  it("source mode Select All from the menu selects the whole buffer", async () => {
    const { app, md } = editorApp({ source: "hello world\n", mode: "source" })
    await app.settle()
    const source = app.renderer.findByTestId("md-source")
    const bounds = app.renderer.getElementBounds(source.id)!
    app.renderer.nativeSimulateMouseDown(bounds.x + 10, bounds.y + 8, 2)
    app.renderer.nativeSimulateMouseUp(bounds.x + 10, bounds.y + 8, 2)
    await app.settle()
    const item = app.renderer.findByTestId("md-menu-select-all")!
    const ib = app.renderer.getElementBounds(item.id)!
    app.renderer.nativeSimulateMouseDown(ib.x + 4, ib.y + 4, 0)
    app.renderer.nativeSimulateMouseUp(ib.x + 4, ib.y + 4, 0)
    await app.settle()
    await app.settle()
    // The selection prop [0, len] applied: typing replaces the buffer.
    app.renderer.nativeSimulateKeystrokes(source.id, "x")
    await app.settle()
    expect(md()).toBe("x")
    app.unmount()
  })
})
