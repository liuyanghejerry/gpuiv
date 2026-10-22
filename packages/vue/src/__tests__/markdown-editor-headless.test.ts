/// Headless `<markdown-editor>` tests: block rendering, typing, Enter,
/// marks, lists/tasks, clipboard interception, cross-block selection, search
/// decorations, context menu, and source mode — all through the mutation
/// protocol against HeadlessRenderer, no GPU needed.

// @ts-nocheck

import { defineComponent, h, reactive } from "vue"
import { describe, expect, it } from "vitest"
import { mountHeadless } from "./headless.js"
import { MarkdownEditor } from "../markdown-editor/component.js"

function harness(initial = {}) {
  const state = reactive({
    source: initial.source ?? "",
    mode: initial.mode ?? "wysiwyg",
    searchQuery: initial.searchQuery ?? "",
    searchActiveIndex: initial.searchActiveIndex ?? -1,
    viewportHeight: initial.viewportHeight ?? 0,
    theme: initial.theme ?? {},
  })
  const changes: string[] = []
  const matchCounts: number[] = []
  const clipboard: string[] = []
  let editor: any = null
  const Root = defineComponent({
    setup() {
      return () =>
        h(MarkdownEditor, {
          ref: (el: any) => {
            editor = el
          },
          source: state.source,
          mode: state.mode,
          searchQuery: state.searchQuery,
          searchActiveIndex: state.searchActiveIndex,
          viewportHeight: state.viewportHeight,
          theme: state.theme,
          onChange: (md: string) => changes.push(md),
          onSearchMatches: (n: number) => matchCounts.push(n),
        })
    },
  })
  const mounted = mountHeadless(Root)
  const r = mounted.renderer
  r.writeClipboardText = (text: string) => {
    clipboard.push(text)
  }
  r.readClipboardText = () => clipboard[clipboard.length - 1] ?? null

  const idsWithTestId = (testId: string): number[] => {
    const ids = r.opsOf("setCustomProp")
      .filter((op) => op[2] === "testId" && op[3] === testId)
      .map((op) => op[1])
    return [...new Set(ids)].filter((id) => !r.destroyedIds.has(id))
  }

  const blockIds = (): number[] =>
    r.opsOf("createElement")
      .filter((op) => op[2] === "textarea")
      .map((op) => op[1])
      .filter((id) => !r.destroyedIds.has(id))

  const propOf = (id: number, key: string) => {
    const ops = r.opsOf("setCustomProp").filter((op) => op[1] === id && op[2] === key)
    return ops.length ? ops[ops.length - 1][3] : undefined
  }

  const fire = (id: number, eventType: string, fields: Record<string, unknown> = {}) =>
    mounted.dispatch({ elementId: id, eventType, ...fields })

  return {
    ...mounted,
    state,
    changes,
    matchCounts,
    clipboard,
    r,
    editor: () => editor,
    idsWithTestId,
    blockIds,
    propOf,
    fire,
  }
}

