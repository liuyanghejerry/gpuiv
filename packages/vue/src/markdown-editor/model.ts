import MarkdownIt from "markdown-it"
import footnote from "markdown-it-footnote"
import mark from "markdown-it-mark"
import { Mark as PMMark, Node as PMNode, Schema } from "prosemirror-model"
import { MarkdownParser, MarkdownSerializer, MarkdownSerializerState } from "prosemirror-markdown"

/**
 * Headless Markdown model for the WYSIWYG editor (docs/markdown-editor-plan.md M0).
 *
 * ProseMirror is used without `prosemirror-view`: this module owns the schema,
 * the markdown-it tokenizer, and both directions of Markdown conversion.
 * Serializing follows ColaMD semantics: soft breaks stay newlines
 * (remark-breaks), and the file's marker style (`*` vs `-`, `_` vs `*`,
 * `~~~` vs ```` ``` ````) is detected from the source and reused on output.
 */

export const editorSchema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      heading: {
        attrs: { level: { default: 1 } },
        content: "inline*",
        group: "block",
        defining: true,
      },
      blockquote: { content: "block+", group: "block", defining: true },
      code_block: {
        content: "text*",
        marks: "",
        group: "block",
        code: true,
        defining: true,
        attrs: { info: { default: "" } },
      },
      horizontal_rule: { group: "block" },
      bullet_list: { content: "list_item+", group: "block", attrs: { tight: { default: true } } },
      ordered_list: {
        content: "list_item+",
        group: "block",
        attrs: { order: { default: 1 }, tight: { default: true } },
      },
      list_item: { content: "block+", defining: true, attrs: { checked: { default: null } } },
      text: { group: "inline" },
      image: {
        inline: true,
        attrs: { src: {}, alt: { default: null }, title: { default: null } },
        group: "inline",
        atom: true,
      },
      hard_break: { inline: true, group: "inline", selectable: false, atom: true },
      table: { content: "table_row+", group: "block" },
      footnote_definition: {
        content: "block+",
        group: "block",
        defining: true,
        attrs: { label: { default: "" } },
      },
      footnote_reference: {
        inline: true,
        group: "inline",
        atom: true,
        attrs: { label: { default: "" } },
      },
      table_row: { content: "(table_header | table_cell)+" },
      table_header: { content: "inline*", attrs: { alignment: { default: null } }, defining: true },
      table_cell: { content: "inline*", attrs: { alignment: { default: null } } },
    },
    marks: {
      link: { attrs: { href: {}, title: { default: null } }, inclusive: false },
      // Typing at a styled range's boundary must not inherit the style
      // (milkdown/ColaMD behavior); `code` keeps default inclusivity.
      em: { inclusive: false },
      strong: { inclusive: false },
      code: { code: true },
      strikethrough: { inclusive: false },
      highlight: { inclusive: false },
    },
  })

interface MinimalToken {
  type: string
  content?: string
  hidden?: boolean
  meta?: Record<string, unknown> | null
  children?: MinimalToken[] | null
  attrGet?: (name: string) => string | null
}

// GFM task list items: `- [x] done`. markdown-it has no built-in rule, so this
// core rule runs after inline tokenization, flags the list_item_open token and
// strips the `[x] ` prefix from the first inline text child.
function taskListRule(state: { tokens: MinimalToken[] }): void {
  const tokens = state.tokens
  for (let i = 2; i < tokens.length; i++) {
    if (tokens[i].type !== "inline") continue
    if (tokens[i - 1].type !== "paragraph_open" || tokens[i - 2].type !== "list_item_open") continue
    const children = tokens[i].children
    if (!children || !children.length || children[0].type !== "text") continue
    const match = /^\[([ xX])\] /.exec(children[0].content ?? "")
    if (!match) continue
    const item = tokens[i - 2]
    item.meta = { ...(item.meta ?? {}), task: true, checked: match[1] !== " " }
    children[0].content = (children[0].content ?? "").slice(match[0].length)
    if (!children[0].content) children.shift()
  }
}

function listIsTight(tokens: MinimalToken[], i: number): boolean {
  while (++i < tokens.length) if (tokens[i].type !== "list_item_open") return !!tokens[i].hidden
  return false
}

