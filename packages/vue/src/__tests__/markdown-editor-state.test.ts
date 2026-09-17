import { Selection } from "prosemirror-state"
import { describe, expect, it } from "vitest"
import { editorSchema } from "../markdown-editor/model.js"
import { MarkdownEditorCore } from "../markdown-editor/state.js"

const core = (md: string) => new MarkdownEditorCore(md)

describe("editor core: state + serialization", () => {
  it("round-trips the source through getMarkdown", () => {
    expect(core("- a\n- b").getMarkdown()).toBe("- a\n- b\n")
  })

  it("captures the marker style at construction and keeps it on edits", () => {
    const c = core("* a")
    c.setSelection(4)
    c.insertText("!")
    expect(c.getMarkdown()).toBe("* a!\n")
  })

  it("starts with an empty paragraph for empty input", () => {
    const c = core("")
    expect(c.state.doc.child(0).type.name).toBe("paragraph")
  })
})

describe("editor core: insertText", () => {
  it("inserts at the cursor and replaces selections", () => {
    const c = core("hello")
    c.setSelection(6)
    c.insertText("!")
    expect(c.getMarkdown()).toBe("hello!\n")
    c.setSelection(1, 3)
    c.insertText("J")
    expect(c.getMarkdown()).toBe("Jllo!\n")
  })
})

describe("editor core: input rules", () => {
  const type = (md: string, text: string, pos?: number) => {
    const c = core(md)
    c.setSelection(pos ?? Selection.atEnd(c.state.doc).anchor)
    c.insertText(text)
    return c
  }

  it("# converts to heading levels 1-6, 7 stays text", () => {
    expect(type("", "# ").state.doc.child(0).type.name).toBe("heading")
    expect(type("", "# ").state.doc.child(0).attrs.level).toBe(1)
    expect(type("", "## ").state.doc.child(0).attrs.level).toBe(2)
    expect(type("", "###### ").state.doc.child(0).attrs.level).toBe(6)
    expect(type("", "####### ").state.doc.child(0).type.name).toBe("paragraph")
  })

  it("- / * / + convert to bullet lists", () => {
    for (const marker of ["-", "*", "+"]) {
      const doc = type("", marker + " ").state.doc
      expect(doc.child(0).type.name).toBe("bullet_list")
    }
  })

  it("1. converts to ordered list keeping the start number", () => {
    const c1 = type("", "1. ")
    expect(c1.state.doc.child(0).type.name).toBe("ordered_list")
    expect(c1.state.doc.child(0).attrs.order).toBe(1)
    const c3 = type("", "3. ")
    expect(c3.state.doc.child(0).attrs.order).toBe(3)
  })

  it("> converts to blockquote", () => {
    expect(type("", "> ").state.doc.child(0).type.name).toBe("blockquote")
  })

  it("``` converts to code block", () => {
    const block = type("", "```").state.doc.child(0)
    expect(block.type.name).toBe("code_block")
    expect(block.attrs.info).toBe("")
  })

  it("==word== wraps the word in a highlight mark", () => {
    const c = type("foo ==bar", "==")
    expect(c.getMarkdown()).toBe("foo ==bar==\n")
  })

  it("[x]  / []  at a list item start flip it into a task", () => {
    // doc: bullet_list(0) > list_item(1) > paragraph(2) > "abc" (3..6)
    const cx = core("- abc")
    cx.setSelection(3)
    cx.insertText("[x] ")
    expect(cx.getMarkdown()).toBe("- [x] abc\n")
    const co = core("- abc")
    co.setSelection(3)
    co.insertText("[ ] ")
    expect(co.getMarkdown()).toBe("- [ ] abc\n")
  })
})

