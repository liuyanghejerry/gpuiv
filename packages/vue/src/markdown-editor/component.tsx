import { defineComponent, h, nextTick, onBeforeUpdate, ref, watch, type PropType } from "vue"
import type { Mark, Node as PMNode } from "prosemirror-model"
import { useGpuix } from "../hooks/use-gpuix.js"
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
  fontSize: 15,
}

const HEADING_SCALE = [1.8, 1.45, 1.25, 1.1, 1.0, 1.0]
const HEADING_WEIGHT = [700, 700, 650, 650, 600, 600]

interface TextRow {
  kind: "text"
  key: string
  pos: number
  text: string
  spans: MarkdownEditorSpan[]
  fontSize: number
  fontWeight?: number
  mono?: boolean
  indent: number
  quote: boolean
  marker?: string
  markerWidth?: number
  checkbox?: { itemPos: number; checked: boolean }
  align?: string
  decorations?: { start: number; end: number; color: string }[]
}

interface SpacerRow {
  kind: "hr" | "image" | "code-info"
  key: string
  src?: string
  alt?: string
  info?: string
  indent: number
  quote: boolean
}

interface TableCell {
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
        span.fontWeight = 700
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
    }
  })
  return { text, spans }
}

interface WalkContext {
  indent: number
  quote: boolean
  marker?: string
  markerWidth?: number
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
        out.push({
          kind: "text",
          key: `b${pos}`,
          pos,
          text,
          spans,
          fontSize: level ? theme.fontSize * HEADING_SCALE[level - 1] : (ctx.fontSize ?? theme.fontSize),
          fontWeight: level ? HEADING_WEIGHT[level - 1] : ctx.fontWeight,
          indent: ctx.indent,
          quote: ctx.quote,
          marker: ctx.marker,
          markerWidth: ctx.markerWidth,
          checkbox: ctx.checkbox,
          align: ctx.tableAlign,
        })
        break
      }
      case "code_block": {
        out.push({
          kind: "code-info",
          key: `i${pos}`,
          info: (child.attrs.info as string) || "",
          indent: ctx.indent,
          quote: ctx.quote,
        })
        out.push({
          kind: "text",
          key: `b${pos}`,
          pos,
          text: child.textContent,
          spans: [],
          fontSize: theme.fontSize,
          mono: true,
          indent: ctx.indent,
          quote: ctx.quote,
        })
        break
      }
      case "horizontal_rule":
        out.push({ kind: "hr", key: `b${pos}`, indent: ctx.indent, quote: ctx.quote })
        break
      case "image":
        out.push({
          kind: "image",
          key: `b${pos}`,
          src: String(child.attrs.src ?? ""),
          alt: child.attrs.alt ? String(child.attrs.alt) : undefined,
          indent: ctx.indent,
          quote: ctx.quote,
        })
        break
      case "blockquote":
        walkBlocks(child, pos + 1, { ...ctx, quote: true, marker: undefined, checkbox: undefined }, theme, out)
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
            checkbox,
          }
          walkBlocks(item, itemPos + 1, itemCtx, theme, out)
        })
        break
      }
      case "footnote_definition": {
        const defCtx: WalkContext = {
          ...ctx,
          marker: `[^${child.attrs.label ?? ""}]:`,
          markerWidth: 54,
          checkbox: undefined,
          fontSize: theme.fontSize * 0.92,
        }
        walkBlocks(child, pos + 1, defCtx, theme, out)
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
              key: `c${cellPos}`,
              pos: cellPos,
              text,
              spans,
              alignment: (cell.attrs.alignment as string) || null,
              header: cell.type.name === "table_header",
            })
          })
          out.push({ kind: "table", key: `r${rowPos}`, cells })
        })
        break
      }
      default:
        break
    }
  })
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
    const mergedTheme = { ...defaultTheme, ...props.theme } as MarkdownEditorTheme
    const core = new MarkdownEditorCore(props.source)
    const version = ref(0)
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
    const sourceText = ref(props.source)
    const rootId = ref<number | null>(null)
    const collectRootRef = (el: unknown) => {
      rootId.value = (el as { id?: number } | null)?.id ?? null
    }
    let lastMatchCount = -1
    const pendingFocus = ref<{ key: string; caret: number } | null>(null)
    let focusTarget: { key: string; caret: number } | null = null

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

    const rows = (): ViewRow[] => {
      // touch version for reactivity
      void version.value
      const out: ViewRow[] = []
      walkBlocks(core.state.doc, 0, { indent: 0, quote: false }, mergedTheme, out)
      const query = props.searchQuery.trim()
      let matchIndex = 0
      let matchCount = 0
      for (const row of out) {
        if (row.kind !== "text") continue
        blockTexts.set(row.key, row.text)
        const known = nativeTexts.get(row.key)
        if (known === undefined || known !== row.text) {
          if (known !== undefined) {
            revisions.set(row.key, (revisions.get(row.key) ?? 0) + 1)
          }
          nativeTexts.set(row.key, row.text)
        }
        if (query) {
          const lower = row.text.toLowerCase()
          const needle = query.toLowerCase()
          const decorations: { start: number; end: number; color: string }[] = []
          let at = lower.indexOf(needle)
          while (at !== -1) {
            const active = matchIndex === props.searchActiveIndex
            decorations.push({
              start: at,
              end: at + query.length,
              color: active ? "rgba(255, 170, 0, 0.75)" : "rgba(255, 214, 0, 0.35)",
            })
            if (active) {
              pendingSelectionProps.set(row.key, [at, at + query.length])
              focusTarget = { key: row.key, caret: at }
            }
            matchIndex++
            matchCount++
            at = lower.indexOf(needle, at + needle.length)
          }
          row.decorations = decorations
        }
      }
      if (matchCount !== lastMatchCount) {
        lastMatchCount = matchCount
        emit("searchMatches", matchCount)
      }
      return out
    }

    const getMarkdown = () => core.getMarkdown()
    const touch = () => {
      version.value++
      emit("change", core.getMarkdown())
    }

    const focusBlock = (key: string, caret: number) => {
      pendingFocus.value = { key, caret }
      void nextTick(() => {
        const target = pendingFocus.value
        pendingFocus.value = null
        if (!target) return
        const renderer = getRenderer()
        const id = hostIds.get(target.key)
        if (renderer?.focusElement && id !== undefined) {
          renderer.focusElement(id)
          selections.set(target.key, [target.caret, target.caret])
        }
      })
    }

    const onBlockChange = (row: TextRow) => (event: { value?: string | null }) => {
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
      if (newPos !== null) focusBlock(`b${newPos}`, 0)
    }

    const onBlockKeyDown = (row: TextRow) => (event: { key?: string; modifiers?: Record<string, boolean> }) => {
      const key = event.key ?? ""
      const mods = event.modifiers ?? {}
      const selection = selections.get(row.key) ?? [row.text.length, row.text.length]
      const [anchor, head] = selection
      const contentStart = row.pos + 1
      if (mods.cmd || mods.ctrl) {
        if (key === "enter") {
          if (row.checkbox) {
            core.toggleTaskItemAt(row.checkbox.itemPos)
            touch()
          }
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
      if (key === "backspace" && anchor === 0 && head === 0) {
        const caret = core.joinWithPreviousBlock(row.pos)
        touch()
        if (caret !== null) {
          // Position of the merged textblock: walk back from the join point.
          const $ = core.state.doc.resolve(caret)
          const blockPos = $.before($.depth)
          focusBlock(`b${blockPos}`, caret - blockPos - 1)
        }
      }
    }

    const onBlockSelectionChange =
      (row: TextRow) => (event: { startIndex?: number; endIndex?: number }) => {
        const anchor = event.startIndex ?? 0
        const head = event.endIndex ?? anchor
        selections.set(row.key, [anchor, head])
      }

    const toggleTask = (itemPos: number) => {
      core.toggleTaskItemAt(itemPos)
      touch()
    }

    const captureScrollRatio = (): number => {
      const renderer = getRenderer()
      if (!renderer?.scrollTo || !renderer.getScrollOffset || rootId.value == null) return 0
      const before = renderer.getScrollOffset(rootId.value)
      if (!before) return 0
      renderer.scrollTo(rootId.value, 0, 1e9)
      const max = renderer.getScrollOffset(rootId.value)
      renderer.scrollTo(rootId.value, 0, before[1] ?? 0)
      if (!max) return 0
      const maxY = max[1] ?? 0
      return maxY > 0 ? (before[1] ?? 0) / maxY : 0
    }

    const restoreScrollRatio = (ratio: number): void => {
      const renderer = getRenderer()
      if (!renderer?.scrollTo || !renderer.getScrollOffset || rootId.value == null) return
      renderer.scrollTo(rootId.value, 0, 1e9)
      const max = renderer.getScrollOffset(rootId.value)
      if (!max) return
      renderer.scrollTo(rootId.value, 0, ratio * (max[1] ?? 0))
    }

    watch(
      () => props.mode,
      (mode) => {
        const ratio = captureScrollRatio()
        if (mode === "source") {
          sourceText.value = core.getMarkdown()
        } else {
          core.reset(sourceText.value)
          nativeTexts.clear()
          revisions.clear()
          pendingSelectionProps.clear()
        }
        version.value++
        void nextTick(() => restoreScrollRatio(ratio))
      },
    )

    expose({
      getMarkdown,
      core: () => core,
      focusBlockByKey: (key: string, caret: number) => focusBlock(key, caret),
    })

    const rootStyle = () => ({
      width: "100%",
      height: props.viewportHeight > 0 ? props.viewportHeight : undefined,
      overflow: props.viewportHeight > 0 ? ("scroll" as const) : undefined,
    })

    return () => {
      if (props.mode === "source") {
        return h("div", { ref: collectRootRef, style: rootStyle() }, () => [
          h("textarea", {
            key: "md-source",
            ref: collectRef("md-source"),
            testId: "md-source",
            value: sourceText.value,
            minRows: 4,
            onChange: (event: { value?: string | null }) => {
              sourceText.value = event.value ?? ""
              emit("change", sourceText.value)
            },
            style: {
              width: "100%",
              fontFamily: mergedTheme.monoFont,
              fontSize: 13,
              lineHeight: 1.6,
              color: mergedTheme.text,
            },
          }),
        ])
      }
      const list = rows()
      if (focusTarget && props.searchActiveIndex >= 0) {
        const target = focusTarget
        focusTarget = null
        focusBlock(target.key, target.caret)
      }
      const children: ReturnType<typeof h>[] = []
      let lastKind = ""
      for (const row of list) {
        // Inter-block spacing, like ColaMD's 0.6em paragraph rhythm.
        const spacer =
          lastKind !== "" && row.kind !== "table" ? h("div", { style: { height: 7 } }) : null
        if (spacer) children.push(spacer)
        if (row.kind === "hr") {
          children.push(
            h("div", {
              key: row.key,
              style: {
                marginLeft: row.indent * 22,
                height: 1,
                backgroundColor: "#4a4a4a",
                marginTop: 6,
                marginBottom: 6,
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
        } else if (row.kind === "code-info") {
          if (row.info) {
            children.push(
              h("text", { key: row.key, style: { color: mergedTheme.muted, fontSize: 11 } }, () => [row.info]),
            )
          }
        } else if (row.kind === "table") {
          children.push(
            h(
              "div",
              { key: row.key, style: { display: "flex", width: "100%" } },
              () =>
                row.cells.map((cell) =>
                  h(
                    "div",
                    {
                      key: cell.key,
                      style: {
                        flex: 1,
                        borderWidth: 1,
                        borderColor: "#444",
                        backgroundColor: cell.header ? "rgba(127,127,127,0.15)" : undefined,
                        padding: 4,
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
                        minRows: 1,
                        style: {
                          width: "100%",
                          fontSize: mergedTheme.fontSize,
                          textAlign: (cell.alignment || "left") as "left" | "center" | "right",
                          fontWeight: cell.header ? 650 : undefined,
                        },
                        onChange: onBlockChange({ kind: "text", key: cell.key, pos: cell.pos, text: cell.text, spans: cell.spans, fontSize: mergedTheme.fontSize, indent: 0, quote: false, align: cell.alignment || "left" }),
                        onSelectionChange: onBlockSelectionChange({ kind: "text", key: cell.key, pos: cell.pos, text: cell.text, spans: cell.spans, fontSize: mergedTheme.fontSize, indent: 0, quote: false }),
                      }),
                    ],
                  ),
                ),
            ),
          )
        } else if (row.kind === "text") {
          const editor = h("textarea", {
            key: row.key,
            ref: collectRef(row.key),
            testId: `md-${row.key}`,
            value: row.text,
            valueRevision: revisions.get(row.key) ?? 0,
            spans: row.spans,
            decorations: row.decorations,
            selection: pendingSelectionProps.get(row.key),
            minRows: 1,
            onSubmit: () => onBlockSubmit(row),
            onChange: onBlockChange(row),
            onKeyDown: onBlockKeyDown(row),
            onSelectionChange: onBlockSelectionChange(row),
            style: {
              flex: 1,
              fontSize: row.fontSize,
              fontWeight: row.fontWeight,
              fontFamily: row.mono ? mergedTheme.monoFont : undefined,
              backgroundColor: row.mono ? mergedTheme.codeBackground : undefined,
              textAlign: (row.align || "left") as "left" | "center" | "right",
              color: mergedTheme.text,
              lineHeight: row.mono ? 1.45 : 1.7,
            },
          })
          const lineChildren: ReturnType<typeof h>[] = []
          if (row.checkbox) {
            lineChildren.push(
              h("div", {
                key: `${row.key}-check`,
                testId: `md-check-${row.checkbox.itemPos}`,
                onClick: () => toggleTask(row.checkbox!.itemPos),
                style: {
                  width: 16,
                  height: 16,
                  marginTop: 4,
                  marginRight: 6,
                  borderWidth: 1,
                  borderColor: row.checkbox.checked ? mergedTheme.accent : "#777",
                  backgroundColor: row.checkbox.checked ? mergedTheme.accent : undefined,
                  borderRadius: 3,
                },
              }),
            )
          } else if (row.marker) {
            lineChildren.push(
              h(
                "text",
                {
                  key: `${row.key}-marker`,
                  style: { width: row.markerWidth ?? 18, color: mergedTheme.muted },
                },
                () => [row.marker ?? ""],
              ),
            )
          }
          lineChildren.push(editor)
          children.push(
            h(
              "div",
              {
                key: row.key,
                style: {
                  display: "flex",
                  marginLeft: row.indent * 22,
                  paddingLeft: row.quote ? 10 : 0,
                  borderWidth: row.quote ? 0 : undefined,
                  borderLeftWidth: row.quote ? 3 : undefined,
                  borderColor: row.quote ? mergedTheme.quoteBar : undefined,
                },
              },
              () => lineChildren,
            ),
          )
        }
        lastKind = row.kind
      }
      return h("div", { ref: collectRootRef, style: rootStyle() }, () => children)
    }
  },
})
