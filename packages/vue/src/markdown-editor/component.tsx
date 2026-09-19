import {
  computed,
  defineComponent,
  h,
  nextTick,
  onBeforeUpdate,
  onUnmounted,
  ref,
  watch,
  type PropType,
} from "vue"
import type { Mark, Node as PMNode } from "prosemirror-model"
import { useGpuix } from "../hooks/use-gpuix.js"
import { editorSchema, parseMarkdown, serializeMarkdown } from "./model.js"
import { MarkdownEditorCore } from "./state.js"

/**
 * `<markdown-editor>` — WYSIWYG Markdown editing on gpuiv.
 *
 * Architecture (docs/markdown-editor-plan.md): headless ProseMirror owns the
 * document; every textblock renders as ONE native editable element whose
 * `spans` prop mirrors the block's marks, `decorations` carries highlights,
 * and `selection` moves the caret from JS. Typing flows back through
 * MarkdownEditorCore.editBlock, which patches only the changed range so
 * marks survive. Enter binds to onSubmit (split block); shift-enter inserts
 * a hard break natively — ColaMD/milkdown key semantics.
 */

export interface MarkdownEditorSpan {
  start: number
  end: number
  fontWeight?: number
  fontStyle?: string
  underline?: boolean
  strikethrough?: boolean
  background?: string
  color?: string
  fontFamily?: string
}

export interface MarkdownEditorTheme {
  text: string
  muted: string
  accent: string
  codeBackground: string
  codeText: string
  highlight: string
  quoteBar: string
  monoFont: string
  fontSize: number
  border?: string
  codeBlockBackground?: string
  tableHeaderBackground?: string
  fontFamily?: string
  /** Body line height as a font-size multiplier. */
  lineHeight?: number
  strongText?: string
  codeBlockText?: string
  quoteBackground?: string
  menuBackground?: string
}

const defaultTheme: MarkdownEditorTheme = {
  text: "#e8e8e8",
  muted: "#8a8a8a",
  accent: "#6cb2ff",
  codeBackground: "rgba(127, 127, 127, 0.22)",
  codeText: "#d7a6ff",
  highlight: "rgba(255, 214, 0, 0.35)",
  quoteBar: "#5a5a5a",
  monoFont: "Menlo",
  fontSize: 16,
  border: "#272d34",
  codeBlockBackground: "#161b22",
  tableHeaderBackground: "#161b22",
}

const HEADING_SCALE = [2, 1.5, 1.25, 1, 1, 1]
const HEADING_WEIGHT = [700, 600, 600, 600, 600, 600]
const TASK_CHECKMARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M3.25 8.25 6.5 11.5 12.75 4.75" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

interface EditableRow {
  key: string
  pos: number
  text: string
  spans: MarkdownEditorSpan[]
  /** Position of the enclosing list_item, task or not (⌘⇧9 target). */
  itemPos?: number
  checkbox?: { itemPos: number; checked: boolean }
  decorations?: { start: number; end: number; color: string }[]
}

interface TextRow extends EditableRow {
  kind: "text"
  headingLevel?: number
  info?: string
  fontSize: number
  fontWeight?: number
  mono?: boolean
  indent: number
  quote: boolean
  marker?: string
  markerWidth?: number
  align?: string
}

interface SpacerRow {
  kind: "hr" | "image"
  key: string
  src?: string
  alt?: string
  indent: number
  quote: boolean
}

interface TableCell extends EditableRow {
  key: string
  pos: number
  text: string
  spans: MarkdownEditorSpan[]
  alignment: string | null
  header: boolean
}

interface TableRow {
  kind: "table"
  key: string
  cells: TableCell[]
}

type ViewRow = TextRow | SpacerRow | TableRow

function editableRows(rows: readonly ViewRow[]): EditableRow[] {
  const editable: EditableRow[] = []
  for (const row of rows) {
    if (row.kind === "text") editable.push(row)
    else if (row.kind === "table") editable.push(...row.cells)
  }
  return editable
}

/**
 * Per-instance key allocation for block textareas.
 *
 * Keys must survive the two ways a block changes identity: structural moves
 * (list wrapping moves the paragraph node object) keep the object, input-rule
 * conversions (paragraph -> heading) keep the position but replace the
 * object. Either change recreating the element would drop focus mid-typing,
 * so keys are identity-first with a position fallback.
 *
 * The position map is double-buffered: each render reads fallbacks from the
 * previous render's map and writes a fresh one, so a stale position entry can
 * never hand one key to two live blocks (the wrap→unwrap→Enter bug). Within a
 * render, identity keys of surviving blocks are reserved up front and every
 * fresh key is checked against that taken set, so keys stay unique.
 */
class BlockKeyAllocator {
  private byNode = new WeakMap<PMNode, string>()
  private byPos = new Map<number, string>()
  private counter = 0
  private taken = new Set<string>()
  private nextPos = new Map<number, string>()

  private identityKeys(doc: PMNode): Set<string> {
    const keys = new Set<string>()
    doc.descendants((node) => {
      if (node.isTextblock) {
        const key = this.byNode.get(node)
        if (key) keys.add(key)
      }
      return true
    })
    return keys
  }

  private mint(pos: number): string {
    const positional = `b${pos}`
    if (!this.taken.has(positional)) return positional
    let key = ""
    do {
      key = `g${this.counter++}`
    } while (this.taken.has(key))
    return key
  }

  /** Start a render pass: reserve the identity keys of live textblocks so a
   *  position fallback cannot steal a moved block's key, then allocate into
   *  a fresh position map. */
  beginPass(doc: PMNode): void {
    this.taken = this.identityKeys(doc)
    this.nextPos = new Map()
  }

  /** Allocate the key for one block during a pass (document order). */
  allocate(node: PMNode, pos: number): string {
    let key = this.byNode.get(node)
    if (!key) {
      const fallback = this.byPos.get(pos)
      key = fallback !== undefined && !this.taken.has(fallback) ? fallback : this.mint(pos)
      this.byNode.set(node, key)
    }
    this.taken.add(key)
    this.nextPos.set(pos, key)
    return key
  }

  endPass(): void {
    this.byPos = this.nextPos
  }

  /** The key a block will render with, computed exactly like allocate() but
   *  usable between renders (after split/join/paste): the choice is seeded
   *  into byNode, so the next pass takes the identity path and agrees. */
  resolve(doc: PMNode, pos: number): string | null {
    const node = doc.nodeAt(pos)
    if (!node || !node.isTextblock) return null
    const existing = this.byNode.get(node)
    if (existing) return existing
    const previousTaken = this.taken
    this.taken = this.identityKeys(doc)
    const fallback = this.byPos.get(pos)
    const key = fallback !== undefined && !this.taken.has(fallback) ? fallback : this.mint(pos)
    this.taken = previousTaken
    this.byNode.set(node, key)
    return key
  }

  /** Read-only key lookup for derived computations (search matches): mirrors
   *  the last pass without allocating. */
  peek(node: PMNode, pos: number): string {
    return this.byNode.get(node) ?? this.byPos.get(pos) ?? `b${pos}`
  }
}

/** The last textblock whose node start is strictly before doc position
 *  `pos` — the block a caret at `pos` belongs to (a position on a block-open
 *  boundary reads as the end of the previous block). */
function textblockBefore(doc: PMNode, pos: number): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null
  doc.descendants((node, nodePos) => {
    if (nodePos >= pos) return false
    if (node.isTextblock) {
      found = { node, pos: nodePos }
      return false
    }
    return true
  })
  return found
}