describe("markdown-editor headless", () => {
  it("renders each block as a textarea with its text and marker", async () => {
    const t = harness({ source: "# Title\n\nplain text\n\n- item one" })
    await t.settle()
    const blocks = t.blockIds()
    expect(blocks.length).toBe(3)
    expect(t.propOf(blocks[0], "value")).toBe("Title")
    expect(t.propOf(blocks[1], "value")).toBe("plain text")
    expect(t.propOf(blocks[2], "value")).toBe("item one")
    // Headings scale the font; list markers render as a sibling text node.
    expect(t.r.lastStyle(blocks[0]).fontSize).toBe(32)
    expect(t.r.allTexts()).toContain("•")
  })

  it("maps inline marks to spans", async () => {
    const t = harness({ source: "**b** *i* `c` ==h== ~~s~~ [l](u)" })
    await t.settle()
    const [block] = t.blockIds()
    const spans = t.propOf(block, "spans")
    expect(spans.length).toBe(6)
    const [strong, em, code, highlight, strike, link] = spans
    expect(strong.fontWeight).toBe(600)
    expect(em.fontStyle).toBe("italic")
    expect(code.background).toBe("rgba(127, 127, 127, 0.22)")
    expect(code.fontFamily).toBe("Menlo")
    expect(highlight.background).toBe("rgba(255, 214, 0, 0.35)")
    expect(strike.strikethrough).toBe(true)
    expect(link.underline).toBe(true)
    expect(link.color).toBe("#6cb2ff")
  })

  it("renders code blocks, quotes, rules, and tables", async () => {
    const t = harness({
      source: "```js\nconst x = 1\n```\n\n> quoted\n\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2 |",
    })
    await t.settle()
    const blocks = t.blockIds()
    // code_block, quote paragraph, two table cells, header row cells a/b
    expect(t.r.allTexts()).toContain("js")
    expect(t.propOf(blocks[0], "value")).toBe("const x = 1")
    expect(t.r.lastStyle(blocks[0]).fontFamily).toBe("Menlo")
    expect(t.propOf(blocks[1], "value")).toBe("quoted")
    expect(t.r.lastStyle(blocks[1]).color).toBe("#8a8a8a")
    expect(t.r.opsOf("createElement").some((op) => op[2] === "img")).toBe(false)
    const cells = [
      ...t.r.opsOf("setCustomProp").filter((op) => op[2] === "testId" && String(op[3]).startsWith("md-cell-")),
    ]
    expect(new Set(cells.map((op) => op[3])).size).toBe(4)
    const cellIds = t.blockIds().slice(2)
    expect(t.propOf(cellIds[0], "value")).toBe("a")
    expect(t.r.lastStyle(cellIds[0]).fontWeight).toBe(600)
  })

  it("renders hr and image spacer rows", async () => {
    const t = harness({ source: "---\n\n![pic](photo.png)" })
    await t.settle()
    const divs = t.r.opsOf("createElement").filter((op) => op[2] === "div")
    expect(divs.length).toBeGreaterThan(0)
    // The image paragraph renders an atom placeholder in the block text.
    expect(t.blockIds().length).toBe(1)
    expect(t.propOf(t.blockIds()[0], "value")).toContain("\uFFFC")
  })

  it("edits a block through change events and emits markdown", async () => {
    const t = harness({ source: "hello" })
    await t.settle()
    const [block] = t.blockIds()
    expect(t.fire(block, "change", { value: "hello world" })).toBe(true)
    await t.settle()
    expect(t.changes.at(-1)).toBe("hello world\n")
    expect(t.propOf(block, "value")).toBe("hello world")
    expect(t.editor().getMarkdown()).toBe("hello world\n")
  })

  it("submit splits the block and focuses the new one", async () => {
    const t = harness({ source: "onetwo" })
    await t.settle()
    const [block] = t.blockIds()
    t.fire(block, "selectionChange", { startIndex: 3, endIndex: 3 })
    expect(t.fire(block, "submit")).toBe(true)
    await t.settle()
    expect(t.blockIds().length).toBe(2)
    expect(t.changes.at(-1)).toBe("one\n\ntwo\n")
  })

  it("backspaceStart joins with the previous block, or is a no-op", async () => {
    const t = harness({ source: "one\n\ntwo" })
    await t.settle()
    const [first, second] = t.blockIds()
    expect(t.fire(first, "backspaceStart")).toBe(true)
    await t.settle()
    expect(t.changes.length).toBe(0)
    expect(t.fire(second, "backspaceStart")).toBe(true)
    await t.settle()
    expect(t.blockIds().length).toBe(1)
    expect(t.changes.at(-1)).toContain("one")
    expect(t.changes.at(-1)).toContain("two")
  })

  it("format shortcuts apply marks over the tracked selection", async () => {
    const t = harness({ source: "hello" })
    await t.settle()
    const [block] = t.blockIds()
    t.fire(block, "selectionChange", { startIndex: 0, endIndex: 5 })
    expect(t.fire(block, "keyDown", { key: "b", modifiers: { cmd: true } })).toBe(true)
    await t.settle()
    expect(t.changes.at(-1)).toBe("**hello**\n")
    t.fire(block, "selectionChange", { startIndex: 0, endIndex: 5 })
    t.fire(block, "keyDown", { key: "b", modifiers: { cmd: true } })
    await t.settle()
    expect(t.changes.at(-1)).toBe("hello\n")
    const roundTrip = async (key: string, modifiers: Record<string, boolean>, marked: string) => {
      t.fire(block, "selectionChange", { startIndex: 0, endIndex: 5 })
      t.fire(block, "keyDown", { key, modifiers })
      await t.settle()
      expect(t.changes.at(-1)).toBe(`${marked}\n`)
      t.fire(block, "selectionChange", { startIndex: 0, endIndex: 5 })
      t.fire(block, "keyDown", { key, modifiers })
      await t.settle()
      expect(t.changes.at(-1)).toBe("hello\n")
    }
    await roundTrip("i", { ctrl: true }, "*hello*")
    await roundTrip("e", { cmd: true }, "`hello`")
    await roundTrip("x", { cmd: true, shift: true }, "~~hello~~")
    await roundTrip("h", { cmd: true, shift: true }, "==hello==")
  })

  it("cmd-k links the selection from the clipboard", async () => {
    const t = harness({ source: "click here" })
    await t.settle()
    const [block] = t.blockIds()
    t.fire(block, "selectionChange", { startIndex: 6, endIndex: 10 })
    t.clipboard.push("https://example.com")
    expect(t.fire(block, "keyDown", { key: "k", modifiers: { cmd: true } })).toBe(true)
    await t.settle()
    expect(t.changes.at(-1)).toBe("click [here](https://example.com)\n")
  })

  it("list keys wrap and unwrap the current block", async () => {
    const t = harness({ source: "para" })
    await t.settle()
    const [block] = t.blockIds()
    t.fire(block, "selectionChange", { startIndex: 0, endIndex: 4 })
    expect(t.fire(block, "keyDown", { key: "8", modifiers: { cmd: true, shift: true } })).toBe(true)
    await t.settle()
    expect(t.changes.at(-1)).toBe("- para\n")
    const item = t.blockIds()[0]
    t.fire(item, "selectionChange", { startIndex: 0, endIndex: 4 })
    t.fire(item, "keyDown", { key: "7", modifiers: { cmd: true, shift: true } })
    await t.settle()
    expect(t.changes.at(-1)).toBe("1. para\n")
  })

  it("task checkboxes render, click-toggle, and cmd-enter toggles", async () => {
    const t = harness({ source: "- [ ] open\n- [x] done" })
    await t.settle()
    const checks = [
      ...t.r.opsOf("setCustomProp").filter((op) => op[2] === "testId" && String(op[3]).startsWith("md-check-")),
    ]
    const ids = [...new Set(checks.map((op) => op[1]))].filter((id) => !t.r.destroyedIds.has(id))
    expect(ids.length).toBe(2)
    // The checked one carries the checkmark svg.
    const svgIds = t.r.opsOf("createElement").filter((op) => op[2] === "svg").map((op) => op[1])
    expect(svgIds.length).toBe(1)
    expect(t.fire(ids[0], "click")).toBe(true)
    await t.settle()
    expect(t.changes.at(-1)).toContain("[x] open")
    const [block] = t.blockIds()
    t.fire(block, "keyDown", { key: "enter", modifiers: { cmd: true } })
    await t.settle()
    expect(t.changes.at(-1)).toContain("[ ] open")
  })
})

