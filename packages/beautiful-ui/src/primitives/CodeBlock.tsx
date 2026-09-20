/* ─────────────────────────────────────────────────────────
 * CODE BLOCK — line-numbered listing or unified diff.
 * ───────────────────────────────────────────────────────── */
import { defineComponent, h, ref, type PropType } from "vue"

function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined") {
    const nav = navigator as Navigator & { clipboard: { writeText: (s: string) => Promise<void> } }
    return nav.clipboard.writeText(text)
  }
  return Promise.resolve()
}
import { Chip } from "../atoms/Chip.js"

const FILE = "churn.ts"
const CODE_LINES = ["export async function churnBatch() {", '  const flavor = await getFlavor("pistachio");', "  const base = await dairy.fetch({ flavor });", '  await freezer.store(base, { temp: "-16C" });', "  if (!base.approved) return null;", "  return base.gallons;", "}",]
const DIFF = [
  { old: 1, cur: 1, type: "ctx" as const, pieces: [{ text: "export async function churnBatch() {" }] },
  { old: 2, cur: 2, type: "ctx" as const, pieces: [{ text: '  const flavor = await getFlavor("pistachio");' }] },
  { old: 3, cur: 3, type: "ctx" as const, pieces: [{ text: "  const base = await dairy.fetch({ flavor });" }] },
  { old: 4, cur: null, type: "del" as const, pieces: [{ text: "  await freezer.store(base, { temp: " }, { text: '"-14C"', change: "del" as const }, { text: " });" }] },
  { old: null, cur: 4, type: "add" as const, pieces: [{ text: "  await freezer.store(base, { temp: " }, { text: '"-16C"', change: "add" as const }, { text: " });" }] },
  { old: null, cur: 5, type: "add" as const, pieces: [{ text: "  if (!base.approved) return null;" }] },
  { old: 5, cur: 6, type: "ctx" as const, pieces: [{ text: "  return base.gallons;" }] },
  { old: 6, cur: 7, type: "ctx" as const, pieces: [{ text: "}" }] },
]
const HATCH = "repeating-linear-gradient(45deg, var(--red) 0, var(--red) 1.5px, transparent 1.5px, transparent 3px)"
const KEYWORDS = new Set(["import", "from", "export", "default", "async", "function", "const", "let", "var", "await", "return", "if", "else", "for", "while", "new", "throw", "try", "catch", "null", "true", "false", "undefined"])
const TOKEN = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|\b\d+(?:\.\d+)?\b|\b(?:import|from|export|default|async|function|const|let|var|await|return|if|else|for|while|new|throw|try|catch|null|true|false|undefined)\b|[A-Za-z_$][\w$]*(?=\s*\())/g

