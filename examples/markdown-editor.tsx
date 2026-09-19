/**
 * GPUIV Markdown WYSIWYG editor demo.
 *
 * `<markdown-editor>` renders a headless ProseMirror document as native
 * editable blocks: type `# ` to make a heading, `- ` for a list, `[x] ` for a
 * task, `==text==` to highlight. Enter splits blocks, shift-enter inserts a
 * line break, cmd-b/i/e bold/italic/code, shift-click across blocks then
 * cmd-c copies markdown, cmd-v parses multi-block markdown pastes. The panel
 * on the right is the document outline (jump + flash) and the find bar
 * (cmd-f in a real app shell would focus it).
 *
 * Run with:  cd examples && bun run markdown-editor
 */

import { computed, defineComponent, ref } from "vue"
import { createApp, MarkdownEditor } from "@gpuiv/vue"

// ColaMD's Elegant palette. Songti SC is the first installed family in
// its serif fallback stack on this Mac; native fonts take one family name.
const PAPER_THEME = {
  text: "#2c2c2c", muted: "#777777", accent: "#bc4424",
  codeBackground: "#e8e4df", codeText: "#c44b2b", strongText: "#c44b2b",
  codeBlockBackground: "#2c2c2c", codeBlockText: "#e0dcd7",
  highlight: "#f0d9a8", quoteBar: "#c44b2b", quoteBackground: "#eae6e1",
  border: "#dedad5", tableHeaderBackground: "#eae6e1",
  menuBackground: "#f0edea",
  fontFamily: "Songti SC", fontSize: 16, lineHeight: 1.9, monoFont: "Menlo",
}

const DOCUMENT = `# Markdown, edited natively

Type and the *document model* updates: **bold**, *italic*, \`code\`,
~~strike~~ and ==highlight== all render as you type.

中文与 English 混排，使用宋体呈现纸张般的阅读效果。**重点文字**和 \`行内代码\` 使用砖红色，==高亮内容== 使用暖金色。

## Blocks

- nested lists
  - like this one
- [x] tasks toggle by click
- [ ] or cmd-enter

> Quotes render with a bar.

1. ordered lists keep their start
2. second item

## Tables and code

| Feature | Status |
| :--- | ---: |
| input rules | yes |
| IME | yes |

\`\`\`rust
fn main() {
    println!("no syntax highlighting, like ColaMD");
}
\`\`\`

---

A footnote[^1] renders inline.

[^1]: definitions render at the end.

That is the whole loop: ProseMirror owns the document, gpuiv paints it.`

const App = defineComponent({
  setup() {
    const editor: any = ref(null)
    const markdown = ref(DOCUMENT)
    const mode = ref<"wysiwyg" | "source">("wysiwyg")
    const query = ref("")
    const activeIndex = ref(-1)
    const matchCount = ref(-1)

    const headings = computed(() =>
      markdown.value
        .split("\n")
        .map((line) => /^(#{1,6}) (.+)$/.exec(line))
        .filter(Boolean)
        .map((match) => ({ level: (match as RegExpExecArray)[1].length, text: (match as RegExpExecArray)[2] })),
    )

    const jump = (text: string) => editor.value?.jumpToHeading(text)

    const next = () => {
      if (matchCount.value > 0) {
        activeIndex.value = (activeIndex.value + 1) % matchCount.value
      }
    }

    const status = computed(
      () =>
        `${mode.value === "source" ? "SOURCE" : "WYSIWYG"} · ` +
        `${matchCount.value >= 0 ? `${matchCount.value} matches · ` : ""}` +
        `${markdown.value.length} chars`,
    )

    return () => (
      <div onMouseDown={(event: any) => editor.value?.clearSelectionAtPoint(event)} style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", backgroundColor: "#f0edea" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12,
            borderBottomWidth: 1,
            borderColor: "#dedad5",
            backgroundColor: "#e4e1de",
          }}
        >
          <text style={{ fontSize: 13, fontWeight: 650, color: "#2c2c2c" }}>markdown-editor</text>
          <div
            testId="mode-toggle"
            onClick={() => (mode.value = mode.value === "wysiwyg" ? "source" : "wysiwyg")}
            style={{
              marginLeft: 12,
              paddingTop: 3, paddingBottom: 3, paddingLeft: 10, paddingRight: 10,
              borderRadius: 6,
              backgroundColor: "#eae6e1",
              color: "#6c6c6c",
              fontSize: 12,
            }}
          >
            {mode.value === "wysiwyg" ? "source →" : "← wysiwyg"}
          </div>
          <input
            testId="search-input"
            value={query.value}
            placeholder="find…"
            style={{ width: 160, fontSize: 12, color: "#2c2c2c" }}
            onChange={(event: any) => {
              query.value = event.value ?? ""
              activeIndex.value = query.value ? 0 : -1
            }}
          />
          <div
            testId="search-next"
            onClick={next}
            style={{ paddingTop: 3, paddingBottom: 3, paddingLeft: 10, paddingRight: 10, borderRadius: 6, backgroundColor: "#eae6e1", color: "#6c6c6c", fontSize: 12 }}
          >
            next
          </div>
          <text style={{ fontSize: 11, color: "#777777" }}>{status.value}</text>
        </div>
        <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
          <div testId="editor-column" style={{ flexGrow: 1, minWidth: 0, height: "100%", minHeight: 0, overflow: "scroll", padding: 40, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: "100%", maxWidth: 780, minHeight: "100%", flexShrink: 0, display: "flex", flexDirection: "column" }}>
              <MarkdownEditor
                ref={(el: any) => (editor.value = el)}
                source={DOCUMENT}
                theme={PAPER_THEME}
                mode={mode.value}
                searchQuery={query.value}
                searchActiveIndex={activeIndex.value}
                onSearchMatches={(count: number) => (matchCount.value = count)}
                onChange={(md: string) => (markdown.value = md)}
              />
            </div>
          </div>
          <div style={{ width: 220, flexShrink: 0, paddingTop: 16, paddingBottom: 16, paddingLeft: 12, paddingRight: 12, borderLeftWidth: 1, borderColor: "#dedad5" }}>
            <text style={{ fontSize: 11, color: "#777777" }}>OUTLINE</text>
            {headings.value.map((heading) => (
              <div
                key={heading.text}
                testId={`outline-${heading.text}`}
                onClick={() => jump(heading.text)}
                style={{
                  paddingLeft: (heading.level - 1) * 10,
                  paddingTop: 4,
                  paddingBottom: 4,
                  fontSize: 12 + Math.max(0, 3 - heading.level),
                  color: heading.level <= 2 ? "#2c2c2c" : "#777777",
                }}
              >
                {heading.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  },
})

export { App }

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("markdown-editor.tsx")

if (isEntryPoint) {
  createApp(App, {
    title: "GPUIV Markdown Editor",
    width: 940,
    height: 720,
    focus: process.env.GPUIX_BACKGROUND !== "1",
  })
}