function alignmentFrom(token: MinimalToken): { alignment: string | null } {
  const style = token.attrGet?.("style") ?? ""
  const match = /text-align:\s*(left|center|right)/.exec(style)
  return { alignment: match ? match[1] : null }
}

function createTokenizer() {
  const md = new MarkdownIt({ html: false, breaks: true })
  md.use(mark)
  md.use(footnote)
  md.core.ruler.after("inline", "gpuiv_task_lists", taskListRule as (state: unknown) => void)
  return md
}

export const markdownTokenizer = createTokenizer()

export const markdownParser = new MarkdownParser(editorSchema, markdownTokenizer, {
  blockquote: { block: "blockquote" },
  paragraph: { block: "paragraph" },
  list_item: {
    block: "list_item",
    getAttrs: (tok: MinimalToken) => {
      const meta = tok.meta as { task?: boolean; checked?: boolean } | null | undefined
      return { checked: meta?.task ? (meta.checked ?? false) : null }
    },
  },
  bullet_list: {
    block: "bullet_list",
    getAttrs: (_tok: MinimalToken, tokens: MinimalToken[], i: number) => ({
      tight: listIsTight(tokens, i),
    }),
  },
  ordered_list: {
    block: "ordered_list",
    getAttrs: (tok: MinimalToken, tokens: MinimalToken[], i: number) => ({
      order: +(tok.attrGet?.("start") ?? 1) || 1,
      tight: listIsTight(tokens, i),
    }),
  },
  heading: {
    block: "heading",
    getAttrs: (tok: MinimalToken & { tag?: string }) => ({ level: +(tok.tag?.slice(1) ?? 1) }),
  },
  code_block: { block: "code_block", noCloseToken: true },
  fence: { block: "code_block", getAttrs: (tok: MinimalToken & { info?: string }) => ({ info: tok.info ?? "" }), noCloseToken: true },
  hr: { node: "horizontal_rule" },
  image: {
    node: "image",
    getAttrs: (tok: MinimalToken) => ({
      src: tok.attrGet?.("src") ?? "",
      title: tok.attrGet?.("title") || null,
      alt: tok.children?.[0]?.content || null,
    }),
  },
  hardbreak: { node: "hard_break" },
  softbreak: { node: "hard_break" },
  table: { block: "table" },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: "table_row" },
  th: { block: "table_header", getAttrs: alignmentFrom },
  td: { block: "table_cell", getAttrs: alignmentFrom },
  footnote_block: { ignore: true },
  footnote: {
    block: "footnote_definition",
    getAttrs: (tok: MinimalToken & { meta?: { label?: string | number } | null }) => ({
      label: String(tok.meta?.label ?? ""),
    }),
  },
  footnote_anchor: { ignore: true, noCloseToken: true },
  footnote_ref: {
    node: "footnote_reference",
    getAttrs: (tok: MinimalToken & { meta?: { label?: string | number } | null }) => ({
      label: String(tok.meta?.label ?? ""),
    }),
  },
  em: { mark: "em" },
  strong: { mark: "strong" },
  s: { mark: "strikethrough" },
  mark: { mark: "highlight" },
  link: {
    mark: "link",
    getAttrs: (tok: MinimalToken) => ({
      href: tok.attrGet?.("href") ?? "",
      title: tok.attrGet?.("title") || null,
    }),
  },
  code_inline: { mark: "code", noCloseToken: true },
})

export function parseMarkdown(md: string): PMNode {
  return markdownParser.parse(md)
}

export interface MarkerStyle {
  bullet: string
  emphasis: string
  strong: string
  fence: string
}

export const defaultMarkerStyle: MarkerStyle = { bullet: "-", emphasis: "*", strong: "**", fence: "```" }

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length
}

