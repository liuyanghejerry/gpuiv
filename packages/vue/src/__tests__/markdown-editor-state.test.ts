import { Selection } from "prosemirror-state"
import { describe, expect, it } from "vitest"
import { editorSchema, parseMarkdown } from "../markdown-editor/model.js"
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

  it("applies a link across mixed linked and unlinked text", () => {
    const c = core("[one](https://gpuiv.dev) two")
    c.setSelection(1, 8)
    c.toggleLink("https://gpuiv.dev")
    expect(c.getMarkdown()).toBe("[one two](https://gpuiv.dev)\n")
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

  it("converts the current list instead of nesting another list", () => {
    const c = core("- one\n- two")
    c.setSelection(3)
    c.toggleList("ordered")
    expect(c.getMarkdown()).toBe("1. one\n2. two\n")
    expect(c.state.doc.child(0).type.name).toBe("ordered_list")
    expect(c.state.doc.child(0).childCount).toBe(2)

    c.toggleList("bullet")
    expect(c.getMarkdown()).toBe("- one\n- two\n")
    expect(c.state.doc.child(0).type.name).toBe("bullet_list")
    c.state.doc.check()
  })

  it("wraps each selected paragraph in its own list item", () => {
    const c = core("a\n\nb")
    c.setSelection(1, 5)
    c.toggleList("bullet")
    expect(c.getMarkdown()).toBe("- a\n- b\n")
    const list = c.state.doc.child(0)
    expect(list.type.name).toBe("bullet_list")
    expect(list.childCount).toBe(2)
    c.state.doc.check()
  })

  it("wraps multiple paragraphs into a numbered ordered list", () => {
    const c = core("a\n\nb")
    c.setSelection(1, 5)
    c.toggleList("ordered")
    expect(c.getMarkdown()).toBe("1. a\n2. b\n")
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
    c.setSelection(3)
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

describe("editor core: getMarkerStyle", () => {
  it("exposes the marker style detected at construction", () => {
    expect(core("* a\n_b_").getMarkerStyle()).toEqual({
      bullet: "*",
      emphasis: "_",
      strong: "**",
      fence: "```",
    })
    expect(core("plain").getMarkerStyle()).toEqual({
      bullet: "-",
      emphasis: "*",
      strong: "**",
      fence: "```",
    })
  })
})

describe("editor core: splitBlockAt", () => {
  it("splits a paragraph and returns the new block's position", () => {
    const c = core("abcd")
    const pos = c.splitBlockAt(0, 2)
    expect(pos).not.toBeNull()
    expect(c.getMarkdown()).toBe("ab\n\ncd\n")
    const node = c.state.doc.nodeAt(pos!)
    expect(node?.type.name).toBe("paragraph")
    expect(node?.textContent).toBe("cd")
    c.state.doc.check()
  })

  it("returns the new item's textblock when splitting inside a list item", () => {
    const c = core("- abcd")
    // bullet_list(0) > list_item(1) > paragraph(2) > "abcd"
    const pos = c.splitBlockAt(2, 2)
    expect(pos).not.toBeNull()
    expect(c.getMarkdown()).toBe("- ab\n- cd\n")
    const node = c.state.doc.nodeAt(pos!)
    expect(node?.type.name).toBe("paragraph")
    expect(node?.textContent).toBe("cd")
    const $r = c.state.doc.resolve(pos! + 1)
    expect($r.parent.type.name).toBe("paragraph")
    let inItem = false
    for (let d = 1; d <= $r.depth; d++) {
      if ($r.node(d).type.name === "list_item") inItem = true
    }
    expect(inItem).toBe(true)
    c.state.doc.check()
  })

  it("returns null inside table cells", () => {
    const c = core("| A | B |\n| --- | --- |\n| a | b |")
    const before = c.getMarkdown()
    // table(0) > table_row(1) > table_header(2)
    expect(c.splitBlockAt(2, 0)).toBe(null)
    expect(c.getMarkdown()).toBe(before)
  })

  it("returns null for non-textblock positions", () => {
    const c = core("---\n\nab")
    expect(c.splitBlockAt(0, 0)).toBe(null) // the horizontal rule itself
    expect(c.getMarkdown()).toBe("---\n\nab\n")
  })
})

describe("editor core: joinWithPreviousBlock", () => {
  it("returns null when there is no previous sibling", () => {
    const c = core("ab")
    expect(c.joinWithPreviousBlock(0)).toBe(null)
    expect(c.getMarkdown()).toBe("ab\n")
  })

  it("joins two paragraphs and returns the join point", () => {
    const c = core("ab\n\ncd")
    // paragraph(0) "ab", paragraph(4) "cd"
    const caret = c.joinWithPreviousBlock(4)
    expect(caret).toBe(3)
    expect(c.getMarkdown()).toBe("abcd\n")
    expect(c.state.doc.resolve(caret!).parentOffset).toBe(2)
    c.state.doc.check()
  })

  it("deletes a preceding hr and leaves the caret at the block start", () => {
    const c = core("---\n\nab")
    // horizontal_rule(0), paragraph(1)
    const caret = c.joinWithPreviousBlock(1)
    expect(caret).toBe(1)
    expect(c.getMarkdown()).toBe("ab\n")
    const $ = c.state.doc.resolve(caret!)
    expect($.parent.type.name).toBe("paragraph")
    expect($.parentOffset).toBe(0)
    c.state.doc.check()
  })

  it("moves the caret into a preceding list's last textblock without restructuring", () => {
    const c = core("- a\n- b\n\npara")
    const before = c.getMarkdown()
    const paraPos = c.state.doc.child(0).nodeSize
    const caret = c.joinWithPreviousBlock(paraPos)
    expect(caret).not.toBeNull()
    expect(c.getMarkdown()).toBe(before)
    const $ = c.state.doc.resolve(caret!)
    expect($.parent.type.name).toBe("paragraph")
    expect($.parent.textContent).toBe("b")
    expect($.parentOffset).toBe(1)
  })

  it("moves the caret into a preceding blockquote without restructuring", () => {
    const c = core("> quote\n\npara")
    const before = c.getMarkdown()
    const paraPos = c.state.doc.child(0).nodeSize
    const caret = c.joinWithPreviousBlock(paraPos)
    expect(c.getMarkdown()).toBe(before)
    const $ = c.state.doc.resolve(caret!)
    expect($.parent.type.name).toBe("paragraph")
    expect($.parent.textContent).toBe("quote")
    expect($.parentOffset).toBe(5)
  })

  it("moves the caret to the end of a preceding code block without restructuring", () => {
    const c = core("```\nxy\n```\n\npara")
    const before = c.getMarkdown()
    const paraPos = c.state.doc.child(0).nodeSize
    const caret = c.joinWithPreviousBlock(paraPos)
    expect(c.getMarkdown()).toBe(before)
    const $ = c.state.doc.resolve(caret!)
    expect($.parent.type.name).toBe("code_block")
    expect($.parentOffset).toBe(2)
  })

  it("moves the caret into a preceding table's last cell without restructuring", () => {
    const c = core("| A |\n| --- |\n| a |\n\npara")
    const before = c.getMarkdown()
    const paraPos = c.state.doc.child(0).nodeSize
    const caret = c.joinWithPreviousBlock(paraPos)
    expect(c.getMarkdown()).toBe(before)
    const $ = c.state.doc.resolve(caret!)
    expect($.parent.type.name).toBe("table_cell")
    expect($.parent.textContent).toBe("a")
    expect($.parentOffset).toBe(1)
  })

  it("joins a paragraph into a preceding heading", () => {
    const c = core("# hd\n\npara")
    const paraPos = c.state.doc.child(0).nodeSize
    const caret = c.joinWithPreviousBlock(paraPos)
    expect(c.getMarkdown()).toBe("# hdpara\n")
    expect(c.state.doc.childCount).toBe(1)
    expect(c.state.doc.resolve(caret!).parent.type.name).toBe("heading")
    c.state.doc.check()
  })
})

describe("editor core: editBlock", () => {
  it("preserves an inline image atom when typing before it", () => {
    const c = core('a ![alt](img.png "t") b')
    // The component flattens image atoms to one ￼ char, keeping
    // text offsets aligned with doc positions.
    c.editBlock(0, "a ￼ b", "a X￼ b")
    expect(c.getMarkdown()).toBe('a X![alt](img.png "t") b\n')
    const img = c.state.doc.child(0).child(1)
    expect(img.type.name).toBe("image")
    expect(img.attrs).toEqual({ src: "img.png", alt: "alt", title: "t" })
  })

  it("preserves an inline image atom when typing after it", () => {
    const c = core('a ![alt](img.png "t") b')
    c.editBlock(0, "a ￼ b", "a ￼ bY")
    expect(c.getMarkdown()).toBe('a ![alt](img.png "t") bY\n')
    expect(c.state.doc.child(0).child(1).type.name).toBe("image")
  })

  it("deletes the image atom when its placeholder char is deleted", () => {
    const c = core("a ![alt](img.png) b")
    c.editBlock(0, "a ￼ b", "a  b")
    expect(c.getMarkdown()).toBe("a  b\n")
    expect(c.state.doc.child(0).childCount).toBe(1)
  })

  it("keeps footnote references aligned through edits", () => {
    const c = core("a [^x] b\n\n[^x]: def")
    c.editBlock(0, "a ￼ b", "a ￼ b!")
    expect(c.getMarkdown()).toBe("a [^x] b!\n\n[^x]: def\n")
    const ref = c.state.doc.child(0).child(1)
    expect(ref.type.name).toBe("footnote_reference")
    expect(ref.attrs.label).toBe("x")
  })

  it("keeps marks spanning the edit boundary", () => {
    const c = core("a **bold** b")
    c.editBlock(0, "a bold b", "a bolXd b")
    expect(c.getMarkdown()).toBe("a **bolXd** b\n")
    const marked = c.state.doc.child(0).child(1)
    expect(marked.text).toBe("bolXd")
    expect(marked.marks.map((m) => m.type.name)).toEqual(["strong"])
  })

  it("handles emoji (UTF-16 surrogate pairs) at offsets", () => {
    const c = core("a 🎉 b")
    c.editBlock(0, "a 🎉 b", "a 🎉 b!")
    expect(c.getMarkdown()).toBe("a 🎉 b!\n")
    const c2 = core("a 🎉 b")
    c2.editBlock(0, "a 🎉 b", "a X🎉 b")
    expect(c2.getMarkdown()).toBe("a X🎉 b\n")
  })

  it("converts inserted newlines into hard_break nodes", () => {
    const c = core("ab")
    c.editBlock(0, "ab", "a\nb")
    const p = c.state.doc.child(0)
    const kinds: string[] = []
    p.forEach((child) => kinds.push(child.type.name))
    expect(kinds).toEqual(["text", "hard_break", "text"])
    expect(c.getMarkdown()).toBe("a\nb\n")
    // identical tree to what a reparse produces
    expect(p.eq(parseMarkdown("a\nb").child(0))).toBe(true)
  })

  it("keeps a marked run intact when a newline is inserted inside it", () => {
    const c = core("**ab**")
    c.editBlock(0, "ab", "a\nb")
    expect(c.getMarkdown()).toBe("**a\nb**\n")
    expect(c.state.doc.child(0).eq(parseMarkdown("**a\nb**").child(0))).toBe(true)
  })

  it("keeps literal newlines inside code blocks", () => {
    const c = core("```\nab\n```")
    c.editBlock(0, "ab", "a\nb")
    const block = c.state.doc.child(0)
    expect(block.type.name).toBe("code_block")
    expect(block.textContent).toBe("a\nb")
    expect(block.childCount).toBe(1)
    expect(c.getMarkdown()).toBe("```\na\nb\n```\n")
  })
})

describe("editor core: insertMarkdownAt", () => {
  it("inserts raw text into a code block without restructuring", () => {
    const c = core("```js\nlet x = 1\n```")
    c.insertMarkdownAt(0, 3, "line1\n\nline2")
    expect(c.state.doc.childCount).toBe(1)
    const block = c.state.doc.child(0)
    expect(block.type.name).toBe("code_block")
    expect(block.textContent).toBe("letline1\n\nline2 x = 1")
    c.state.doc.check()
  })

  it("splits a paragraph and inserts parsed blocks", () => {
    const c = core("hello world")
    c.insertMarkdownAt(0, 5, "a\n\nb")
    expect(c.getMarkdown()).toBe("hello\n\na\n\nb\n\n world\n")
    c.state.doc.check()
  })

  it("ignores non-textblock targets", () => {
    const c = core("| A |\n| --- |\n| a |")
    const before = c.getMarkdown()
    c.insertMarkdownAt(0, 0, "x") // the table node itself
    expect(c.getMarkdown()).toBe(before)
  })
})

describe("editor core: toggleTaskItemAt", () => {
  it("flips checked state by node position", () => {
    const c = core("- [ ] a\n- [x] b")
    // bullet_list(0) > list_item(1), list_item(6)
    c.toggleTaskItemAt(1)
    expect(c.getMarkdown()).toBe("- [x] a\n- [x] b\n")
    c.toggleTaskItemAt(1)
    expect(c.getMarkdown()).toBe("- [ ] a\n- [x] b\n")
  })

  it("turns a plain item into a checked task", () => {
    const c = core("- a")
    c.toggleTaskItemAt(1)
    expect(c.getMarkdown()).toBe("- [x] a\n")
  })

  it("ignores positions that are not list items", () => {
    const c = core("- a")
    c.toggleTaskItemAt(0) // bullet_list
    c.toggleTaskItemAt(2) // paragraph
    expect(c.getMarkdown()).toBe("- a\n")
  })
})

describe("editor core: input rule gating", () => {
  it("does not fire the == highlight rule inside inline code", () => {
    const c = core("`code`")
    c.setSelection(5) // inside the code-marked text
    c.insertText("==x==")
    expect(c.getMarkdown()).toBe("`code==x==`\n")
  })

  it("does not convert '# ' at the start of a list item", () => {
    const c = core("- item")
    c.setSelection(3)
    c.insertText("# ")
    expect(c.state.doc.child(0).type.name).toBe("bullet_list")
    expect(c.state.doc.child(0).child(0).child(0).textContent).toBe("# item")
  })

  it("does not convert '1. ' at the start of a list item", () => {
    const c = core("- item")
    c.setSelection(3)
    c.insertText("1. ")
    expect(c.state.doc.child(0).type.name).toBe("bullet_list")
    expect(c.state.doc.child(0).child(0).child(0).textContent).toBe("1. item")
  })

  it("does not convert '> ' at the start of a list item", () => {
    const c = core("- item")
    c.setSelection(3)
    c.insertText("> ")
    expect(c.state.doc.child(0).type.name).toBe("bullet_list")
    expect(c.state.doc.child(0).child(0).child(0).textContent).toBe("> item")
  })

  it("still converts block markers in a top-level paragraph", () => {
    const c = core("")
    c.setSelection(1)
    c.insertText("## ")
    expect(c.state.doc.child(0).type.name).toBe("heading")
    const c2 = core("")
    c2.setSelection(1)
    c2.insertText("- ")
    expect(c2.state.doc.child(0).type.name).toBe("bullet_list")
  })

  it("still flips task state via '[ ] ' inside a list item", () => {
    const c = core("- abc")
    c.setSelection(3)
    c.insertText("[ ] ")
    expect(c.getMarkdown()).toBe("- [ ] abc\n")
  })
})