describe("markdown-editor clipboard and selection", () => {
  it("intercepts copy, cut, and paste per block", async () => {
    const t = harness({ source: "**bold** tail" })
    await t.settle()
    const [block] = t.blockIds()
    t.fire(block, "selectionChange", { startIndex: 0, endIndex: 4 })
    t.fire(block, "copy", {})
    expect(t.clipboard).toEqual(["**bold**"])
    t.fire(block, "cut", {})
    await t.settle()
    expect(t.clipboard.at(-1)).toBe("**bold**")
    expect(t.propOf(block, "value")).toBe(" tail")
    expect(t.propOf(block, "selection")).toEqual([0, 0])
    t.fire(block, "paste", { value: "XY" })
    await t.settle()
    expect(t.propOf(block, "value")).toBe("XY tail")
  })

  it("paste replaces the tracked selection range", async () => {
    const t = harness({ source: "keep" })
    await t.settle()
    const [block] = t.blockIds()
    t.fire(block, "selectionChange", { startIndex: 1, endIndex: 3 })
    t.fire(block, "paste", { value: "Z" })
    await t.settle()
    expect(t.propOf(block, "value")).toBe("kZp")
    expect(t.propOf(block, "selection")).toEqual([2, 2])
  })

  it("pastes structured markdown as blocks, code literally, cells in-table", async () => {
    const plain = harness({ source: "para" })
    await plain.settle()
    const [block] = plain.blockIds()
    plain.fire(block, "selectionChange", { startIndex: 4, endIndex: 4 })
    plain.fire(block, "paste", { value: "- l1\n- l2" })
    await plain.settle()
    expect(plain.blockIds().length).toBe(3)
    expect(plain.editor().getMarkdown()).toContain("- l1")

    const code = harness({ source: "```\nab\n```" })
    await code.settle()
    const [codeBlock] = code.blockIds()
    code.fire(codeBlock, "selectionChange", { startIndex: 2, endIndex: 2 })
    code.fire(codeBlock, "paste", { value: "- x\n- y" })
    await code.settle()
    expect(code.blockIds().length).toBe(1)
    expect(code.propOf(codeBlock, "value")).toBe("ab- x\n- y")

    const table = harness({ source: "| a |\n| --- |\n| 1 |" })
    await table.settle()
    const cells = table.blockIds()
    table.fire(cells[1], "selectionChange", { startIndex: 1, endIndex: 1 })
    table.fire(cells[1], "paste", { value: "x\ny" })
    await table.settle()
    expect(table.propOf(cells[1], "value")).toBe("1x\ny")
  })

  it("undo and redo route through PM history", async () => {
    const t = harness({ source: "keep" })
    await t.settle()
    const [block] = t.blockIds()
    t.fire(block, "change", { value: "kept!" })
    await t.settle()
    t.fire(block, "undo")
    await t.settle()
    expect(t.propOf(block, "value")).toBe("keep")
    expect(t.propOf(block, "valueRevision")).toBeGreaterThan(0)
    t.fire(block, "redo")
    await t.settle()
    expect(t.propOf(block, "value")).toBe("kept!")
    const before = t.changes.length
    t.fire(block, "undo")
    t.fire(block, "undo")
    await t.settle()
    expect(t.changes.length).toBe(before + 1)
    expect(t.propOf(block, "value")).toBe("keep")
  })

  it("selectAll spans one block locally, several as docSelection", async () => {
    const single = harness({ source: "only" })
    await single.settle()
    const [block] = single.blockIds()
    single.fire(block, "selectAll")
    await single.settle()
    expect(single.propOf(block, "selection")).toEqual([0, 4])

    const t = harness({ source: "alpha\n\nbeta" })
    await t.settle()
    const [a, b] = t.blockIds()
    t.fire(a, "selectAll")
    await t.settle()
    expect(t.propOf(a, "decorations")).toEqual([
      { start: 0, end: 5, color: "rgba(124, 134, 255, 0.35)" },
    ])
    expect(t.propOf(b, "decorations")).toEqual([
      { start: 0, end: 4, color: "rgba(124, 134, 255, 0.35)" },
    ])
  })

  it("shift-click extends the selection across blocks", async () => {
    const t = harness({ source: "alpha\n\nbeta" })
    await t.settle()
    const [a, b] = t.blockIds()
    t.fire(a, "selectionChange", { startIndex: 0, endIndex: 2 })
    t.fire(b, "click", { modifiers: { shift: true } })
    await t.settle()
    // The anchor block decorates from its caret (head 2), the target to its end.
    expect(t.propOf(a, "decorations")).toEqual([
      { start: 2, end: 5, color: "rgba(124, 134, 255, 0.35)" },
    ])
    expect(t.propOf(b, "decorations")).toEqual([
      { start: 0, end: 4, color: "rgba(124, 134, 255, 0.35)" },
    ])
    t.fire(b, "click", {})
    await t.settle()
    expect(t.propOf(a, "decorations")).toBeNull()
  })

  it("drag extends the selection and swallows the release click", async () => {
    const t = harness({ source: "alpha\n\nbeta" })
    await t.settle()
    const [a, b] = t.blockIds()
    t.r.getInputTextHit = (ids: number[], x: number) => (x > 10 ? [ids[ids.length - 1], 2] : [ids[0], 0])
    t.fire(a, "selectionChange", { startIndex: 0, endIndex: 1 })
    t.fire(a, "selectionDrag", { x: 20, y: 5, startIndex: 0 })
    await t.settle()
    // The block that owns the native range paints no duplicate decoration.
    expect(t.propOf(a, "decorations")).toBeUndefined()
    expect(t.propOf(b, "decorations")).toEqual([
      { start: 0, end: 2, color: "rgba(124, 134, 255, 0.35)" },
    ])
    // drag back into the same block collapses the selection
    t.fire(a, "selectionDrag", { x: 1, y: 1 })
    await t.settle()
    expect(t.propOf(b, "decorations")).toBeNull()
    // release after a cross-block drag: the trailing click is swallowed
    t.fire(a, "selectionDrag", { x: 20, y: 5, startIndex: 0 })
    await t.settle()
    t.fire(a, "selectionDrag", { value: "end" })
    t.fire(a, "click", {})
    await t.settle()
    expect(t.propOf(b, "decorations")).toBeDefined()
    await new Promise((resolve) => setTimeout(resolve, 0))
    t.fire(a, "click", {})
    await t.settle()
    expect(t.propOf(b, "decorations")).toBeNull()
  })

  it("root mouse-down clears the selection outside editors", async () => {
    const t = harness({ source: "alpha\n\nbeta" })
    await t.settle()
    const [a, b] = t.blockIds()
    const root = t.r.opsOf("createElement").map((op) => op[1]).find((id) => t.r.typeOf(id) === "div" && t.r.hasListener(id, "mouseDown"))
    expect(root).toBeDefined()
    t.fire(a, "selectionChange", { startIndex: 0, endIndex: 1 })
    t.fire(b, "click", { modifiers: { shift: true } })
    await t.settle()
    expect(t.propOf(a, "decorations")).toBeDefined()
    // right-button press keeps the selection
    t.fire(root, "mouseDown", { x: 999, y: 999, button: 2 })
    await t.settle()
    expect(t.propOf(a, "decorations")).toBeDefined()
    // an open context menu shields it too
    t.fire(b, "contextMenu", { x: 5, y: 5 })
    await t.settle()
    t.fire(root, "mouseDown", { x: 999, y: 999, button: 0 })
    await t.settle()
    expect(t.propOf(a, "decorations")).toBeDefined()
    t.fire(t.idsWithTestId("md-menu-backdrop")[0], "click")
    await t.settle()
    // far outside any editor clears it
    t.fire(root, "mouseDown", { x: 999, y: 999, button: 0 })
    await t.settle()
    expect(t.propOf(a, "decorations")).toBeNull()
    // a press inside a block keeps it
    t.fire(a, "selectionChange", { startIndex: 0, endIndex: 1 })
    t.fire(b, "click", { modifiers: { shift: true } })
    await t.settle()
    t.r.elementBounds.set(a, { x: 0, y: 0, width: 100, height: 20 })
    t.fire(root, "mouseDown", { x: 50, y: 10, button: 0 })
    await t.settle()
    expect(t.propOf(a, "decorations")).toBeDefined()
  })
})