// Mirrors ColaMD's markdown-style.ts: on load, count the markers the file
// already uses and serialize back with the same ones.
export function detectMarkerStyle(md: string): MarkerStyle {
  const bullets: Record<string, number> = { "*": 0, "-": 0, "+": 0 }
  for (const match of md.matchAll(/^([*\-+])[ \t]/gm)) bullets[match[1]]++
  const ranked = Object.entries(bullets).sort((a, b) => b[1] - a[1])
  const bullet = ranked[0][1] > 0 ? ranked[0][0] : defaultMarkerStyle.bullet

  const emStar = countMatches(md, /\*[^*\n]+\*/g)
  const emUnderscore = countMatches(md, /_[^_\n]+_/g)
  const strongStar = countMatches(md, /\*\*[^*\n]+\*\*/g)
  const strongUnderscore = countMatches(md, /__[^_\n]+__/g)

  return {
    bullet,
    emphasis: emUnderscore > emStar ? "_" : defaultMarkerStyle.emphasis,
    strong: strongUnderscore > strongStar ? "__" : defaultMarkerStyle.strong,
    fence: countMatches(md, /^~~~/gm) > countMatches(md, /^```/gm) ? "~~~" : defaultMarkerStyle.fence,
  }
}

function backticksFor(node: PMNode | null | undefined, side: number): string {
  let len = 0
  if (node?.isText && node.text) {
    for (const match of node.text.matchAll(/`+/g)) len = Math.max(len, match[0].length)
  }
  let result = len > 0 && side > 0 ? " `" : "`"
  for (let i = 0; i < len; i++) result += "`"
  if (len > 0 && side < 0) result += " "
  return result
}

function isPlainURL(mark: PMMark, parent: PMNode, index: number): boolean {
  const attrs = mark.attrs as { href: string; title: string | null }
  if (attrs.title || !/^\w+:/.test(attrs.href)) return false
  const content = parent.child(index)
  if (!content.isText || content.text !== attrs.href) return false
  return index === parent.childCount - 1 || !mark.type.isInSet(parent.child(index + 1).marks)
}