function marksToSpans(
  marks: readonly Mark[],
  from: number,
  to: number,
  theme: MarkdownEditorTheme,
): MarkdownEditorSpan[] {
  const spans: MarkdownEditorSpan[] = []
  for (const mark of marks) {
    const span: MarkdownEditorSpan = { start: from, end: to }
    switch (mark.type.name) {
      case "strong":
        span.fontWeight = 600
        span.color = theme.strongText
        break
      case "em":
        span.fontStyle = "italic"
        break
      case "strikethrough":
        span.strikethrough = true
        break
      case "highlight":
        span.background = theme.highlight
        break
      case "code":
        span.background = theme.codeBackground
        span.color = theme.codeText
        span.fontFamily = theme.monoFont
        break
      case "link":
        span.underline = true
        span.color = theme.accent
        break
      default:
        continue
    }
    spans.push(span)
  }
  return spans
}

/** Plain text ("\n" per hard_break) plus UTF-16 spans from inline marks. */
function flattenInline(
  node: PMNode,
  theme: MarkdownEditorTheme,
): { text: string; spans: MarkdownEditorSpan[] } {
  let text = ""
  const spans: MarkdownEditorSpan[] = []
  node.forEach((child) => {
    if (child.isText) {
      const len = child.text?.length ?? 0
      spans.push(...marksToSpans(child.marks, text.length, text.length + len, theme))
      text += child.text ?? ""
    } else if (child.type.name === "hard_break") {
      text += "\n"
    } else if (child.type.name === "footnote_reference") {
      // One char per atom keeps text offsets aligned with PM positions.
      // \uFFFC renders as the object-replacement glyph; the accent span
      // marks it as a reference until a dedicated chip exists.
      spans.push({
        start: text.length,
        end: text.length + 1,
        color: theme.accent,
        underline: true,
      })
      text += "\uFFFC"
    } else if (child.type.name === "image") {
      // Same one-char atom placeholder as footnote_reference (state.ts maps
      // it back to the image node, attrs intact, on edit).
      text += "\uFFFC"
    }
  })
  return { text, spans }
}

interface WalkContext {
  indent: number
  quote: boolean
  marker?: string
  markerWidth?: number
  itemPos?: number
  checkbox?: { itemPos: number; checked: boolean }
  fontSize?: number
  fontWeight?: number
  mono?: boolean
  tableAlign?: string
}

function walkBlocks(
  node: PMNode,
  contentStart: number,
  ctx: WalkContext,
  theme: MarkdownEditorTheme,
  keyFor: (node: PMNode, pos: number) => string,
  out: ViewRow[],
): void {
  let orderedIndex = 0
  node.forEach((child, offset) => {
    const pos = contentStart + offset
    const base = { indent: ctx.indent, quote: ctx.quote }
    switch (child.type.name) {
      case "paragraph":
      case "heading": {
        const { text, spans } = flattenInline(child, theme)
        const level = child.type.name === "heading" ? (child.attrs.level as number) : 0
        if (ctx.checkbox?.checked && text.length) {
          spans.push({ start: 0, end: text.length, strikethrough: true, color: theme.muted })
        }
        out.push({
          kind: "text",
          headingLevel: level,
          key: keyFor(child, pos),
          pos,
          text,
          spans,
          fontSize: level ? theme.fontSize * HEADING_SCALE[level - 1] : (ctx.fontSize ?? theme.fontSize),
          fontWeight: level ? HEADING_WEIGHT[level - 1] : ctx.fontWeight,
          indent: ctx.indent,
          quote: ctx.quote,
          marker: ctx.marker,
          markerWidth: ctx.markerWidth,
          itemPos: ctx.itemPos,
          checkbox: ctx.checkbox,
          align: ctx.tableAlign,
        })
        break
      }
      case "code_block": {
        out.push({
          kind: "text",
          info: (child.attrs.info as string) || "",
          key: keyFor(child, pos),
          pos,
          text: child.textContent,
          spans: [],
          fontSize: theme.fontSize * 0.875,
          mono: true,
          indent: ctx.indent,
          quote: ctx.quote,
          itemPos: ctx.itemPos,
        })
        break
      }
      case "horizontal_rule":
        out.push({ kind: "hr", key: `hr${pos}`, indent: ctx.indent, quote: ctx.quote })
        break
      case "image":
        out.push({
          kind: "image",
          key: `img${pos}`,
          src: String(child.attrs.src ?? ""),
          alt: child.attrs.alt ? String(child.attrs.alt) : undefined,
          indent: ctx.indent,
          quote: ctx.quote,
        })
        break
      case "blockquote":
        walkBlocks(
          child,
          pos + 1,
          { ...ctx, quote: true, marker: undefined, itemPos: undefined, checkbox: undefined },
          theme,
          keyFor,
          out,
        )
        break
      case "bullet_list":
      case "ordered_list": {
        const ordered = child.type.name === "ordered_list"
        const start = ordered ? ((child.attrs.order as number) || 1) : 1
        orderedIndex = start - 1
        child.forEach((item, itemOffset) => {
          const itemPos = pos + 1 + itemOffset
          orderedIndex++
          const marker = ordered ? `${orderedIndex}.` : "•"
          const checkbox =
            item.attrs.checked !== null && item.attrs.checked !== undefined
              ? { itemPos, checked: item.attrs.checked as boolean }
              : undefined
          const itemCtx: WalkContext = {
            ...ctx,
            indent: ctx.indent + 1,
            marker,
            markerWidth: ordered ? 26 : 18,
            itemPos,
            checkbox,
          }
          walkBlocks(item, itemPos + 1, itemCtx, theme, keyFor, out)
        })
        break
      }
      case "footnote_definition": {
        const defCtx: WalkContext = {
          ...ctx,
          marker: `[^${child.attrs.label ?? ""}]:`,
          markerWidth: 54,
          itemPos: undefined,
          checkbox: undefined,
          fontSize: theme.fontSize * 0.92,
        }
        walkBlocks(child, pos + 1, defCtx, theme, keyFor, out)
        break
      }
      case "table": {
        child.forEach((row, rowOffset) => {
          const rowPos = pos + 1 + rowOffset
          const cells: TableCell[] = []
          row.forEach((cell, cellOffset) => {
            const cellPos = rowPos + 1 + cellOffset
            const { text, spans } = flattenInline(cell, theme)
            cells.push({
              key: `c${keyFor(cell, cellPos)}`,
              pos: cellPos,
              text,
              spans,
              alignment: (cell.attrs.alignment as string) || null,
              header: cell.type.name === "table_header",
            })
          })
          out.push({ kind: "table", key: `trow${rowPos}`, cells })
        })
        break
      }
      default:
        break
    }
  })
}

interface SearchMatch {
  key: string
  start: number
  end: number
}