describe("markdown-editor search, menu, and source mode", () => {
  it("decorates search matches and focuses the active one", async () => {
    const t = harness({ source: "find this\n\nanother find" })
    await t.settle()
    t.state.searchQuery = "find"
    await t.settle()
    expect(t.matchCounts.at(-1)).toBe(2)
    const [a, b] = t.blockIds()
    expect(t.propOf(a, "decorations")).toEqual([
      { start: 0, end: 4, color: "rgba(255, 214, 0, 0.35)" },
    ])
    expect(t.propOf(b, "decorations")).toEqual([
      { start: 8, end: 12, color: "rgba(255, 214, 0, 0.35)" },
    ])
    t.state.searchActiveIndex = 1
    await t.settle()
    expect(t.propOf(b, "decorations")[0].color).toBe("rgba(255, 170, 0, 0.75)")
    expect(t.r.focusedElementId).toBe(b)
    expect(t.propOf(b, "selection")).toEqual([8, 12])
  })

  it("opens a context menu with working actions", async () => {
    const t = harness({ source: "**bold** tail" })
    await t.settle()
    const [block] = t.blockIds()
    t.fire(block, "selectionChange", { startIndex: 0, endIndex: 4 })
    t.fire(block, "contextMenu", { x: 30, y: 40 })
    await t.settle()
    expect(t.idsWithTestId("md-menu").length).toBe(1)
    // backdrop click closes without acting
    t.fire(t.idsWithTestId("md-menu-backdrop")[0], "click")
    await t.settle()
    expect(t.idsWithTestId("md-menu").length).toBe(0)
    // menu copy uses the tracked selection
    t.fire(block, "contextMenu", { x: 30, y: 40 })
    await t.settle()
    t.fire(t.idsWithTestId("md-menu-copy")[0], "click")
    await t.settle()
    expect(t.clipboard.at(-1)).toBe("**bold**")
    expect(t.idsWithTestId("md-menu").length).toBe(0)
  })

  it("source mode edits, cuts, pastes, and returns to wysiwyg", async () => {
    const t = harness({ source: "# Head" })
    await t.settle()
    t.state.mode = "source"
    await t.settle()
    const src = t.idsWithTestId("md-source")[0]
    expect(t.r.typeOf(src)).toBe("textarea")
    expect(t.propOf(src, "value")).toBe("# Head\n")
    t.fire(src, "change", { value: "# Changed" })
    await t.settle()
    expect(t.changes.at(-1)).toBe("# Changed")
    expect(t.editor().getMarkdown()).toBe("# Changed")
    t.fire(src, "selectionChange", { startIndex: 1, endIndex: 3 })
    t.fire(src, "contextMenu", { x: 5, y: 5 })
    await t.settle()
    t.fire(t.idsWithTestId("md-menu-cut")[0], "click")
    await t.settle()
    expect(t.clipboard.at(-1)).toBe(" C")
    expect(t.propOf(src, "value")).toBe("#hanged")
    t.fire(src, "contextMenu", { x: 5, y: 5 })
    await t.settle()
    t.fire(t.idsWithTestId("md-menu-paste")[0], "click")
    await t.settle()
    expect(t.propOf(src, "value")).toBe("# Changed")
    t.fire(src, "contextMenu", { x: 5, y: 5 })
    await t.settle()
    t.fire(t.idsWithTestId("md-menu-select-all")[0], "click")
    await t.settle()
    expect(t.propOf(src, "selection")).toEqual([0, 9])
    t.state.mode = "wysiwyg"
    await t.settle()
    const blocks = t.blockIds()
    expect(blocks.length).toBe(1)
    expect(t.propOf(blocks[0], "value")).toBe("Changed")
  })

  it("resets on external source replacement only", async () => {
    const t = harness({ source: "old" })
    await t.settle()
    t.state.source = "# New"
    await t.settle()
    const [block] = t.blockIds()
    expect(t.propOf(block, "value")).toBe("New")
    expect(t.r.lastStyle(block).fontSize).toBe(32)
    t.fire(block, "change", { value: "New!" })
    await t.settle()
    const emitted = t.changes.at(-1)
    t.state.source = emitted
    await t.settle()
    expect(t.propOf(block, "value")).toBe("New!")
  })

  it("jumpToHeading flashes and focuses the block", async () => {
    const t = harness({ source: "# Docs\n\nbody" })
    await t.settle()
    expect(t.editor().jumpToHeading("Docs")).toBe(true)
    await t.settle()
    expect(t.idsWithTestId("md-flash").length).toBe(1)
    const [heading] = t.blockIds()
    expect(t.r.focusedElementId).toBe(heading)
    expect(t.editor().jumpToHeading("Missing")).toBe(false)
  })

  it("scrolls when viewportHeight is set", async () => {
    const t = harness({ source: "x", viewportHeight: 300 })
    await t.settle()
    const root = t.r.opsOf("createElement").map((op) => op[1]).find((id) => t.r.typeOf(id) === "div" && t.r.hasListener(id, "mouseDown"))
    const style = t.r.lastStyle(root)
    expect(style.height).toBe(300)
    expect(style.overflow).toBe("scroll")
  })

  it("merges the theme prop", async () => {
    const t = harness({ source: "**b**", theme: { strongText: "#ff0000", fontSize: 20 } })
    await t.settle()
    const [block] = t.blockIds()
    expect(t.propOf(block, "spans")[0].color).toBe("#ff0000")
    expect(t.r.lastStyle(block).fontSize).toBe(20)
  })

  it("renders footnote markers and references", async () => {
    const t = harness({ source: "See[^1]\n\n[^1]: note" })
    await t.settle()
    const [ref] = t.blockIds()
    expect(t.propOf(ref, "value")).toBe("See\uFFFC")
    expect(t.propOf(ref, "spans")).toEqual([{ start: 3, end: 4, color: "#6cb2ff", underline: true }])
    expect(t.r.allTexts()).toContain("[^1]:")
  })
})

