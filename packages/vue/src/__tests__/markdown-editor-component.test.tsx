/** M3 `<markdown-editor>` component: block rendering from the PM doc,
 *  typing through editBlock (input rules fire), Enter splits blocks, task
 *  checkboxes toggle, and format shortcuts apply marks to the native
 *  selection. docs/markdown-editor-plan.md M3.1–M3.3. */

// @ts-nocheck

import { defineComponent, h, ref } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { MarkdownEditor } from "../markdown-editor/component.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

function editorApp(source: string) {
  const changes: string[] = []
  let editor: any = null
  const App = defineComponent({
    setup() {
      return () =>
        h(MarkdownEditor, {
          ref: (el: any) => {
            editor = el
          },
          source,
          onChange: (md: string) => changes.push(md),
        })
    },
  })
  const app = createTestApp(App)
  return { app, changes, md: () => editor.getMarkdown() }
}

describeNative("markdown-editor component", () => {
  it("renders blocks with inline styles from the PM doc", async () => {
    const { app } = editorApp("# Title\n\nplain *bold* and `code` text\n")
    await app.settle()
    const textareas = app.renderer.findByType("textarea")
    expect(textareas.length).toBe(2)
    const heading = app.renderer.getPaintedInputRuns(textareas[0].id)
    expect(heading.map((run) => run.text).join("")).toBe("Title")
    const para = app.renderer.getPaintedInputRuns(textareas[1].id)
    expect(para.map((run) => run.text).join("")).toBe("plain bold and code text")
    const emRun = para.find((run) => run.italic)
    expect(emRun.text).toBe("bold")
    const codeRun = para.find((run) => run.background && run.text === "code")
    expect(codeRun).toBeTruthy()
    app.unmount()
  })

  it("renders markers, task checkboxes and quotes", async () => {
    const { app } = editorApp("- plain\n- [x] done\n\n1. first\n\n> quoted\n")
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(expect.arrayContaining(["•", "1."]))
    expect(app.renderer.getPaintedText()).toContain("quoted")
    // Second list item (the task) starts at doc position 10.
    expect(app.renderer.findByTestId("md-check-10")).toBeTruthy()
    expect(app.renderer.getPaintedText()).toContain("done")
    app.unmount()
  })

  it("types into a block, fires input rules and serializes markdown", async () => {
    const { app, md } = editorApp("")
    await app.settle()
    const block = app.renderer.findByTestId("md-b0")
    app.renderer.focusElement(block.id)
    app.renderer.nativeSimulateKeystrokes(block.id, "# space")
    await app.settle()
    expect(md()).toBe("# \n")
    app.renderer.nativeSimulateKeystrokes(block.id, "H i")
    await app.settle()
    expect(md()).toBe("# Hi\n")
    app.unmount()
  })

  it("Enter splits the block and moves typing to the new one", async () => {
    const { app, md } = editorApp("")
    await app.settle()
    const block = app.renderer.findByTestId("md-b0")
    app.renderer.focusElement(block.id)
    app.renderer.nativeSimulateKeystrokes(block.id, "h e l l o")
    await app.settle()
    expect(md()).toBe("hello\n")
    app.renderer.nativeSimulateKeystrokes(block.id, "enter")
    await app.settle()
    expect(md()).toBe("hello\n\n")
    const blocks = app.renderer.findByType("textarea")
    expect(blocks.length).toBe(2)
    // Focus moved to the new empty block; typing lands there.
    const second = app.renderer.findByTestId("md-b7")
    expect(app.renderer.getFocusedElementId()).toBe(second.id)
    app.renderer.nativeSimulateKeystrokes(second.id, "w o r l d")
    await app.settle()
    expect(md()).toBe("hello\n\nworld\n")
    app.unmount()
  })

  it("clicking a task checkbox flips its markdown state", async () => {
    const { app, md } = editorApp("- [x] done\n- [ ] todo\n")
    await app.settle()
    expect(md()).toBe("- [x] done\n- [ ] todo\n")
    // First list_item sits at doc position 1.
    const check = app.renderer.findByTestId("md-check-1")
    const bounds = app.renderer.getElementBounds(check.id)!
    app.renderer.nativeSimulateMouseDown(bounds.x + 8, bounds.y + 8, 0)
    app.renderer.nativeSimulateMouseUp(bounds.x + 8, bounds.y + 8, 0)
    await app.settle()
    expect(md()).toBe("- [ ] done\n- [ ] todo\n")
    app.unmount()
  })

  it("cmd-b bolds the block selection", async () => {
    const { app, md } = editorApp("")
    await app.settle()
    const block = app.renderer.findByTestId("md-b0")
    app.renderer.focusElement(block.id)
    app.renderer.nativeSimulateKeystrokes(block.id, "b o l d")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(block.id, "cmd-a")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(block.id, "cmd-b")
    await app.settle()
    expect(md()).toBe("**bold**\n")
    app.unmount()
  })

  it("cmd-shift-8 wraps the block in a bullet list", async () => {
    const { app, md } = editorApp("")
    await app.settle()
    const block = app.renderer.findByTestId("md-b0")
    app.renderer.focusElement(block.id)
    app.renderer.nativeSimulateKeystrokes(block.id, "a")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(block.id, "cmd-shift-8")
    await app.settle()
    expect(md()).toBe("- a\n")
    app.renderer.nativeSimulateKeystrokes(block.id, "cmd-shift-8")
    await app.settle()
    expect(md()).toBe("a\n")
    app.unmount()
  })

  it("shift-enter inserts a hard break inside the paragraph", async () => {
    const { app, md } = editorApp("")
    await app.settle()
    const block = app.renderer.findByTestId("md-b0")
    app.renderer.focusElement(block.id)
    app.renderer.nativeSimulateKeystrokes(block.id, "a")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(block.id, "shift-enter")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(block.id, "b")
    await app.settle()
    expect(md()).toBe("a\nb\n")
    app.unmount()
  })

  it("edits an existing styled document without losing other marks", async () => {
    const { app, md } = editorApp("# T\n\n*keep* plain\n")
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    app.renderer.focusElement(blocks[1].id)
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "home")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "x")
    await app.settle()
    // Typing at the very start of the paragraph must not touch *keep*.
    expect(md()).toBe("# T\n\nx*keep* plain\n")
    app.unmount()
  })

  it("IME composition works inside a block", async () => {
    const { app, md } = editorApp("")
    await app.settle()
    const block = app.renderer.findByTestId("md-b0")
    app.renderer.focusElement(block.id)
    app.renderer.simulateMarkedText(block.id, "ni")
    await app.settle()
    app.renderer.simulateImeCommit(block.id, "你好")
    await app.settle()
    expect(md()).toBe("你好\n")
    app.unmount()
  })

  it("wrap/unwrap keep block keys unique and Enter focuses the fresh block", async () => {
    const { app, md } = editorApp("a\n")
    await app.settle()
    const block = app.renderer.findByTestId("md-b0")
    app.renderer.nativeSimulateKeystrokes(block.id, "cmd-shift-8")
    await app.settle()
    expect(md()).toBe("- a\n")
    app.renderer.nativeSimulateKeystrokes(block.id, "cmd-shift-8")
    await app.settle()
    expect(md()).toBe("a\n")
    app.renderer.nativeSimulateKeystrokes(block.id, "end")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(block.id, "enter")
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    expect(blocks.length).toBe(2)
    // The stale position→key entry from the wrap must not hand both blocks
    // the same key.
    expect(new Set(blocks.map((b) => b.testId)).size).toBe(2)
    expect(app.renderer.getFocusedElementId()).toBe(blocks[1].id)
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "b")
    await app.settle()
    expect(md()).toBe("a\n\nb\n")
    expect(
      app.renderer.getPaintedInputRuns(blocks[0].id).map((run) => run.text).join(""),
    ).toBe("a")
    app.unmount()
  })

  it("Enter at the end of a block with a following block focuses the new block", async () => {
    const { app, md } = editorApp("hello\n\nworld\n")
    await app.settle()
    const first = app.renderer.findByTestId("md-b0")
    app.renderer.nativeSimulateKeystrokes(first.id, "end")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(first.id, "enter")
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    expect(blocks.length).toBe(3)
    // The new block at the old "world" position must not inherit its key.
    expect(new Set(blocks.map((b) => b.testId)).size).toBe(3)
    expect(app.renderer.getFocusedElementId()).toBe(blocks[1].id)
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "x")
    await app.settle()
    expect(md()).toBe("hello\n\nx\n\nworld\n")
    expect(
      app.renderer.getPaintedInputRuns(blocks[2].id).map((run) => run.text).join(""),
    ).toBe("world")
    app.unmount()
  })

  it("cmd-shift-9 turns a plain list item into a task", async () => {
    const { app, md } = editorApp("- a\n")
    await app.settle()
    const item = app.renderer.findByTestId("md-b2")
    app.renderer.nativeSimulateKeystrokes(item.id, "cmd-shift-9")
    await app.settle()
    expect(md()).toBe("- [x] a\n")
    app.unmount()
  })

  it("renders an inline image as a one-char placeholder that survives edits", async () => {
    const { app, md } = editorApp("a ![x](y) b\n")
    await app.settle()
    const block = app.renderer.findByType("textarea")[0]
    expect(
      app.renderer.getPaintedInputRuns(block.id).map((run) => run.text).join(""),
    ).toBe("a \uFFFC b")
    app.renderer.nativeSimulateKeystrokes(block.id, "end")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(block.id, "!")
    await app.settle()
    expect(md()).toBe("a ![x](y) b!\n")
    app.unmount()
  })

  it("cmd-z / cmd-shift-z undo and redo through the PM history", async () => {
    const { app, md } = editorApp("hello\n\nworld\n")
    await app.settle()
    const blocks = app.renderer.findByType("textarea")
    // Bold the second block: a mark-only command the native per-element undo
    // stack (which only tracks text edits) could never revert or redo.
    // (cmd-a is document-wide now, so select the word natively instead.)
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "home")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "shift-end")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "cmd-b")
    await app.settle()
    expect(md()).toBe("hello\n\n**world**\n")
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "cmd-z")
    await app.settle()
    expect(md()).toBe("hello\n\nworld\n")
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "cmd-shift-z")
    await app.settle()
    expect(md()).toBe("hello\n\n**world**\n")
    app.unmount()
  })

  it("backspace at a block start joins the blocks and keeps the caret at the join", async () => {
    const { app, md } = editorApp("hello\n\nworld\n")
    await app.settle()
    const world = app.renderer.findByTestId("md-b7")
    app.renderer.nativeSimulateKeystrokes(world.id, "home")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(world.id, "backspace")
    await app.settle()
    expect(md()).toBe("helloworld\n")
    const merged = app.renderer.findByType("textarea")[0]
    expect(app.renderer.getFocusedElementId()).toBe(merged.id)
    // The caret sits at the join point, not at the block end.
    app.renderer.nativeSimulateKeystrokes(merged.id, "x")
    await app.settle()
    expect(md()).toBe("helloxworld\n")
    app.unmount()
  })

  it("backspace at a block start deletes a preceding hr", async () => {
    const { app, md } = editorApp("hello\n\n---\n\nworld\n")
    await app.settle()
    const world = app.renderer.findByTestId("md-b8")
    app.renderer.nativeSimulateKeystrokes(world.id, "home")
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(world.id, "backspace")
    await app.settle()
    expect(md()).toBe("hello\n\nworld\n")
    const blocks = app.renderer.findByType("textarea")
    expect(app.renderer.getFocusedElementId()).toBe(blocks[1].id)
    app.renderer.nativeSimulateKeystrokes(blocks[1].id, "x")
    await app.settle()
    expect(md()).toBe("hello\n\nxworld\n")
    app.unmount()
  })

  it("cmd-x cuts the block's selected text through the model", async () => {
    const { app, md } = editorApp("hello\n")
    await app.settle()
    const block = app.renderer.findByTestId("md-b0")
    app.renderer.nativeSimulateKeystrokes(block.id, "cmd-a")
    await app.settle()
    app.renderer.writeClipboardText("")
    app.renderer.nativeSimulateKeystrokes(block.id, "cmd-x")
    await app.settle()
    expect(app.renderer.readClipboardText()).toBe("hello")
    expect(md()).not.toContain("hello")
    // Caret at offset 0: typing lands at the start of the emptied block.
    app.renderer.nativeSimulateKeystrokes(block.id, "y")
    await app.settle()
    expect(md()).toBe("y\n")
    app.unmount()
  })
})