describe("editor core: format commands", () => {
  const marked = (md: string, from: number, to: number, fn: (c: MarkdownEditorCore) => void) => {
    const c = core(md)
    c.setSelection(from, to)
    fn(c)
    return c.getMarkdown()
  }

  it("toggles strong over a range", () => {
    expect(marked("hello world", 1, 6, (c) => c.toggleMark("strong"))).toBe("**hello** world\n")
    expect(marked("**hello** world", 1, 8, (c) => c.toggleMark("strong"))).toBe("hello world\n")
  })

  it("toggles em, code, strikethrough, highlight", () => {
    expect(marked("x", 1, 2, (c) => c.toggleMark("em"))).toBe("*x*\n")
    expect(marked("x", 1, 2, (c) => c.toggleMark("code"))).toBe("`x`\n")
    expect(marked("x", 1, 2, (c) => c.toggleMark("strikethrough"))).toBe("~~x~~\n")
    expect(marked("x", 1, 2, (c) => c.toggleMark("highlight"))).toBe("==x==\n")
  })

  it("stores the mark for the next typed text on empty selection", () => {
    const c = core("")
    c.setSelection(1)
    c.toggleMark("strong")
    c.insertText("b")
    expect(c.getMarkdown()).toBe("**b**\n")
  })

  it("toggles links with href", () => {
    expect(marked("see gpuiv now", 5, 10, (c) => c.toggleLink("https://gpuiv.dev"))).toBe(
      "see [gpuiv](https://gpuiv.dev) now\n",
    )
    expect(
      marked("see [gpuiv](https://gpuiv.dev) now", 5, 10, (c) => c.toggleLink("https://gpuiv.dev")),
    ).toBe("see gpuiv now\n")
  })
})

describe("editor core: list commands", () => {
  it("wraps the current block in a bullet list and unwraps it again", () => {
    const c = core("a")
    c.setSelection(2)
    c.toggleList("bullet")
    expect(c.getMarkdown()).toBe("- a\n")
    c.toggleList("bullet")
    expect(c.getMarkdown()).toBe("a\n")
  })

  it("wraps in an ordered list", () => {
    const c = core("a")
    c.setSelection(2)
    c.toggleList("ordered")
    expect(c.getMarkdown()).toBe("1. a\n")
  })
})

describe("editor core: task command", () => {
  it("flips checked state on a task item", () => {
    const c = core("- [ ] a")
    c.setSelection(4)
    c.toggleTaskItem()
    expect(c.getMarkdown()).toBe("- [x] a\n")
    c.toggleTaskItem()
    expect(c.getMarkdown()).toBe("- [ ] a\n")
  })

  it("converts a plain item into a checked task", () => {
    const c = core("- a")
    c.setSelection(2)
    c.toggleTaskItem()
    expect(c.getMarkdown()).toBe("- [x] a\n")
  })
})

describe("editor core: undo/redo", () => {
  it("undoes and redoes an edit", () => {
    const c = core("hello")
    c.setSelection(6)
    c.insertText("!")
    expect(c.getMarkdown()).toBe("hello!\n")
    c.undo()
    expect(c.getMarkdown()).toBe("hello\n")
    c.redo()
    expect(c.getMarkdown()).toBe("hello!\n")
  })

  it("records history entries for edits", () => {
    const c = core("hello")
    c.setSelection(6)
    c.insertText("!")
    c.insertText("?")
    expect(c.undoDepth()).toBeGreaterThanOrEqual(1)
  })

  it("reset/setMarkdown replaces content without polluting the undo stack", () => {
    const c = core("hello")
    c.setSelection(6)
    c.insertText("!")
    c.reset("world")
    expect(c.getMarkdown()).toBe("world\n")
    expect(c.undoDepth()).toBe(0)
    c.undo()
    expect(c.getMarkdown()).toBe("world\n")
    expect(c.state.doc.child(0).textContent).toBe("world")
  })

  it("dispatched transactions stay schema-valid", () => {
    const c = core("# Title\n\n- a\n  - b\n")
    expect(c.state.doc.nodeSize).toBeGreaterThan(0)
    expect(() => editorSchema.topNodeType.createAndFill(null, c.state.doc.content)).not.toThrow()
  })
})
