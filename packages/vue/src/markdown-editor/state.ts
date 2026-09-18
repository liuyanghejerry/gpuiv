import { history, undo, undoDepth, redo } from "prosemirror-history"
import { InputRule } from "prosemirror-inputrules"
import { Fragment, Node as PMNode } from "prosemirror-model"
import { findWrapping } from "prosemirror-transform"
import { EditorState, TextSelection, Transaction } from "prosemirror-state"
import { detectMarkerStyle, editorSchema, parseMarkdown, serializeMarkdown } from "./model.js"
import type { MarkerStyle } from "./model.js"

/**
 * Headless editor controller (docs/markdown-editor-plan.md M1).
 *
 * Owns the ProseMirror EditorState without prosemirror-view: the native
 * block elements (M2) report key input through insertText, gpuiv key events
 * call the command methods, and the component (M3) renders state.doc.
 * ColaMD constraint honored by design: reset() builds a fresh state, so
 * programmatic replacement never enters the undo history.
 */

type MarkName = "em" | "strong" | "code" | "strikethrough" | "highlight"

function ensureBlock(doc: PMNode): PMNode {
  if (doc.childCount === 0) {
    return doc.type.createAndFill(null, editorSchema.nodes.paragraph.create()) ?? doc
  }
  return doc
}

function createEditorState(markdown: string): EditorState {
  return EditorState.create({
    doc: ensureBlock(parseMarkdown(markdown)),
    plugins: [history()],
  })
}

// Block-start rules run against the text from the textblock start to the
// cursor; the mark rule runs against the tail. Each handler receives doc
// positions (start = match start, end = cursor).
// InputRule keeps the regex on an @internal field, so carry it alongside.
interface EditorInputRule {
  rule: InputRule
  match: RegExp
  handler: (state: EditorState, match: RegExpMatchArray, start: number, end: number) => Transaction | null
}

const defineRule = (
  match: RegExp,
  handler: (state: EditorState, match: RegExpMatchArray, start: number, end: number) => Transaction | null,
): EditorInputRule => ({ rule: new InputRule(match, handler), match, handler })

const headingRule = defineRule(/^(#{1,6}) $/, (state, match, start, end) => {
  const $start = state.doc.resolve(start)
  const level = match[1].length
  if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), editorSchema.nodes.heading)) {
    return null
  }
  return state.tr.delete(start, end).setBlockType(start, start, editorSchema.nodes.heading, { level })
})

const bulletRule = defineRule(/^([-*+]) $/, (state, _match, start, end) => {
  const tr = state.tr.delete(start, end)
  const range = tr.doc.resolve(start).blockRange()
  if (!range) return null
  const wrapping = findWrapping(range, editorSchema.nodes.bullet_list, { tight: true })
  if (!wrapping) return null
  return tr.wrap(range, wrapping)
})

const orderedRule = defineRule(/^(\d+)\. $/, (state, match, start, end) => {
  const order = parseInt(match[1], 10) || 1
  const tr = state.tr.delete(start, end)
  const range = tr.doc.resolve(start).blockRange()
  if (!range) return null
  const wrapping = findWrapping(range, editorSchema.nodes.ordered_list, { order, tight: true })
  if (!wrapping) return null
  return tr.wrap(range, wrapping)
})

const quoteRule = defineRule(/^> $/, (state, _match, start, end) => {
  const tr = state.tr.delete(start, end)
  const range = tr.doc.resolve(start).blockRange()
  if (!range) return null
  const wrapping = findWrapping(range, editorSchema.nodes.blockquote)
  if (!wrapping) return null
  return tr.wrap(range, wrapping)
})

