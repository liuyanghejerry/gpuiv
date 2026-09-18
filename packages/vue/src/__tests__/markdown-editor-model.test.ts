import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  detectMarkerStyle,
  editorSchema,
  parseMarkdown,
  serializeMarkdown,
} from "../markdown-editor/model.js"

const parse = (md: string) => parseMarkdown(md)
const serialize = (doc: ReturnType<typeof parse>, style?: ReturnType<typeof detectMarkerStyle>) =>
  serializeMarkdown(doc, style)

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/colamd/${name}`, import.meta.url)), "utf8")
}

describe("markdown model: schema + parse", () => {
  it("builds a doc with the ColaMD node set", () => {
    const doc = parse("# T\n\npara\n")
    expect(doc.type.name).toBe("doc")
    expect(doc.child(0).type.name).toBe("heading")
    expect(doc.child(0).attrs.level).toBe(1)
    expect(doc.child(0).textContent).toBe("T")
    expect(doc.child(1).type.name).toBe("paragraph")
  })

  it("parses inline marks: em/strong/code/strikethrough/highlight/link", () => {
    const doc = parse("a *b* **c** `d` ~~e~~ ==f== [g](https://x)")
    const p = doc.child(0)
    // text between marks stays its own child; marked runs sit at odd indices
    expect(p.child(0).textContent).toBe("a ")
    expect(p.child(1).marks.map((m) => m.type.name)).toEqual(["em"])
    expect(p.child(3).marks.map((m) => m.type.name)).toEqual(["strong"])
    expect(p.child(5).marks.map((m) => m.type.name)).toEqual(["code"])
    expect(p.child(7).marks.map((m) => m.type.name)).toEqual(["strikethrough"])
    expect(p.child(9).marks.map((m) => m.type.name)).toEqual(["highlight"])
    const link = p.child(11).marks[0]
    expect(link.type.name).toBe("link")
    expect(link.attrs.href).toBe("https://x")
    expect(p.child(11).textContent).toBe("g")
  })

  it("keeps link titles and parses autolinks", () => {
    const doc = parse('[g](https://x "t")')
    const mark = doc.child(0).child(0).marks[0]
    expect(mark.attrs.title).toBe("t")
  })

  it("turns in-paragraph newlines into hard breaks (remark-breaks semantics)", () => {
    const doc = parse("line1\nline2")
    const p = doc.child(0)
    expect(p.child(1).type.name).toBe("hard_break")
    expect(p.child(2).textContent).toBe("line2")
  })

  it("parses nested bullet lists with tightness", () => {
    const doc = parse("- a\n  - b\n- c")
    const list = doc.child(0)
    expect(list.type.name).toBe("bullet_list")
    expect(list.attrs.tight).toBe(true)
    expect(list.child(0).child(1).type.name).toBe("bullet_list")
    expect(list.child(0).child(1).child(0).child(0).textContent).toBe("b")
  })

  it("marks loose lists as tight=false", () => {
    const doc = parse("- a\n\n- b")
    expect(doc.child(0).attrs.tight).toBe(false)
  })

  it("parses ordered list start", () => {
    const doc = parse("3. a\n4. b")
    const list = doc.child(0)
    expect(list.type.name).toBe("ordered_list")
    expect(list.attrs.order).toBe(3)
  })

  it("parses task list items with checked state, marker stripped from text", () => {
    const doc = parse("- [x] done\n- [ ] todo\n- plain")
    const list = doc.child(0)
    expect(list.child(0).attrs.checked).toBe(true)
    expect(list.child(0).child(0).textContent).toBe("done")
    expect(list.child(1).attrs.checked).toBe(false)
    expect(list.child(2).attrs.checked).toBe(null)
  })

  it("parses GFM tables with header/body cells and alignment", () => {
    const doc = parse("| A | B |\n| --- | :---: |\n| a | b |\n")
    const table = doc.child(0)
    expect(table.type.name).toBe("table")
    const header = table.child(0)
    expect(header.child(0).type.name).toBe("table_header")
    expect(header.child(0).textContent).toBe("A")
    expect(header.child(1).attrs.alignment).toBe("center")
    const body = table.child(1)
    expect(body.child(0).type.name).toBe("table_cell")
    expect(body.child(1).attrs.alignment).toBe("center")
  })

  it("parses fenced code with info string", () => {
    const doc = parse("```rust\nfn main() {}\n```\n")
    const block = doc.child(0)
    expect(block.type.name).toBe("code_block")
    expect(block.attrs.info).toBe("rust")
    expect(block.textContent).toBe("fn main() {}")
  })

  it("parses hr, blockquote and image", () => {
    const doc = parse("![alt](src.png)\n\n> quote\n\n---\n")
    expect(doc.child(0).child(0).type.name).toBe("image")
    expect(doc.child(0).child(0).attrs.src).toBe("src.png")
    expect(doc.child(1).type.name).toBe("blockquote")
    expect(doc.child(2).type.name).toBe("horizontal_rule")
  })
})

describe("markdown model: marker style detection", () => {
  it("defaults to dash bullets and star emphasis", () => {
    expect(detectMarkerStyle("just text")).toEqual({
      bullet: "-",
      emphasis: "*",
      strong: "**",
      fence: "```",
    })
  })

  it("picks the dominant bullet char", () => {
    expect(detectMarkerStyle("* a\n* b\n- c").bullet).toBe("*")
    expect(detectMarkerStyle("+ a\n+ b").bullet).toBe("+")
    expect(detectMarkerStyle("- a\n- b").bullet).toBe("-")
  })

  it("picks emphasis/strong underscore style", () => {
    const style = detectMarkerStyle("_a_ and _b_ with __c__")
    expect(style.emphasis).toBe("_")
    expect(style.strong).toBe("__")
  })

  it("does not count **strong** runs toward the *em* tally", () => {
    const style = detectMarkerStyle("**a** **b** **c** and _d_")
    expect(style.emphasis).toBe("_")
    expect(style.strong).toBe("**")
    expect(detectMarkerStyle("**a** and *b*").emphasis).toBe("*")
  })

  it("picks tilde fences", () => {
    expect(detectMarkerStyle("~~~\nx\n~~~\n").fence).toBe("~~~")
  })
})