export const MarkdownEditor = defineComponent({
  name: "MarkdownEditor",
  props: {
    source: { type: String, default: "" },
    theme: { type: Object as PropType<Partial<MarkdownEditorTheme>>, default: () => ({}) },
    searchQuery: { type: String, default: "" },
    searchActiveIndex: { type: Number, default: -1 },
    mode: { type: String as PropType<"wysiwyg" | "source">, default: "wysiwyg" },
    viewportHeight: { type: Number, default: 0 },
  },
  emits: ["change", "searchMatches"],
  setup(props, { emit, expose }) {
    const mergedTheme = computed(() => ({ ...defaultTheme, ...props.theme }) as MarkdownEditorTheme)
    const core = new MarkdownEditorCore(props.source)
    const version = ref(0)
    const keyAlloc = new BlockKeyAllocator()
    // blockTexts: what the PM doc holds (editBlock's `prev`).
    // nativeTexts: what the native editor holds (its last change report).
    // When they diverge (input rule, undo, formatting rewrote the block),
    // bump that block's valueRevision so Rust resyncs authoritatively —
    // the value prop alone cannot express "same value, new content".
    const blockTexts = new Map<string, string>()
    const nativeTexts = new Map<string, string>()
    const revisions = new Map<string, number>()
    const selections = new Map<string, [number, number]>()
    const pendingSelectionProps = new Map<string, [number, number]>()
    // Cross-block selection. `nativeKey` is the textarea that owns the real
    // native range during a drag; its selection paint must not be duplicated
    // by the document-level decorations.
    const docSelection = ref<
      | null
      | {
          fromKey: string
          fromPos: number
          fromOffset: number
          toKey: string
          toPos: number
          toOffset: number
          nativeKey?: string
        }
    >(null)
    let pendingExtend: { key: string; offset: number } | null = null
    let focusedKey: string | null = null
    let prevFocusedKey: string | null = null
    let suppressDragReleaseClick = false
    let dragReleaseTimer: ReturnType<typeof setTimeout> | null = null
    const flashKey = ref<string | null>(null)
    let flashTimer: ReturnType<typeof setTimeout> | null = null
    const sourceText = ref(props.source)
    const rootId = ref<number | null>(null)
    const collectRootRef = (el: unknown) => {
      rootId.value = (el as { id?: number } | null)?.id ?? null
    }
    let lastMatchCount = -1
    const pendingFocus = ref<{ key: string; head: number; anchor: number } | null>(null)
    // The rows of the latest render: rowOrder() and keyPositions read them
    // from event handlers, where re-walking the doc would allocate keys a
    // second time.
    let lastRows: ViewRow[] = []
    const keyPositions = new Map<string, number>()

    const hostIds = new Map<string, number>()
    const collectRef = (key: string) => (el: unknown) => {
      const id = (el as { id?: number } | null)?.id
      if (typeof id === "number") hostIds.set(key, id)
      else hostIds.delete(key)
    }

    // inject() only works during setup — capture the context once.
    const gpuixContext = useGpuix()
    const getRenderer = () => gpuixContext.renderer

    onBeforeUpdate(() => {
      hostIds.clear()
    })
    onUnmounted(() => {
      if (flashTimer) clearTimeout(flashTimer)
      if (dragReleaseTimer) clearTimeout(dragReleaseTimer)
    })

    /** Every case-insensitive match of searchQuery, in document order.
     *  Keys resolve read-only through the allocator (peek), so this never
     *  allocates. Recomputed on doc edits via `version`. */
    const searchMatches = computed((): SearchMatch[] => {
      void version.value
      const query = props.searchQuery.trim()
      if (!query) return []
      const needle = query.toLowerCase()
      const out: ViewRow[] = []
      walkBlocks(
        core.state.doc,
        0,
        { indent: 0, quote: false },
        mergedTheme.value,
        (node, pos) => keyAlloc.peek(node, pos),
        out,
      )
      const matches: SearchMatch[] = []
      for (const row of editableRows(out)) {
        const lower = row.text.toLowerCase()
        let at = lower.indexOf(needle)
        while (at !== -1) {
          matches.push({ key: row.key, start: at, end: at + query.length })
          at = lower.indexOf(needle, at + needle.length)
        }
      }
      return matches
    })

    const rows = (): ViewRow[] => {
      // touch version for reactivity
      void version.value
      const theme = mergedTheme.value
      const out: ViewRow[] = []
      keyAlloc.beginPass(core.state.doc)
      walkBlocks(core.state.doc, 0, { indent: 0, quote: false }, theme, (node, pos) => keyAlloc.allocate(node, pos), out)
      keyAlloc.endPass()
      lastRows = out
      keyPositions.clear()
      const matchesByKey = new Map<string, { start: number; end: number; index: number }[]>()
      searchMatches.value.forEach((match, index) => {
        const list = matchesByKey.get(match.key)
        const entry = { start: match.start, end: match.end, index }
        if (list) list.push(entry)
        else matchesByKey.set(match.key, [entry])
      })
      // One order list per render for the cross-block selection decoration,
      // not one re-walk per row.
      const sel = docSelection.value
      const editable = editableRows(out)
      const liveKeys = new Set(editable.map((row) => row.key))
      const order = sel ? editable.map((row) => row.key) : null
      const orderIndex = order ? new Map(order.map((key, index) => [key, index])) : null
      const fromIndex = sel && orderIndex ? (orderIndex.get(sel.fromKey) ?? -1) : -1
      const toIndex = sel && orderIndex ? (orderIndex.get(sel.toKey) ?? -1) : -1
      for (const row of editable) {
        keyPositions.set(row.key, row.pos)
        blockTexts.set(row.key, row.text)
        const known = nativeTexts.get(row.key)
        if (known === undefined || known !== row.text) {
          if (known !== undefined) {
            revisions.set(row.key, (revisions.get(row.key) ?? 0) + 1)
          }
          nativeTexts.set(row.key, row.text)
        }
        const rowMatches = matchesByKey.get(row.key)
        if (rowMatches) {
          row.decorations = rowMatches.map((match) => ({
            start: match.start,
            end: match.end,
            color:
              match.index === props.searchActiveIndex
                ? "rgba(255, 170, 0, 0.75)"
                : "rgba(255, 214, 0, 0.35)",
          }))
        }
        if (sel && orderIndex && fromIndex !== -1 && toIndex !== -1) {
          const index = orderIndex.get(row.key) ?? -1
          if (index >= fromIndex && index <= toIndex && row.key !== sel.nativeKey) {
            const start = index === fromIndex ? sel.fromOffset : 0
            const end = index === toIndex ? sel.toOffset : row.text.length
            if (end > start) {
              row.decorations = [
                ...(row.decorations ?? []),
                { start, end, color: "rgba(124, 134, 255, 0.35)" },
              ]
            }
          }
        }
      }
      // Split/join-heavy sessions mint new identity keys. Keep the per-block
      // mirrors bounded to the current document instead of retaining every
      // deleted block for the lifetime of the component.
      for (const map of [blockTexts, nativeTexts, revisions, selections, pendingSelectionProps]) {
        for (const key of map.keys()) {
          if (!liveKeys.has(key)) map.delete(key)
        }
      }
      return out
    }

    const getMarkdown = () => (props.mode === "source" ? sourceText.value : core.getMarkdown())
    const touch = () => {
      // Any edit invalidates the cross-block selection: its positions are
      // pre-edit coordinates and would decorate/copy the wrong ranges.
      docSelection.value = null
      version.value++
      emit("change", core.getMarkdown())
    }

    const focusBlock = (key: string, head: number, anchor = head) => {
      pendingFocus.value = { key, head, anchor }
      void nextTick(() => {
        const target = pendingFocus.value
        pendingFocus.value = null
        if (!target) return
        const renderer = getRenderer()
        const id = hostIds.get(target.key)
        if (renderer?.focusElement && id !== undefined) {
          renderer.focusElement(id)
          selections.set(target.key, [target.anchor, target.head])
        }
      })
    }

    /** Focus the textblock whose content spans doc position `pos`, caret at
     *  exactly that offset (not the block end, which is where the
     *  value-resync would otherwise leave it). */
    const focusDocPosition = (pos: number) => {
      const hit = textblockBefore(core.state.doc, pos)
      if (!hit) return
      const key = keyAlloc.resolve(core.state.doc, hit.pos)
      if (key === null) return
      const caret = Math.max(0, Math.min(pos - hit.pos - 1, hit.node.content.size))
      pendingSelectionProps.set(key, [caret, caret])
      focusBlock(key, caret)
    }

    const onBlockChange = (row: EditableRow) => (event: { value?: string | null }) => {
      const prev = blockTexts.get(row.key) ?? row.text
      const next = event.value ?? ""
      blockTexts.set(row.key, next)
      nativeTexts.set(row.key, next)
      core.editBlock(row.pos, prev, next)
      touch()
    }

    const onBlockSubmit = (row: TextRow) => {
      const caret = selections.get(row.key)?.[1] ?? row.text.length
      const newPos = core.splitBlockAt(row.pos, caret)
      touch()
      if (newPos !== null) focusDocPosition(newPos + 1)
    }

    const onBlockKeyDown =
      (row: EditableRow, allowBlockCommands = true) =>
      (event: { key?: string; modifiers?: Record<string, boolean> }) => {
      const key = event.key ?? ""
      const mods = event.modifiers ?? {}
      const selection = selections.get(row.key) ?? [row.text.length, row.text.length]
      const [anchor, head] = selection
      const contentStart = row.pos + 1
      if (mods.cmd || mods.ctrl) {
        if (allowBlockCommands && key === "enter") {
          if (row.checkbox) {
            core.toggleTaskItemAt(row.checkbox.itemPos)
            touch()
          }
          return
        }
        // milkdown list keys: cmd-shift-7 ordered, cmd-shift-8 bullet,
        // cmd-shift-9 task (plain items become checked tasks).
        if (allowBlockCommands && mods.shift && (key === "7" || key === "8" || key === "9")) {
          if (anchor === head) core.setSelection(contentStart + head)
          else core.setSelection(contentStart + anchor, contentStart + head)
          if (key === "8") core.toggleList("bullet")
          else if (key === "7") core.toggleList("ordered")
          else if (row.itemPos !== undefined) core.toggleTaskItemAt(row.itemPos)
          touch()
          return
        }
        const mark = (() => {
          if (key === "b") return "strong"
          if (key === "i") return "em"
          if (key === "e") return "code"
          if (key === "x" && mods.shift) return "strikethrough"
          if (key === "h" && mods.shift) return "highlight"
          return null
        })()
        if (mark) {
          if (anchor === head) {
            core.setSelection(contentStart + head)
          } else {
            core.setSelection(contentStart + anchor, contentStart + head)
          }
          if (mark === "code") core.toggleMark("code")
          else if (mark === "strikethrough") core.toggleMark("strikethrough")
          else if (mark === "highlight") core.toggleMark("highlight")
          else core.toggleMark(mark as "strong" | "em")
          touch()
          return
        }
        if (key === "k" && !mods.shift) {
          const renderer = getRenderer()
          const url = renderer?.readClipboardText?.()
          if (!url) return
          if (anchor === head) core.setSelection(contentStart + head)
          else core.setSelection(contentStart + anchor, contentStart + head)
          core.toggleLink(url.trim())
          touch()
          return
        }
        return
      }
    }

    // Backspace is a native keybinding, so keyDown never reaches JS. A press
    // with an empty selection at offset 0 is a native no-op and arrives here
    // instead — the component owns the cross-block join.
    const onBlockBackspaceStart = (row: TextRow) => () => {
      const before = core.state
      const caret = core.joinWithPreviousBlock(row.pos)
      if (caret === null) return
      // Unjoinable predecessors (list/table/code/quote) leave the doc
      // untouched and just hand back the caret target — no change to emit.
      if (core.state !== before) touch()
      focusDocPosition(caret)
    }

    const onBlockSelectionChange =
      (row: EditableRow) => (event: { startIndex?: number; endIndex?: number }) => {
        const anchor = event.startIndex ?? 0
        const head = event.endIndex ?? anchor
        selections.set(row.key, [anchor, head])
        // A caret event implies this block holds focus.
        if (focusedKey !== row.key) {
          prevFocusedKey = focusedKey
          focusedKey = row.key
        }
        if (pendingExtend && pendingExtend.key !== row.key) {
          const from = pendingExtend
          pendingExtend = null
          setDocSelection(from, { key: row.key, offset: head })
        }
      }

    const setDocSelection = (
      from: { key: string; offset: number },
      to: { key: string; offset: number },
      nativeKey?: string,
    ) => {
      const order = rowOrder()
      const fromIndex = order.indexOf(from.key)
      const toIndex = order.indexOf(to.key)
      if (fromIndex === -1 || toIndex === -1) return
      const [start, end] =
        fromIndex <= toIndex
          ? [
              { ...from, pos: rowPosOf(from.key) },
              { ...to, pos: rowPosOf(to.key) },
            ]
          : [
              { ...to, pos: rowPosOf(to.key) },
              { ...from, pos: rowPosOf(from.key) },
            ]
      docSelection.value = {
        fromKey: start.key,
        fromPos: start.pos,
        fromOffset: start.offset,
        toKey: end.key,
        toPos: end.pos,
        toOffset: end.offset,
        nativeKey,
      }
      version.value++
    }

    const rowOrder = (): string[] => editableRows(lastRows).map((row) => row.key)

    const rowPosOf = (key: string): number => keyPositions.get(key) ?? 0

    const caretOf = (key: string): number => selections.get(key)?.[1] ?? blockTexts.get(key)?.length ?? 0

    /** Resolve a window-space drag point to the nearest live editor and its
     *  exact native UTF-16 offset. Nearest-rect behavior bridges the gaps
     *  between Markdown blocks and disambiguates table cells by x. */
    const editableAtPoint = (
      x: number,
      y: number,
    ): { key: string; offset: number } | null => {
      const renderer = getRenderer()
      if (!renderer) return null
      const candidates = editableRows(lastRows).flatMap((row) => {
        const id = hostIds.get(row.key)
        return id === undefined ? [] : [{ key: row.key, id }]
      })
      if (renderer.getInputTextHit) {
        const [hitId, offset] = renderer.getInputTextHit(
          candidates.map((candidate) => candidate.id),
          x,
          y,
        )
        const hit = candidates.find((candidate) => candidate.id === hitId)
        return hit && offset >= 0 ? { key: hit.key, offset } : null
      }
      // Compatibility fallback for custom renderers that implement the two
      // older measurement calls but not the batched native hit-test.
      if (!renderer.getElementBounds || !renderer.getInputTextOffset) return null
      let best: { key: string; id: number; score: number } | null = null
      for (const candidate of candidates) {
        const { id, key } = candidate
        const bounds = renderer.getElementBounds(id)
        if (!bounds) continue
        const dx =
          x < bounds.x
            ? bounds.x - x
            : x > bounds.x + bounds.width
              ? x - bounds.x - bounds.width
              : 0
        const dy =
          y < bounds.y
            ? bounds.y - y
            : y > bounds.y + bounds.height
              ? y - bounds.y - bounds.height
              : 0
        const score = dx * dx + dy * dy
        if (!best || score < best.score) best = { key, id, score }
      }
      if (!best) return null
      const offset = renderer.getInputTextOffset(best.id, x, y)
      return offset >= 0 ? { key: best.key, offset } : null
    }

    const onBlockSelectionDrag =
      (row: EditableRow) =>
      (event: { x?: number; y?: number; value?: string; startIndex?: number; endIndex?: number }) => {
        if (event.value === "end") {
          suppressDragReleaseClick = docSelection.value?.nativeKey === row.key
          if (dragReleaseTimer) clearTimeout(dragReleaseTimer)
          dragReleaseTimer = setTimeout(() => {
            suppressDragReleaseClick = false
            dragReleaseTimer = null
          }, 0)
          return
        }
        if (event.x === undefined || event.y === undefined) return
        const hit = editableAtPoint(event.x, event.y)
        if (!hit) return
        if (hit.key === row.key) {
          if (docSelection.value) {
            docSelection.value = null
            version.value++
          }
          return
        }
        const anchor = event.startIndex ?? selections.get(row.key)?.[0] ?? 0
        setDocSelection({ key: row.key, offset: anchor }, hit, row.key)
      }

    // Editor mouse events do not bubble past the native element, but `click`
    // carries modifiers — shift-click on another block extends the selection
    // from the previously focused block's caret.
    const onBlockClick = (row: TextRow) => (event: { modifiers?: Record<string, boolean> }) => {
      if (suppressDragReleaseClick) {
        suppressDragReleaseClick = false
        if (dragReleaseTimer) clearTimeout(dragReleaseTimer)
        dragReleaseTimer = null
        return
      }
      const mods = event.modifiers ?? {}
      const anchorKey = focusedKey !== row.key ? focusedKey : prevFocusedKey
      if (mods.shift && anchorKey && anchorKey !== row.key) {
        // The caret in this block moved on mouse-down; its selectionChange
        // may have arrived before this click — read the fresh offset, and
        // keep the pending arm for the opposite order.
        setDocSelection(
          { key: anchorKey, offset: caretOf(anchorKey) },
          { key: row.key, offset: caretOf(row.key) },
        )
        return
      }
      docSelection.value = null
    }

    const serializeDocSelection = (): string | null => {
      const sel = docSelection.value
      if (!sel || sel.fromKey === sel.toKey) return null
      const from = sel.fromPos + 1 + sel.fromOffset
      const to = sel.toPos + 1 + sel.toOffset
      if (to <= from) return null
      const slice = core.state.doc.slice(from, to)
      const wrapped = editorSchema.topNodeType.createAndFill(null, slice.content)
      return wrapped ? serializeMarkdown(wrapped, core.getMarkerStyle()) : null
    }

    /** Serialize a native selection from one editable block. The native
     *  textarea only knows its flattened text, so copying it directly would
     *  silently turn `**bold**`, links, and inline code into plain text. */
    const serializeBlockSelection = (row: EditableRow, start: number, end: number): string | null => {
      if (end <= start) return null
      const node = core.state.doc.nodeAt(row.pos)
      if (!node?.isTextblock) return null
      const from = Math.max(0, Math.min(start, node.content.size))
      const to = Math.max(from, Math.min(end, node.content.size))
      if (to <= from) return null
      const selected = node.cut(from, to)
      // Table cells are textblocks but not top-level `block` nodes. Copy their
      // inline content through a paragraph while retaining every mark.
      const block = selected.type.isInGroup("block")
        ? selected
        : editorSchema.nodes.paragraph.create(null, selected.content)
      const doc = editorSchema.topNodeType.create(null, block)
      return serializeMarkdown(doc, core.getMarkerStyle()).replace(/\n$/, "")
    }

    /** Delete the cross-block selection through the model. Returns the doc
     *  position the caret should land on (the selection start). */
    const deleteDocSelection = (): number | null => {
      const sel = docSelection.value
      if (!sel) return null
      const from = sel.fromPos + 1 + sel.fromOffset
      const to = sel.toPos + 1 + sel.toOffset
      if (to <= from) return null
      // deleteRange degrades gracefully across structure boundaries (tables)
      // where a raw tr.delete would throw.
      core.dispatch(core.state.tr.deleteRange(from, to))
      return from
    }

    // cmd-c/cmd-x/cmd-v are native keybindings: the actions consume the
    // keystroke before keyDown reaches JS, so editors opt into interception
    // and the component serializes (cross-block markdown), deletes, or
    // re-inserts parsed blocks itself.
    //
    // The copy/cut helpers are shared by the keyboard events (range from the
    // native event payload) and the context menu (range from the tracked
    // selection of the right-clicked block).
    const selectionRangeOf = (
      key: string,
      event?: { startIndex?: number; endIndex?: number },
    ): [number, number] => {
      const tracked = selections.get(key)
      const start = event?.startIndex ?? tracked?.[0] ?? 0
      const end = event?.endIndex ?? tracked?.[1] ?? start
      return [Math.min(start, end), Math.max(start, end)]
    }

    const copyBlockSelection = (
      row: EditableRow,
      event?: { startIndex?: number; endIndex?: number },
    ): void => {
      const renderer = getRenderer()
      if (!renderer?.writeClipboardText) return
      const markdown = serializeDocSelection()
      if (markdown !== null) {
        renderer.writeClipboardText(markdown)
        return
      }
      const [start, end] = selectionRangeOf(row.key, event)
      if (end > start) {
        const markdown = serializeBlockSelection(row, start, end)
        renderer.writeClipboardText(
          markdown ?? (blockTexts.get(row.key) ?? row.text).slice(start, end),
        )
      }
    }

    const cutBlockSelection = (
      row: EditableRow,
      event?: { startIndex?: number; endIndex?: number },
    ): void => {
      const renderer = getRenderer()
      if (!renderer?.writeClipboardText) return
      const markdown = serializeDocSelection()
      if (markdown !== null) {
        renderer.writeClipboardText(markdown)
        const caret = deleteDocSelection()
        touch()
        if (caret !== null) focusDocPosition(caret)
        return
      }
      const [start, end] = selectionRangeOf(row.key, event)
      if (end <= start) return
      const text = blockTexts.get(row.key) ?? row.text
      renderer.writeClipboardText(serializeBlockSelection(row, start, end) ?? text.slice(start, end))
      // Native does not delete under interceptClipboard — the component owns it.
      core.editBlock(row.pos, text, text.slice(0, start) + text.slice(end))
      selections.set(row.key, [start, start])
      pendingSelectionProps.set(row.key, [start, start])
      touch()
    }

    const onBlockCopy = (row: EditableRow) => (event: { startIndex?: number; endIndex?: number }) => {
      copyBlockSelection(row, event)
    }

    const onBlockCut = (row: EditableRow) => (event: { startIndex?: number; endIndex?: number }) => {
      cutBlockSelection(row, event)
    }

    const onBlockPaste = (row: EditableRow, inTable = false) => (event: { value?: string | null }) => {
      const text = event.value ?? ""
      if (!text) return
      let prev = blockTexts.get(row.key) ?? row.text
      const [anchor, head] = selections.get(row.key) ?? [prev.length, prev.length]
      const selStart = Math.min(anchor, head, prev.length)
      const selEnd = Math.min(Math.max(anchor, head), prev.length)
      const caret = selStart
      if (selEnd > selStart) {
        // Paste is intercepted: the native editor left its content untouched,
        // so the covered range is removed through the model first.
        const without = prev.slice(0, selStart) + prev.slice(selEnd)
        core.editBlock(row.pos, prev, without)
        prev = without
      }
      const node = core.state.doc.nodeAt(row.pos)
      if (!node || !node.isTextblock) return
      const isCode = node.type.spec.code === true
      // Structure beats a newline heuristic: parse the text and insert as
      // blocks when it is anything but a single plain paragraph ("- a\n- b"
      // must become a list, not literal text). Code blocks and table cells
      // always take the text literally.
      const parsed = !isCode && !inTable ? parseMarkdown(text) : null
      const structured =
        parsed !== null &&
        parsed.childCount > 0 &&
        (parsed.childCount > 1 || parsed.firstChild?.type.name !== "paragraph")
      if (isCode || structured) {
        core.insertMarkdownAt(row.pos, caret, text)
        touch()
        if (isCode) {
          // Raw insert: the caret lands right after the pasted text.
          focusDocPosition(row.pos + 1 + caret + text.length)
        } else if (parsed) {
          // After the last inserted block. At the block end insertMarkdownAt
          // appends siblings; mid-block it splits first and inserts between.
          const end =
            caret >= node.content.size
              ? row.pos + node.nodeSize + parsed.content.size
              : row.pos + 1 + caret + 1 + parsed.content.size
          focusDocPosition(end)
        }
        return
      }
      const next = prev.slice(0, caret) + text + prev.slice(caret)
      core.editBlock(row.pos, prev, next)
      // The authoritative resync lands the caret at the block end
      // (set_external_text); push the intended caret through the selection
      // prop instead.
      const after = caret + text.length
      selections.set(row.key, [after, after])
      pendingSelectionProps.set(row.key, [after, after])
      touch()
    }

    // Registering undo/redo listeners makes the native editor skip its own
    // undo stack: PM history is the single source of truth.
    const onBlockUndo = () => {
      if (!core.undo()) return
      touch()
      focusDocPosition(core.state.selection.head)
    }

    const onBlockRedo = () => {
      if (!core.redo()) return
      touch()
      focusDocPosition(core.state.selection.head)
    }

    // cmd-a is a native keybinding; text rows register a `selectAll` listener
    // so the native editor reports the intent instead of selecting locally.
    // A single text block keeps element-local behavior through the selection
    // prop (the tracked selection must move for copy/cut and format
    // shortcuts); multiple blocks become a cross-block docSelection.
    const selectAllBlocks = () => {
      const textRows = lastRows.filter((row): row is TextRow => row.kind === "text")
      const first = textRows[0]
      const last = textRows[textRows.length - 1]
      if (!first || !last) return
      if (first.key === last.key) {
        const len = (blockTexts.get(first.key) ?? first.text).length
        selections.set(first.key, [0, len])
        pendingSelectionProps.set(first.key, [0, len])
        version.value++
        return
      }
      setDocSelection(
        { key: first.key, offset: 0 },
        { key: last.key, offset: (blockTexts.get(last.key) ?? last.text).length },
      )
    }

    // ── Context menu ─────────────────────────────────────────────────
    // Right-click on a text row (or the source textarea) opens a small
    // floating menu at the event's window coordinates. `key` is the
    // right-clicked block's key; null in source mode.
    const contextMenu = ref<{ x: number; y: number; key: string | null } | null>(null)
    // Tracked selection of the source textarea (it has no per-block map).
    let sourceSelection: [number, number] = [0, 0]
    let pendingSourceSelection: [number, number] | null = null

    /** A pending source selection applies once; consuming the slot re-arms
     *  it, so a repeated same-value request is not dropped by Rust's dedupe. */
    const consumeSourceSelection = (): [number, number] | undefined => {
      const pending = pendingSourceSelection
      pendingSourceSelection = null
      return pending ?? undefined
    }

    const onBlockContextMenu = (row: EditableRow) => (event: { x?: number; y?: number }) => {
      // Opening the menu must not clear an active docSelection: the native
      // right-button press only moved the element caret, and the menu's
      // Copy/Cut read the cross-block selection first.
      contextMenu.value = { x: event.x ?? 0, y: event.y ?? 0, key: row.key }
    }

    const onSourceContextMenu = (event: { x?: number; y?: number }) => {
      contextMenu.value = { x: event.x ?? 0, y: event.y ?? 0, key: null }
    }

    /** The current editable row for a key — rows from the render where the menu
     *  opened can be stale by the time an action runs. */
    const rowForKey = (key: string): EditableRow | null =>
      editableRows(lastRows).find((row) => row.key === key) ?? null

    const orderedSourceSelection = (): [number, number] => {
      const [anchor, head] = sourceSelection
      return [Math.min(anchor, head), Math.max(anchor, head)]
    }

    type MenuTarget = { x: number; y: number; key: string | null }

    const menuCopy = (menu: MenuTarget) => {
      const renderer = getRenderer()
      if (menu.key === null) {
        const [start, end] = orderedSourceSelection()
        const text = sourceText.value
        if (end > start) renderer?.writeClipboardText?.(text.slice(start, end))
        return
      }
      const row = rowForKey(menu.key)
      if (row) copyBlockSelection(row)
    }

    const menuCut = (menu: MenuTarget) => {
      const renderer = getRenderer()
      if (menu.key === null) {
        const [start, end] = orderedSourceSelection()
        const text = sourceText.value
        if (end <= start) return
        renderer?.writeClipboardText?.(text.slice(start, end))
        sourceText.value = text.slice(0, start) + text.slice(end)
        sourceSelection = [start, start]
        pendingSourceSelection = [start, start]
        emit("change", sourceText.value)
        return
      }
      const row = rowForKey(menu.key)
      if (row) cutBlockSelection(row)
    }

    const menuPaste = (menu: MenuTarget) => {
      const renderer = getRenderer()
      const text = renderer?.readClipboardText?.()
      if (!text) return
      if (menu.key === null) {
        const [start, end] = orderedSourceSelection()
        const prev = sourceText.value
        sourceText.value = prev.slice(0, start) + text + prev.slice(end)
        const after = start + text.length
        sourceSelection = [after, after]
        pendingSourceSelection = [after, after]
        emit("change", sourceText.value)
        return
      }
      const row = rowForKey(menu.key)
      // The same pipeline as a native paste: structured markdown inserts as
      // blocks, code blocks stay literal, the caret is restored.
      if (row) onBlockPaste(row)({ value: text })
    }

    const menuSelectAll = (menu: MenuTarget) => {
      if (menu.key === null) {
        sourceSelection = [0, sourceText.value.length]
        pendingSourceSelection = [0, sourceText.value.length]
        return
      }
      selectAllBlocks()
    }

    const toggleTask = (itemPos: number) => {
      core.toggleTaskItemAt(itemPos)
      touch()
    }

    // Scroll offsets are negative pixel values (scroll down = more negative
    // y), so "max scroll" is probed with a large negative offset.
    const captureScrollRatio = (): number => {
      const renderer = getRenderer()
      if (!renderer?.scrollTo || !renderer.getScrollOffset || rootId.value == null) return 0
      const before = renderer.getScrollOffset(rootId.value)
      if (!before) return 0
      renderer.scrollTo(rootId.value, 0, -1e9)
      const max = renderer.getScrollOffset(rootId.value)
      renderer.scrollTo(rootId.value, 0, before[1] ?? 0)
      const maxY = max?.[1] ?? 0
      return maxY < 0 ? (before[1] ?? 0) / maxY : 0
    }

    const restoreScrollRatio = (ratio: number): void => {
      const renderer = getRenderer()
      if (!renderer?.scrollTo || !renderer.getScrollOffset || rootId.value == null) return
      renderer.scrollTo(rootId.value, 0, -1e9)
      const max = renderer.getScrollOffset(rootId.value)
      if (!max) return
      renderer.scrollTo(rootId.value, 0, ratio * (max[1] ?? 0))
    }

    /** A pending selection applies once; consuming the entry re-arms it, so a
     *  repeated same-value request is not dropped by Rust's dedupe. */
    const consumePendingSelection = (key: string): [number, number] | undefined => {
      const pending = pendingSelectionProps.get(key)
      if (pending) pendingSelectionProps.delete(key)
      return pending
    }

    const clearBlockState = () => {
      blockTexts.clear()
      nativeTexts.clear()
      revisions.clear()
      selections.clear()
      pendingSelectionProps.clear()
      docSelection.value = null
      pendingExtend = null
      focusedKey = null
      prevFocusedKey = null
      contextMenu.value = null
    }

    watch(
      () => props.mode,
      (mode) => {
        const ratio = captureScrollRatio()
        if (mode === "source") {
          sourceText.value = core.getMarkdown()
        } else {
          core.reset(sourceText.value)
          clearBlockState()
        }
        version.value++
        void nextTick(() => restoreScrollRatio(ratio))
      },
    )

    watch(
      () => props.source,
      (source) => {
        if (props.mode === "source") {
          if (source !== sourceText.value) sourceText.value = source
          return
        }
        // A parent feeding `change` back into `source` must not flush the
        // undo history — only reset on a genuine external replacement.
        if (source === core.getMarkdown()) return
        core.reset(source)
        clearBlockState()
        version.value++
      },
    )

    // Focus the active match only on pure next/prev navigation: the index
    // changed while the query stayed put. A query change means the user is
    // typing in the find box — focusing the match then would yank the caret
    // out of the search input on the first keystroke. Decorations follow the
    // query through rows() regardless.
    watch(
      [() => props.searchQuery, () => props.searchActiveIndex],
      ([query, active], [prevQuery, prevActive]) => {
        if (query !== prevQuery || active === prevActive) return
        const trimmed = query.trim()
        if (!trimmed || active < 0) return
        const match = searchMatches.value[active]
        if (!match) return
        pendingSelectionProps.set(match.key, [match.start, match.end])
        focusBlock(match.key, match.end, match.start)
      },
    )

    watch(
      searchMatches,
      (matches) => {
        if (matches.length !== lastMatchCount) {
          lastMatchCount = matches.length
          emit("searchMatches", matches.length)
        }
      },
      { immediate: true },
    )

    const jumpToHeading = (text: string): boolean => {
      let foundPos: number | null = null
      core.state.doc.descendants((node, pos) => {
        if (foundPos !== null) return false
        if (node.type.name === "heading" && node.textContent.trim() === text.trim()) {
          foundPos = pos
          return false
        }
        return true
      })
      if (foundPos === null) return false
      const key = keyAlloc.resolve(core.state.doc, foundPos)
      if (key === null) return false
      if (flashTimer) clearTimeout(flashTimer)
      flashKey.value = key
      flashTimer = setTimeout(() => {
        flashKey.value = null
      }, 1400)
      focusBlock(key, 0)
      return true
    }

    expose({
      getMarkdown,
      core: () => core,
      focusBlockByKey: (key: string, caret: number) => focusBlock(key, caret),
      jumpToHeading,
    })

    const rootStyle = () => ({
      width: "100%",
      height: props.viewportHeight > 0 ? props.viewportHeight : undefined,
      overflow: props.viewportHeight > 0 ? ("scroll" as const) : undefined,
      // Anchor for the context-menu overlay (absolute children anchor to the
      // nearest positioned parent).
      position: "relative" as const,
    })

    // Source mode fills the visible column: a full-height flex column root
    // with the textarea growing into it, so a short document no longer
    // leaves a small strip and a long document scrolls as one surface.
    const sourceRootStyle = () => ({
      width: "100%",
      height: props.viewportHeight > 0 ? props.viewportHeight : undefined,
      minHeight: props.viewportHeight > 0 ? 0 : "100%",
      flexGrow: 1,
      overflow: props.viewportHeight > 0 ? ("scroll" as const) : undefined,
      display: "flex",
      flexDirection: "column" as const,
      position: "relative" as const,
    })

    /** Window coordinates from the contextMenu event, re-expressed relative
     *  to the editor root so the absolute-positioned menu lands under the
     *  pointer. A scrolling root (viewportHeight) offsets content by its
     *  scroll offset, which is negative when scrolled down. */
    const menuPosition = (x: number, y: number): { left: number; top: number } => {
      const renderer = getRenderer()
      const bounds = rootId.value != null ? renderer?.getElementBounds?.(rootId.value) : null
      if (!bounds) return { left: x, top: y }
      let top = y - bounds.y
      const id = rootId.value
      const scroll = id != null ? renderer?.getScrollOffset?.(id) : null
      if (scroll) top -= scroll[1]
      return { left: x - bounds.x, top }
    }

    const renderContextMenu = (theme: MarkdownEditorTheme): ReturnType<typeof h>[] => {
      const menu = contextMenu.value
      if (!menu) return []
      const { left, top } = menuPosition(menu.x, menu.y)
      const close = () => {
        contextMenu.value = null
      }
      const item = (label: string, testId: string, action: (menu: MenuTarget) => void) =>
        h(
          "div",
          {
            key: testId,
            testId,
            onClick: () => {
              // Snapshot before closing: the actions read the target from it.
              const snapshot = contextMenu.value
              close()
              if (snapshot) action(snapshot)
            },
            style: {
              paddingTop: 4,
              paddingBottom: 4,
              paddingLeft: 12,
              paddingRight: 12,
              fontSize: 12,
              color: theme.text,
            },
          },
          () => [label],
        )
      return [
        // The backdrop swallows the click that dismisses the menu; it never
        // reaches the blocks below, so their click handlers (and the
        // docSelection they clear) stay untouched.
        h("div", {
          key: "md-menu-backdrop",
          testId: "md-menu-backdrop",
          onClick: close,
          style: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
        }),
        h(
          "div",
          {
            key: "md-menu",
            testId: "md-menu",
            style: {
              position: "absolute",
              left,
              top,
              minWidth: 140,
              backgroundColor: theme.menuBackground ?? "#262626",
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 6,
              paddingTop: 4,
              paddingBottom: 4,
            },
          },
          () => [
            item("Copy", "md-menu-copy", menuCopy),
            item("Cut", "md-menu-cut", menuCut),
            item("Paste", "md-menu-paste", menuPaste),
            item("Select All", "md-menu-select-all", menuSelectAll),
          ],
        ),
      ]
    }

    return () => {
      const theme = mergedTheme.value
      if (props.mode === "source") {
        return h("div", { ref: collectRootRef, style: sourceRootStyle() }, () => [
          h("textarea", {
            key: "md-source",
            ref: collectRef("md-source"),
            testId: "md-source",
            value: sourceText.value,
            minRows: 4,
            // Disable the native textarea's default 10-row clamp. The source
            // editor grows to its complete wrapped content; the one outer
            // scroll container owns scrolling for the whole document.
            maxRows: Math.max(4, sourceText.value.length + 1),
            selection: consumeSourceSelection(),
            onChange: (event: { value?: string | null }) => {
              sourceText.value = event.value ?? ""
              emit("change", sourceText.value)
            },
            onSelectionChange: (event: { startIndex?: number; endIndex?: number }) => {
              const anchor = event.startIndex ?? 0
              sourceSelection = [anchor, event.endIndex ?? anchor]
              const id = hostIds.get("md-source")
              if (id !== undefined) getRenderer()?.scrollInputCaretIntoView?.(id)
            },
            onContextMenu: onSourceContextMenu,
            style: {
              width: "100%",
              // Grow into the full-height column; long content keeps its
              // measured height and overflows into the outer scroller.
              flexGrow: 1,
              flexShrink: 0,
              fontFamily: theme.monoFont,
              fontSize: 14,
              // Native lineHeight is absolute pixels, not a font-size factor.
              lineHeight: 24,
              color: theme.text,
            },
          }),
          ...renderContextMenu(theme),
        ])
      }
      const list = rows()
      const children: ReturnType<typeof h>[] = []
      let previous: ViewRow | undefined
      for (const row of list) {
        // CSS-like collapsed margins, expressed in native pixels. Lists have
        // a tighter rhythm; headings and code need distinct section spacing.
        const margin = (block: ViewRow, before: boolean): number => {
          if (block.kind === "hr") return theme.fontSize * 2
          if (block.kind === "table" || (block.kind === "text" && block.mono)) return theme.fontSize
          if (block.kind === "text" && block.headingLevel) {
            return block.fontSize * (before ? (block.headingLevel === 1 ? 1.5 : block.headingLevel === 2 ? 1.25 : 1) : 0.5)
          }
          if (block.kind === "text" && block.itemPos !== undefined) return theme.fontSize * 0.25
          return theme.fontSize * 0.5
        }
        const gap = previous
          ? previous.kind === "table" && row.kind === "table" ? 0 : Math.max(margin(previous, false), margin(row, true))
          : 0
        const spacer = gap ? h("div", { key: `${row.key}-gap`, style: { height: gap, flexShrink: 0 } }) : null
        if (spacer) children.push(spacer)
        if (row.kind === "hr") {
          children.push(
            h("div", {
              key: row.key,
              style: {
                marginLeft: row.indent * 22,
                height: 1,
                backgroundColor: theme.border,
              },
            }),
          )
        } else if (row.kind === "image") {
          children.push(
            h("img", {
              key: row.key,
              src: row.src,
              alt: row.alt,
              style: { marginLeft: row.indent * 22, maxHeight: 320 },
            }),
          )
        } else if (row.kind === "table") {
          const continuesTable = previous?.kind === "table"
          children.push(
            h(
              "div",
              { key: row.key, style: { display: "flex", width: "100%" } },
              () =>
                row.cells.map((cell, index) =>
                  h(
                    "div",
                    {
                      key: cell.key,
                      style: {
                        // Explicit percentage width: a bare flex child relies
                        // on shrink-to-fit, but the native editor measures a
                        // fixed 320px under indefinite width and never shrinks.
                        width: `${100 / row.cells.length}%`,
                        borderTopWidth: continuesTable ? 0 : 1,
                        borderBottomWidth: 1,
                        borderLeftWidth: index === 0 ? 1 : 0,
                        borderRightWidth: 1,
                        borderColor: theme.border,
                        backgroundColor: cell.header ? theme.tableHeaderBackground : undefined,
                        paddingTop: 8,
                        paddingBottom: 8,
                        paddingLeft: 12,
                        paddingRight: 12,
                      },
                    },
                    () => [
                      h("textarea", {
                        key: cell.key,
                        ref: collectRef(cell.key),
                        testId: `md-cell-${cell.key}`,
                        value: cell.text,
                        valueRevision: revisions.get(cell.key) ?? 0,
                        spans: cell.spans,
                        decorations: cell.decorations,
                        selection: consumePendingSelection(cell.key),
                        minRows: 1,
                        style: {
                          width: "100%",
                          fontSize: theme.fontSize,
                          fontFamily: theme.fontFamily,
                          textAlign: (cell.alignment || "left") as "left" | "center" | "right",
                          fontWeight: cell.header ? 600 : undefined,
                          color: theme.text,
                          // Native lineHeight is absolute pixels, not a
                          // font-size factor — same treatment as text rows.
                          lineHeight: theme.fontSize * (theme.lineHeight ?? 1.75),
                        },
                        onChange: onBlockChange(cell),
                        onKeyDown: onBlockKeyDown(cell, false),
                        onSelectionChange: onBlockSelectionChange(cell),
                        onSelectionDrag: onBlockSelectionDrag(cell),
                        interceptClipboard: true,
                        onCopy: onBlockCopy(cell),
                        onCut: onBlockCut(cell),
                        onPaste: onBlockPaste(cell, true),
                        onUndo: onBlockUndo,
                        onRedo: onBlockRedo,
                        onContextMenu: onBlockContextMenu(cell),
                      }),
                    ],
                  ),
                ),
            ),
          )
        } else if (row.kind === "text") {
          // Native lineHeight is absolute pixels, not a font-size factor.
          const lineHeightPx = row.fontSize * (row.mono ? 1.6 : row.headingLevel === 1 ? 1.25 : row.headingLevel === 2 ? 1.3 : (theme.lineHeight ?? 1.75))
          const editor = h("textarea", {
            key: row.key,
            ref: collectRef(row.key),
            testId: `md-${row.key}`,
            value: row.text,
            valueRevision: revisions.get(row.key) ?? 0,
            spans: row.spans,
            decorations: row.decorations,
            selection: consumePendingSelection(row.key),
            minRows: 1,
            onSubmit: () => onBlockSubmit(row),
            onChange: onBlockChange(row),
            onKeyDown: onBlockKeyDown(row),
            onSelectionChange: onBlockSelectionChange(row),
            onSelectionDrag: onBlockSelectionDrag(row),
            onBackspaceStart: onBlockBackspaceStart(row),
            interceptClipboard: true,
            onClick: onBlockClick(row),
            onCopy: onBlockCopy(row),
            onCut: onBlockCut(row),
            onPaste: onBlockPaste(row),
            onUndo: onBlockUndo,
            onRedo: onBlockRedo,
            onSelectAll: selectAllBlocks,
            onContextMenu: onBlockContextMenu(row),
            style: {
              width: "100%",
              minWidth: 0,
              flexGrow: 1,
              fontSize: row.fontSize,
              fontWeight: row.fontWeight,
              fontFamily: row.mono ? theme.monoFont : theme.fontFamily,
              textAlign: (row.align || "left") as "left" | "center" | "right",
              color: row.mono ? (theme.codeBlockText ?? theme.text) : row.quote ? theme.muted : theme.text,
              lineHeight: lineHeightPx,
            },
          })
          const lineChildren: ReturnType<typeof h>[] = []
          if (row.checkbox) {
            lineChildren.push(
              h(
                "div",
                {
                  key: `${row.key}-check`,
                  testId: `md-check-${row.checkbox.itemPos}`,
                  onClick: () => toggleTask(row.checkbox!.itemPos),
                  style: {
                    width: 16,
                    height: 16,
                    marginTop: (lineHeightPx - 16) / 2,
                    flexShrink: 0,
                    marginRight: 6,
                    borderWidth: 1,
                    borderColor: row.checkbox.checked ? theme.accent : "#777",
                    backgroundColor: row.checkbox.checked ? theme.accent : undefined,
                    borderRadius: 3,
                    alignItems: "center",
                    justifyContent: "center",
                  },
                },
                row.checkbox.checked
                  ? () => [
                      h("svg", {
                        key: `${row.key}-checkmark`,
                        source: TASK_CHECKMARK_SVG,
                        style: {
                          width: 12,
                          height: 12,
                          color: "#ffffff",
                          pointerEvents: "none",
                        },
                      }),
                    ]
                  : undefined,
              ),
            )
          } else if (row.marker) {
            lineChildren.push(
              h(
                "text",
                {
                  key: `${row.key}-marker`,
                  style: { width: row.markerWidth ?? 18, flexShrink: 0, fontFamily: theme.fontFamily, fontSize: row.fontSize, lineHeight: lineHeightPx, color: theme.muted },
                },
                () => [row.marker ?? ""],
              ),
            )
          }
          if (row.mono && row.info) {
            lineChildren.push(h("text", { style: { color: theme.muted, fontSize: 11, marginBottom: 8 } }, () => [row.info!]))
          }
          lineChildren.push(editor)
          if (flashKey.value === row.key) {
            lineChildren.push(
              h("div", {
                key: `${row.key}-flash`,
                testId: "md-flash",
                style: {
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 0,
                  bottom: 0,
                  backgroundColor: "rgba(255, 214, 0, 0.25)",
                  pointerEvents: "none",
                },
              }),
            )
          }
          children.push(
            h(
              "div",
              {
                key: row.key,
                style: {
                  display: "flex",
                  flexDirection: row.mono ? "column" : "row",
                  position: "relative",
                  marginLeft: Math.max(0, row.indent * 24 - (row.marker ? (row.markerWidth ?? 18) : row.checkbox ? 22 : 0)),
                  padding: row.mono ? 16 : row.quote && theme.quoteBackground ? 15 : undefined,
                  backgroundColor: row.mono ? theme.codeBlockBackground : row.quote ? theme.quoteBackground : undefined,
                  borderRadius: row.mono ? 6 : undefined,
                  paddingLeft: row.quote ? (theme.quoteBackground ? 25 : 16) : row.mono ? 16 : 0,
                  paddingBottom: row.headingLevel === 1 ? row.fontSize * 0.3 : row.headingLevel === 2 ? row.fontSize * 0.25 : row.mono ? 16 : row.quote && theme.quoteBackground ? 15 : 0,
                  borderWidth: row.quote ? 0 : undefined,
                  borderLeftWidth: row.quote ? 4 : undefined,
                  borderBottomWidth: row.headingLevel && row.headingLevel <= 2 ? 1 : undefined,
                  borderColor: row.quote ? theme.quoteBar : theme.border,
                },
              },
              () => lineChildren,
            ),
          )
        }
        previous = row
      }
      return h("div", { ref: collectRootRef, style: rootStyle() }, () => [
        ...children,
        ...renderContextMenu(theme),
      ])
    }
  },
})