describe("markdown-editor edge paths", () => {
  it("drag falls back to per-element hit-testing", async () => {
    const t = harness({ source: "alpha\n\nbeta" })
    await t.settle()
    const [a, b] = t.blockIds()
    t.r.elementBounds.set(a, { x: 0, y: 0, width: 100, height: 20 })
    t.r.elementBounds.set(b, { x: 0, y: 100, width: 100, height: 20 })
    t.r.getInputTextOffset = (id: number, x: number, y: number) => (y > 50 ? 3 : 1)
    t.fire(a, "selectionChange", { startIndex: 0, endIndex: 1 })
    t.fire(a, "selectionDrag", { x: 50, y: 101, startIndex: 0 })
    await t.settle()
    expect(t.propOf(b, "decorations")).toEqual([
      { start: 0, end: 3, color: "rgba(124, 134, 255, 0.35)" },
    ])
  })

  it("cut serializes and deletes a cross-block selection", async () => {
    const t = harness({ source: "**bold**\n\nplain" })
    await t.settle()
    const [a, b] = t.blockIds()
    t.fire(a, "selectionChange", { startIndex: 0, endIndex: 0 })
    t.fire(b, "click", { modifiers: { shift: true } })
    await t.settle()
    // copy serializes the cross-block markdown without deleting
    t.fire(b, "copy", {})
    expect(t.clipboard.at(-1)).toContain("**bold**")
    expect(t.clipboard.at(-1)).toContain("plain")
    expect(t.blockIds().length).toBe(2)
    t.fire(b, "cut", {})
    await t.settle()
    expect(t.clipboard.at(-1)).toContain("**bold**")
    expect(t.blockIds().length).toBe(1)
  })

  it("copies a table-cell selection as markdown", async () => {
    const t = harness({ source: "| **b** |\n| --- |\n| x |" })
    await t.settle()
    const [header] = t.blockIds()
    t.fire(header, "selectionChange", { startIndex: 0, endIndex: 1 })
    t.fire(header, "copy", {})
    expect(t.clipboard.at(-1)).toBe("**b**")
  })

  it("no-ops clipboard events arriving on a stale row after a doc-shrinking edit", async () => {
    // Two events in one JS tick share the previous render's handlers: the
    // first cut deletes the cross-block selection (collapsing both blocks to
    // "aa"), so block B's cut/paste closures still carry its pre-edit doc
    // position — ProseMirror's nodeAt throws RangeError for those.
    const t = harness({ source: "aaaa\n\nbbbb" })
    await t.settle()
    const [a, b] = t.blockIds()
    t.fire(a, "selectionChange", { startIndex: 0, endIndex: 2 })
    t.fire(b, "click", { modifiers: { shift: true } })
    t.fire(a, "cut", {})
    // No settle: the registry still holds the pre-edit handler closures.
    expect(() => t.fire(b, "cut", { startIndex: 0, endIndex: 2 })).not.toThrow()
    // The stale cut falls back to the row's mirrored plain text.
    expect(t.clipboard.at(-1)).toBe("bb")
    expect(() => t.fire(b, "paste", { value: "Z" })).not.toThrow()
    await t.settle()
    // Neither stale event touched the doc.
    expect(t.editor().getMarkdown()).toBe("aa\n")
  })

  it("anchors the context menu to the editor bounds", async () => {
    const t = harness({ source: "x" })
    await t.settle()
    const [block] = t.blockIds()
    const root = t.r.opsOf("createElement").map((op) => op[1]).find((id) => t.r.typeOf(id) === "div" && t.r.hasListener(id, "mouseDown"))
    t.r.elementBounds.set(root, { x: 100, y: 50, width: 400, height: 300 })
    t.r.scrollOffsets.set(root, [0, -20])
    t.fire(block, "contextMenu", { x: 150, y: 100 })
    await t.settle()
    const menu = t.idsWithTestId("md-menu")[0]
    expect(t.r.lastStyle(menu).left).toBe(50)
    expect(t.r.lastStyle(menu).top).toBe(70)
  })

  it("ignores active-match focus without a query or match", async () => {
    const t = harness({ source: "find" })
    await t.settle()
    t.state.searchQuery = "find"
    await t.settle()
    t.state.searchActiveIndex = 9
    await t.settle()
    t.state.searchQuery = ""
    t.state.searchActiveIndex = 0
    await t.settle()
    expect(t.r.focusedElementId).toBeNull()
    // focusBlockByKey focuses a block directly
    const [block] = t.blockIds()
    t.editor().focusBlockByKey("b0", 0)
    await t.settle()
    expect(t.r.focusedElementId).toBe(block)
  })
})