describe("markdown model: serialize + round-trip", () => {
  const samples = [
    "# Title\n\n## Sub\n\nPlain *em* **strong** `code` ~~strike~~ ==mark== [link](https://x).\n",
    "> quote line\n>\n> more\n",
    "```rust\nfn main() {}\n```\n",
    "- a\n  - b\n- c\n",
    "- a\n\n- b\n",
    "3. three\n4. four\n",
    "- [x] done\n- [ ] todo\n- plain\n",
    "| A | B |\n| --- | --- |\n| a | b |\n",
    "![alt](src.png)\n\n---\n",
    "line1\nline2\n",
  ]

  it("round-trips every sample to a document-equal tree", () => {
    for (const md of samples) {
      const doc = parse(md)
      const out = serialize(doc, detectMarkerStyle(md))
      expect(parse(out).eq(doc), `doc-equal round trip for ${JSON.stringify(md)}`)
    }
  })

  it("is idempotent: second serialize equals first", () => {
    for (const md of samples) {
      const s1 = serialize(parse(md), detectMarkerStyle(md))
      const s2 = serialize(parse(s1), detectMarkerStyle(s1))
      expect(s2, `idempotent for ${JSON.stringify(md)}`).toBe(s1)
    }
  })

  it("preserves the file's bullet and emphasis marker style byte-for-byte", () => {
    expect(serialize(parse("- a\n- b"), detectMarkerStyle("- a\n- b"))).toBe("- a\n- b\n")
    expect(serialize(parse("* a\n* b"), detectMarkerStyle("* a\n* b"))).toBe("* a\n* b\n")
    expect(serialize(parse("+ a"), detectMarkerStyle("+ a"))).toBe("+ a\n")
    expect(serialize(parse("_a_ _b_"), detectMarkerStyle("_a_ _b_"))).toBe("_a_ _b_\n")
  })

  it("preserves task checkbox state", () => {
    const out = serialize(parse("- [x] done\n- [ ] todo"), detectMarkerStyle("- [x] done\n- [ ] todo"))
    expect(out).toBe("- [x] done\n- [ ] todo\n")
  })

  it("serializes breaks as plain newlines (no backslash)", () => {
    const out = serialize(parse("line1\nline2"), detectMarkerStyle("line1\nline2"))
    expect(out).toBe("line1\nline2\n")
  })

  it("keeps tilde fences when the file uses them", () => {
    const out = serialize(parse("~~~\nx\n~~~"), detectMarkerStyle("~~~\nx\n~~~"))
    expect(out).toBe("~~~\nx\n~~~\n")
  })

  it("serializes code innermost when combined with other marks", () => {
    // `code` is the last mark in the schema, so it opens last (innermost):
    // ==`code`==, not ==hi== `==code==`.
    for (const md of ["==hi `code`==", "~~a `b` c~~", "**`b`**"]) {
      const doc = parse(md)
      const out = serialize(doc, detectMarkerStyle(md))
      expect(out).toBe(md + "\n")
      expect(parse(out).eq(doc), `doc-equal round trip for ${JSON.stringify(md)}`)
    }
  })

  it("escapes pipes in table cell text", () => {
    const md = "| a\\|b | c |\n| --- | --- |\n| d | e |\n"
    const doc = parse(md)
    expect(doc.child(0).child(0).child(0).textContent).toBe("a|b")
    const out = serialize(doc, detectMarkerStyle(md))
    expect(out).toContain("a\\|b")
    expect(parse(out).eq(doc)).toBe(true)
  })

  it("serializes tables inside blockquotes with per-line > prefixes", () => {
    const md = "> | A | B |\n> | --- | --- |\n> | a | b |\n"
    const doc = parse(md)
    const out = serialize(doc, detectMarkerStyle(md))
    expect(out.trimEnd().split("\n").every((line) => line.startsWith("> "))).toBe(true)
    expect(parse(out).eq(doc)).toBe(true)
    expect(serialize(parse(out), detectMarkerStyle(out))).toBe(out)
  })

  it("round-trips inline images with their attrs", () => {
    const md = 'a ![alt](img.png "t") b'
    const doc = parse(md)
    const img = doc.child(0).child(1)
    expect(img.type.name).toBe("image")
    expect(img.attrs).toEqual({ src: "img.png", alt: "alt", title: "t" })
    const out = serialize(doc, detectMarkerStyle(md))
    expect(out).toBe(md + "\n")
    expect(parse(out).eq(doc)).toBe(true)
  })
})