function highlight(text: string): ReturnType<typeof h>[] {
  const nodes: ReturnType<typeof h>[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(TOKEN)) {
    const idx = m.index ?? 0
    const t = m[0]
    if (idx > last) nodes.push(h("span", { key: k++ }, [text.slice(last, idx)]))
    let color: string
    let weight: number | undefined
    if (/^["'`]/.test(t) || /^\d/.test(t)) color = "var(--orange)"
    else if (KEYWORDS.has(t)) color = "var(--accent-ink)"
    else { color = "var(--ink)"; weight = 500 }
    nodes.push(h("span", { key: k++, style: { color, fontWeight: weight } }, [t]))
    last = idx + t.length
  }
  if (last < text.length) nodes.push(h("span", { key: k++ }, [text.slice(last)]))
  return nodes
}

function Pieces({ pieces }: { pieces: { text: string; change?: "add" | "del" }[] }) {
  return pieces.map((p, i) => {
    if (p.change) {
      const add = p.change === "add"
      return h("span", { key: i, style: { backgroundColor: `color-mix(in srgb, var(--${add ? "green" : "red"}) 18%, transparent)`, paddingLeft: 2, paddingRight: 2, marginLeft: -1, boxDecorationBreak: "clone" } }, [highlight(p.text) as ReturnType<typeof h>[]])
    }
    return h("span", { key: i }, [highlight(p.text) as ReturnType<typeof h>[]])
  })
}

function FileIcon() {
  return h("svg", { "aria-hidden": true, width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", style: { flexShrink: 0, color: "var(--ink-3)" } }, [h("path", { d: "M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" })])
}

export type CodeBlockProps = { variant?: string; lines?: string[]; code?: string; diff?: typeof DIFF; filename?: string }

export default defineComponent({
  name: "CodeBlock",
  props: { variant: { type: String, default: "Code" }, lines: { type: Array as PropType<string[]>, default: CODE_LINES }, code: { type: String, default: undefined }, diff: { type: Array as PropType<typeof DIFF>, default: DIFF }, filename: { type: String, default: FILE } },
  setup(props) {
    const copied = ref(false)
    const isDiff = props.variant === "Diff"
    const raw = props.code ?? props.lines.join("\n")
    const copy = () => { copyToClipboard(raw).then(() => { copied.value = true; setTimeout(() => { copied.value = false }, 1500) }) }
    const added = props.diff.filter((r) => r.type === "add").length
    const removed = props.diff.filter((r) => r.type === "del").length
    return () =>
      h("div", { style: { width: "100%", maxWidth: 390, overflow: "hidden", borderRadius: 10, backgroundColor: "var(--surface)", boxShadow: "0 0 0 1px var(--line), 0 1px 2px rgba(0,0,0,0.05)" } }, [
        h("div", { style: { display: "flex", height: 44, alignItems: "center", gap: 8, borderBottom: "1px solid var(--line)", paddingLeft: 16, fontSize: 12.5 } }, [
          h("span", { style: { display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 } }, [h(FileIcon()), h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", lineHeight: 1, color: "var(--ink)" } }, [props.filename])]),
          isDiff ? h("span", { style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 2, fontFamily: "var(--font-mono)", fontSize: 12, fontVariantNumeric: "tabular-nums" } }, [h("span", { style: { color: "var(--green)" } }, [`+${added}`]), h("span", { style: { color: "var(--red)" } }, [`-${removed}`])]) :
            h("button", { type: "button", "aria-label": "Copy code", onClick: copy, style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", height: 24, borderRadius: 6, paddingLeft: 6, fontSize: 12, fontWeight: 500, color: copied.value ? "var(--green)" : "var(--ink-3)" } }, [copied.value ? "Copied" : "Copy"]),
        ]),
        h("div", { style: { paddingTop: 12, fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.65, color: "var(--ink-2)" } }, [
          isDiff ? h("div", { style: { position: "relative" } }, [
            h("span", { style: { position: "absolute", insetY: 0, left: 20, width: 1, backgroundColor: "var(--line)" } }),
            ...props.diff.map((r, i) => {
              const add = r.type === "add"; const del = r.type === "del"
              return h("div", { key: i, style: { position: "relative", display: "grid", gridTemplateColumns: "20px 1fr", alignItems: "start", ...(add ? { backgroundColor: "var(--greenTint)" } : del ? { backgroundColor: "var(--redTint)" } : {}) } }, [
                (add || del) ? h("span", { style: { position: "absolute", insetY: 0, left: 0, width: 3, backgroundColor: add ? "var(--green)" : HATCH } }) : null,
                h("span", { style: { userSelect: "none", textAlign: "center", fontSize: 11, color: add ? "var(--green)" : del ? "var(--red)" : "var(--ink-3)" } }, [r.old ?? r.cur ?? ""]),
                h("code", { style: { paddingRight: 12, paddingLeft: 8, overflowWrap: "break-word", whiteSpace: "pre-wrap" } }, [h(Pieces, { pieces: r.pieces })]),
              ])
            }),
          ]) : h("div", { style: { position: "relative" } }, [
            h("span", { style: { position: "absolute", insetY: 0, left: 20, width: 1, backgroundColor: "var(--line)" } }),
            ...props.lines.map((line, i) => h("div", { key: i, style: { display: "grid", gridTemplateColumns: "20px 1fr", alignItems: "start" } }, [
              h("span", { style: { userSelect: "none", textAlign: "center", fontSize: 11, color: "var(--ink-3)" } }, [i + 1]),
              h("code", { style: { paddingRight: 12, paddingLeft: 8, overflowWrap: "break-word", whiteSpace: "pre-wrap" } }, [highlight(line) as ReturnType<typeof h>[]]),
            ])),
          ]),
        ]),
      ])
  },
})