const fenceRule = defineRule(/^```$/, (state, _match, start, end) => {
  const $start = state.doc.resolve(start)
  if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), editorSchema.nodes.code_block)) {
    return null
  }
  return state.tr.delete(start, end).setBlockType(start, start, editorSchema.nodes.code_block, { info: "" })
})

const taskRule = defineRule(/^\[( |x|X)\] $/, (state, match, start, end) => {
  const $from = state.doc.resolve(start)
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === "list_item") {
      const tr = state.tr
      tr.delete(start, end)
      tr.setNodeMarkup($from.before(d), null, {
        ...node.attrs,
        checked: match[1].toLowerCase() === "x",
      })
      return tr
    }
  }
  return null
})

const highlightRule = defineRule(/==([^=]+)==$/, (state, match, start, end) => {
  const tr = state.tr
  tr.delete(end - 2, end)
  tr.delete(start, start + 2)
  tr.addMark(start, end - 4, editorSchema.marks.highlight.create())
  return tr
})

const inputRules: EditorInputRule[] = [
  headingRule,
  bulletRule,
  orderedRule,
  quoteRule,
  fenceRule,
  taskRule,
  highlightRule,
]

function runInputRules(state: EditorState): Transaction | null {
  const { $from } = state.selection
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, null, "\ufffc")
  for (const rule of inputRules) {
    const match = rule.match.exec(textBefore)
    if (!match) continue
    const start = state.selection.from - match[0].length
    const tr = rule.handler(state, match, start, state.selection.from)
    if (tr) return tr
  }
  return null
}

function ancestorOfKind($pos: { node: (d: number) => PMNode; depth: number }, typeName: string): number | null {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === typeName) return d
  }
  return null
}

export class MarkdownEditorCore {
  state: EditorState
  private markerStyle: MarkerStyle

  constructor(markdown: string) {
    this.markerStyle = detectMarkerStyle(markdown)
    this.state = createEditorState(markdown)
  }

  /** Programmatic replacement: fresh state, flushed undo history. */
  reset(markdown: string): void {
    this.markerStyle = detectMarkerStyle(markdown)
    this.state = createEditorState(markdown)
  }

  getMarkdown(): string {
    return serializeMarkdown(this.state.doc, this.markerStyle)
  }

  dispatch(tr: Transaction): void {
    this.state = this.state.apply(tr)
  }

  setSelection(anchor: number, head = anchor): void {
    this.dispatch(
      this.state.tr.setSelection(TextSelection.create(this.state.doc, anchor, head)),
    )
  }

  /** Text input from the native block (typing, IME commit). Runs input rules. */
  insertText(text: string): void {
    const { from, to } = this.state.selection
    const tr = this.state.tr.insertText(text, from, to)
    this.dispatch(tr)
    const ruleTr = runInputRules(this.state)
    if (ruleTr) {
      ruleTr.setMeta("appendedTransaction", tr)
      this.dispatch(ruleTr)
    }
  }

  toggleMark(name: MarkName): void {
    const type = editorSchema.marks[name]
    if (!type) return
    const { from, to, empty } = this.state.selection
    const tr = this.state.tr
    if (empty) {
      const active =
        this.state.storedMarks?.some((m) => m.type === type) ||
        this.state.selection.$from.marks().some((m) => m.type === type)
      if (active) tr.removeStoredMark(type)
      else tr.addStoredMark(type.create())
    } else {
      if (this.state.doc.rangeHasMark(from, to, type)) tr.removeMark(from, to, type)
      else tr.addMark(from, to, type.create())
    }
    this.dispatch(tr)
  }

  toggleLink(href: string): void {
    const type = editorSchema.marks.link
    const { from, to, empty } = this.state.selection
    const tr = this.state.tr
    let allMatch = true
    if (!empty) {
      this.state.doc.nodesBetween(from, to, (node) => {
        if (!node.marks.some((m) => m.type === type)) return
        if (!node.marks.every((m) => m.type !== type || m.attrs.href === href)) allMatch = false
      })
    }
    const active = !empty && this.state.doc.rangeHasMark(from, to, type) && allMatch
    if (empty || !active) {
      if (empty) {
        tr.addStoredMark(type.create({ href }))
      } else {
        tr.removeMark(from, to, type)
        tr.addMark(from, to, type.create({ href }))
      }
    } else {
      tr.removeMark(from, to, type)
    }
    this.dispatch(tr)
  }

  toggleList(kind: "bullet" | "ordered"): void {
    const listName = kind === "bullet" ? "bullet_list" : "ordered_list"
    const { $from, $to } = this.state.selection
    const depth = ancestorOfKind($from, listName)
    const tr = this.state.tr
    if (depth === null) {
      const range = $from.blockRange($to)
      if (!range) return
      const listType = editorSchema.nodes[listName]
      const wrapping = findWrapping(range, listType, { tight: true })
      if (!wrapping) return
      tr.wrap(range, wrapping)
    } else {
      const listPos = $from.before(depth)
      const listEnd = $from.after(depth)
      const list = $from.node(depth)
      const inner: PMNode[] = []
      list.forEach((item) => item.forEach((block) => inner.push(block)))
      tr.replaceWith(listPos, listEnd, Fragment.fromArray(inner))
    }
    this.dispatch(tr)
  }

  toggleTaskItem(): void {
    const { $from, $to } = this.state.selection
    const depth = ancestorOfKind($from, "list_item")
    if (depth === null) return
    const tr = this.state.tr
    $from.doc.nodesBetween($from.before(depth), $to.pos, (node, pos) => {
      if (node.type.name === "list_item" && node.attrs.checked !== undefined) {
        tr.setNodeMarkup(pos, null, {
          ...node.attrs,
          checked: node.attrs.checked == null ? true : !node.attrs.checked,
        })
      }
    })
    this.dispatch(tr)
  }

  undo(): boolean {
    return undo(this.state, (tr) => this.dispatch(tr))
  }

  redo(): boolean {
    return redo(this.state, (tr) => this.dispatch(tr))
  }

  undoDepth(): number {
    return undoDepth(this.state)
  }

  /** Replace a textblock's plain text. Only the changed middle range is
   *  replaced, so marks outside the edit survive and typing inside a marked
   *  word inherits that mark. prevText/nextText use "\n" for hard_breaks,
   *  which cost one doc position each — text offsets map 1:1. */
  editBlock(blockPos: number, prevText: string, nextText: string): void {
    if (prevText === nextText) return
    const node = this.state.doc.nodeAt(blockPos)
    if (!node || !node.isTextblock) return
    const contentStart = blockPos + 1
    const contentEnd = blockPos + node.nodeSize - 1
    let prefix = 0
    const maxPrefix = Math.min(prevText.length, nextText.length)
    while (prefix < maxPrefix && prevText[prefix] === nextText[prefix]) prefix++
    let suffix = 0
    const maxSuffix = Math.min(prevText.length - prefix, nextText.length - prefix)
    while (
      suffix < maxSuffix &&
      prevText[prevText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
    ) {
      suffix++
    }
    const from = contentStart + prefix
    const to = contentEnd - suffix
    const inserted = nextText.slice(prefix, nextText.length - suffix)
    const tr = this.state.tr.insertText(inserted, from, to)
    // PM selection follows the edit so input rules and format commands see
    // the caret; the native editor keeps drawing its own caret.
    tr.setSelection(TextSelection.create(tr.doc, from + inserted.length))
    this.dispatch(tr)
    const ruleTr = runInputRules(this.state)
    if (ruleTr) {
      ruleTr.setMeta("appendedTransaction", tr)
      this.dispatch(ruleTr)
    }
  }

  /** Split the textblock at a UTF-16 caret offset (Enter). Inside a list
   *  item the item splits too. Returns the doc position of the new
   *  textblock, or null. */
  splitBlockAt(blockPos: number, caret: number): number | null {
    const doc = this.state.doc
    if (!doc.nodeAt(blockPos)?.isTextblock) return null
    const splitPos = blockPos + 1 + caret
    const $ = doc.resolve(splitPos)
    let depth = 1
    for (let d = $.depth; d > 0; d--) {
      if ($.node(d).type.name === "list_item") {
        depth = $.depth - d + 1
        break
      }
    }
    const tr = this.state.tr.split(splitPos, depth)
    this.dispatch(tr)
    // The second half's textblock starts after the split boundary.
    const after = this.state.doc.resolve(Math.min(splitPos + 2, this.state.doc.content.size))
    return after.depth > 0 ? after.before(after.depth) : null
  }

  /** Merge the textblock into its previous sibling (Backspace at offset 0).
   *  Returns the doc caret position at the join point, or null. */
  joinWithPreviousBlock(blockPos: number): number | null {
    const doc = this.state.doc
    if (!doc.nodeAt(blockPos)) return null
    const $ = doc.resolve(blockPos)
    if (!$.nodeBefore) return null
    const tr = this.state.tr
    tr.join(blockPos)
    this.dispatch(tr)
    return blockPos - 1
  }

  /** Flip the task state of the list item at itemPos. */
  toggleTaskItemAt(itemPos: number): void {
    const node = this.state.doc.nodeAt(itemPos)
    if (!node || node.type.name !== "list_item") return
    const tr = this.state.tr
    tr.setNodeMarkup(itemPos, null, {
      ...node.attrs,
      checked: node.attrs.checked == null ? true : !node.attrs.checked,
    })
    this.dispatch(tr)
  }
}