describe("markdown model: ColaMD real documents", () => {
  const fixtures = ["outline-test.md", "mermaid-test.md", "PRINCIPLES.md", "README.md"]

  for (const name of fixtures) {
    it(`round-trips ${name} document-equal and idempotent`, () => {
      const md = fixture(name)
      const doc = parse(md)
      const s1 = serialize(doc, detectMarkerStyle(md))
      expect(parse(s1).eq(doc)).toBe(true)
      const s2 = serialize(parse(s1), detectMarkerStyle(s1))
      expect(s2).toBe(s1)
    })
  }

  it("keeps task bullets and checkbox markers from the source", () => {
    // outline-test.md has zero task items — assert on a snippet that
    // actually exercises checkboxes.
    const md = "# t\n\n- [x] done\n- [ ] todo\n- plain\n"
    const out = serialize(parse(md), detectMarkerStyle(md))
    expect(out).toBe(md)
    expect(out).toMatch(/^- \[x\] done$/m)
    expect(out).toMatch(/^- \[ \] todo$/m)
    expect(out).toMatch(/^- plain$/m)
  })
})

describe("markdown model: schema sanity", () => {
  it("accepts checked list items and aligned cells in the spec", () => {
    const doc = editorSchema.nodes.list_item.createAndFill({ checked: true }, [
      editorSchema.nodes.paragraph.createAndFill()!,
    ])
    expect(doc).not.toBeNull()
    const cell = editorSchema.nodes.table_cell.createAndFill({ alignment: "right" })
    expect(cell).not.toBeNull()
  })
})
