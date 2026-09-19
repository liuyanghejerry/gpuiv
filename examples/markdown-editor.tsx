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

const DOCUMENT = `# Markdown, edited natively

Type and the *document model* updates: **bold**, *italic*, \`code\`,
~~strike~~ and ==highlight== all render as you type.

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
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", backgroundColor: "#0d0d0d" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12,
            borderBottomWidth: 1,
            borderColor: "#2a2a2a",
          }}
        >
          <text style={{ fontSize: 13, fontWeight: 650, color: "#e8e8e8" }}>markdown-editor</text>
          <div
            testId="mode-toggle"
            onClick={() => (mode.value = mode.value === "wysiwyg" ? "source" : "wysiwyg")}
            style={{
              marginLeft: 12,
              paddingTop: 3, paddingBottom: 3, paddingLeft: 10, paddingRight: 10,
              borderRadius: 6,
              backgroundColor: "#262626",
              color: "#d0d0d0",
              fontSize: 12,
            }}
          >
            {mode.value === "wysiwyg" ? "source →" : "← wysiwyg"}
          </div>
          <input
            testId="search-input"
            value={query.value}
            placeholder="find…"
            style={{ width: 160, fontSize: 12, color: "#e8e8e8" }}
            onChange={(event: any) => {
              query.value = event.value ?? ""
              activeIndex.value = query.value ? 0 : -1
            }}
          />
          <div
            testId="search-next"
            onClick={next}
            style={{ paddingTop: 3, paddingBottom: 3, paddingLeft: 10, paddingRight: 10, borderRadius: 6, backgroundColor: "#262626", color: "#d0d0d0", fontSize: 12 }}
          >
            next
          </div>
          <text style={{ fontSize: 11, color: "#8a8a8a" }}>{status.value}</text>
        </div>
        <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
          <div testId="editor-column" style={{ width: 640, height: "100%", minHeight: 0, overflow: "scroll", paddingTop: 16, paddingBottom: 16, paddingLeft: 24, paddingRight: 24 }}>
            <MarkdownEditor
              ref={(el: any) => (editor.value = el)}
              source={DOCUMENT}
              mode={mode.value}
              searchQuery={query.value}
              searchActiveIndex={activeIndex.value}
              onSearchMatches={(count: number) => (matchCount.value = count)}
              onChange={(md: string) => (markdown.value = md)}
            />
          </div>
          <div style={{ width: 260, paddingTop: 16, paddingBottom: 16, paddingLeft: 12, paddingRight: 12, borderLeftWidth: 1, borderColor: "#2a2a2a" }}>
            <text style={{ fontSize: 11, color: "#8a8a8a" }}>OUTLINE</text>
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
                  color: heading.level <= 2 ? "#cfcfcf" : "#9a9a9a",
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