function createSerializer(style: MarkerStyle): MarkdownSerializer {
  const emphasis = style.emphasis === "_" ? "_" : "*"
  const strong = style.strong === "__" ? "__" : "**"
  const fenceRun = style.fence === "~~~" ? "~" : "`"

  return new MarkdownSerializer(
    {
      paragraph(state, node) {
        state.renderInline(node)
        state.closeBlock(node)
      },
      heading(state, node) {
        state.write(state.repeat("#", node.attrs.level) + " ")
        state.renderInline(node, false)
        state.closeBlock(node)
      },
      blockquote(state, node) {
        state.wrapBlock("> ", null, node, () => state.renderContent(node))
      },
      horizontal_rule(state, node) {
        state.write("---")
        state.closeBlock(node)
      },
      code_block(state, node) {
        const runs = node.textContent.match(new RegExp(`${fenceRun}{3,}`, "g"))
        const longest = runs ? runs.sort().slice(-1)[0].length : 2
        const fence = fenceRun.repeat(Math.max(3, longest + 1))
        state.write(fence + (node.attrs.info || "") + "\n")
        state.text(node.textContent, false)
        state.write("\n")
        state.write(fence)
        state.closeBlock(node)
      },
      bullet_list(state, node) {
        state.renderList(node, "  ", () => style.bullet + " ")
      },
      ordered_list(state, node) {
        const start = node.attrs.order ?? 1
        const maxW = String(start + node.childCount - 1).length
        const space = state.repeat(" ", maxW + 2)
        state.renderList(node, space, (i: number) => {
          const n = String(start + i)
          return state.repeat(" ", maxW - n.length) + n + ". "
        })
      },
      list_item(state, node) {
        if (node.attrs.checked == null || node.firstChild?.type.name !== "paragraph") {
          state.renderContent(node)
          return
        }
        state.write("[" + (node.attrs.checked ? "x" : " ") + "] ")
        state.renderContent(node)
      },
      image(state, node) {
        state.write(
          "![" +
            state.esc(node.attrs.alt || "") +
            "](" +
            String(node.attrs.src).replace(/[()]/g, "\\$&") +
            (node.attrs.title ? ' "' + String(node.attrs.title).replace(/"/g, '\\"') + '"' : "") +
            ")",
        )
      },
      hard_break(state) {
        state.write("\n")
      },
      text(state, node) {
        // inAutolink is set by the link mark serializer but not exposed in
        // the public type; track it through the same field.
        const s = state as MarkdownSerializerState & { inAutolink: boolean | undefined }
        state.text(node.text ?? "", !s.inAutolink)
      },
      footnote_reference(state, node) {
        state.write(`[^${node.attrs.label ?? ""}]`)
      },
      footnote_definition(state, node) {
        state.write(`[^${node.attrs.label ?? ""}]: `)
        const first = node.firstChild
        if (node.childCount === 1 && first?.type.name === "paragraph") {
          state.renderInline(first)
          state.closeBlock(node)
          return
        }
        state.closeBlock(node)
        state.wrapBlock("    ", null, node, () => state.renderContent(node))
      },
      table(state, node) {
        // Flush any pending block close into the real buffer first: the cell
        // rendering below borrows renderInline with a swapped-out buffer, and
        // its first write would otherwise consume this close.
        state.write("")
        const rows: string[][] = []
        const alignments: (string | null)[] = []
        node.forEach((row) => {
          const cells: string[] = []
          row.forEach((cell: PMNode, _offset: number, index: number) => {
            if (rows.length === 0) alignments[index] = cell.attrs.alignment ?? null
            // Marks are only applied by renderInline, so borrow the outer
            // state with its output buffer swapped out for the cell text.
            const s = state as MarkdownSerializerState & { out: string }
            const saved = s.out
            s.out = ""
            state.renderInline(cell)
            cells.push(s.out.replace(/\n/g, " ").trim())
            s.out = saved
          })
          rows.push(cells)
        })
        const colCount = Math.max(...rows.map((r) => r.length))
        const widths: number[] = []
        for (let c = 0; c < colCount; c++) {
          widths[c] = Math.max(3, ...rows.map((r) => r[c]?.length ?? 0))
        }
        const renderRow = (cells: string[]) =>
          "| " + cells.map((cell, c) => padCell(cell, widths[c], alignments[c])).join(" | ") + " |"
        const delimiter =
          "| " +
          widths
            .map((w, c) => {
              const dashes = "-".repeat(w)
              if (alignments[c] === "left") return ":" + dashes.slice(1)
              if (alignments[c] === "right") return dashes.slice(1) + ":"
              if (alignments[c] === "center") return ":" + dashes.slice(2) + ":"
              return dashes
            })
            .join(" | ") +
          " |"
        const lines = rows.map((cells, i) => (i === 0 ? [renderRow(cells), delimiter] : [renderRow(cells)]).join("\n"))
        state.write(lines.join("\n"))
        state.closeBlock(node)
      },
    },
    {
      em: { open: emphasis, close: emphasis, mixable: true, expelEnclosingWhitespace: true },
      strong: { open: strong, close: strong, mixable: true, expelEnclosingWhitespace: true },
      strikethrough: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
      highlight: { open: "==", close: "==", mixable: true, expelEnclosingWhitespace: true },
      code: {
        open: (_state, _mark, parent, index) => backticksFor(parent.child(index), -1),
        close: (_state, _mark, parent, index) => backticksFor(parent.child(index - 1), 1),
        escape: false,
      },
      link: {
        open(state, mark, parent, index) {
          const s = state as MarkdownSerializerState & { inAutolink: boolean | undefined }
          s.inAutolink = isPlainURL(mark, parent, index)
          return s.inAutolink ? "<" : "["
        },
        close(state, mark) {
          const s = state as MarkdownSerializerState & { inAutolink: boolean | undefined }
          const inAutolink = s.inAutolink
          s.inAutolink = undefined
          return inAutolink
            ? ">"
            : "](" +
                String(mark.attrs.href).replace(/[()"]/g, "\\$&") +
                (mark.attrs.title ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"` : "") +
                ")"
        },
        mixable: true,
      },
    },
  )
}

function padCell(text: string, width: number, alignment: string | null): string {
  const pad = width - text.length
  if (alignment === "right") return " ".repeat(pad) + text
  if (alignment === "center") {
    const left = Math.floor(pad / 2)
    return " ".repeat(left) + text + " ".repeat(pad - left)
  }
  return text + " ".repeat(pad)
}

export function serializeMarkdown(doc: PMNode, style: MarkerStyle = defaultMarkerStyle): string {
  let out = createSerializer(style).serialize(doc)
  // An empty trailing textblock writes nothing (its block close never
  // flushes), which would silently drop the block the user just split into.
  const last = doc.lastChild
  if (last?.type.name === "paragraph" && last.content.size === 0 && !out.endsWith("\n\n")) {
    out += out.endsWith("\n") ? "\n" : "\n\n"
  }
  // remark-stringify convention: the serialized document ends with a newline.
  return out.endsWith("\n") ? out : out + "\n"
}
