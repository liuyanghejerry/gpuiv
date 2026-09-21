/** CODE BLOCK — a light editor panel with two variants (switch via `variant`):
 *    · "Code" — a line-numbered listing painted by the native `<code>`
 *      element (Syntect highlighting), under the original's header bar
 *      (file icon + filename + language label + copy button).
 *    · "Diff" — a unified diff: number gutter, +/- sign gutter, a green/red
 *      accent bar and row tint, plus word-level add/del piece tints.
 *
 *  Ported from beautiful-ui `components/primitives/CodeBlock.tsx`.
 *
 *  Platform degradations vs. the web original:
 *  - The hand-written regex highlighter is NOT ported. The Code view uses
 *    GPUIV's native `<code>` element (Syntect) with the source palette mapped
 *    onto our tokens (keyword → accentInk, string/number → orange, function
 *    call → ink). Diff rows render as plain mono text — no syntax coloring
 *    inside the diff.
 *  - Native `<code>` lines never wrap; a long line pans horizontally inside
 *    the block (the element owns that scroller). The original wrapped.
 *  - The deletion accent bar's repeating-linear-gradient hatch becomes a
 *    solid red bar — GPUIV has no repeating gradients.
 *  - The 1px rule beside the gutter exists only in the Diff view; the native
 *    `<code>` gutter cannot be overlaid, so the Code view drops it.
 *  - `transition-colors` becomes GPUIV's instant native hover swap, and the
 *    copy icon does not follow the label's hover colour.
 *  - `tabular-nums` does not exist; the diff stat just uses the mono font.
 *  - Word-level piece tints keep the original's 18% alpha via `withAlpha`;
 *    the `box-decoration-break: clone` padding nuance is dropped.
 *  - Copy goes through the native clipboard (`renderer.writeClipboardText`,
 *    synchronous) and shows "Copied" for 1.2s.
 */

import { computed, defineComponent, onBeforeUnmount, ref, type PropType } from "vue"
import { useGpuix, type GpuixTheme } from "@gpuiv/vue"
import { fonts, radius } from "../tokens.js"
import { useTheme } from "../theme.js"
import { withAlpha } from "../colors.js"
import { Icon } from "../atoms/Icon.js"

/* A single run of code within a diff row; `change` tints it as an add/del. */
export type CodePiece = { text: string; change?: "add" | "del" }
/* One row of a unified diff: old/new line numbers, its kind, and its pieces. */
export type DiffRow = {
  old: number | null
  cur: number | null
  type: "ctx" | "add" | "del"
  pieces: CodePiece[]
}
/* Prominent copy strings on the code block. */
export type CodeBlockLabels = { copy: string; copied: string }
export type CodeBlockVariant = "Code" | "Diff"

export interface CodeBlockProps {
  /** Which view to render — "Code" (line-numbered listing) or "Diff". */
  variant?: CodeBlockVariant
  /** The lines shown in the Code view. */
  lines?: string[]
  /** Raw text placed on the clipboard by Copy. Defaults to `lines` joined. */
  code?: string
  /** The unified-diff rows shown in the Diff view. */
  diff?: DiffRow[]
  /** Filename shown in the header. */
  filename?: string
  /** Syntect language for the Code view; also shown as a header label. */
  language?: string
  /** Prominent copy strings. */
  labels?: Partial<CodeBlockLabels>
  /** Called with the copied text after a successful copy. */
  onCopy?: (text: string) => void
}

const FILE = "churn.ts"

const CODE_LINES = [
  "export async function churnBatch() {",
  '  const flavor = await getFlavor("pistachio");',
  "  const base = await dairy.fetch({ flavor });",
  '  await freezer.store(base, { temp: "-16C" });',
  "  if (!base.approved) return null;",
  "  return base.gallons;",
  "}",
]

const DIFF: DiffRow[] = [
  { old: 1, cur: 1, type: "ctx", pieces: [{ text: "export async function churnBatch() {" }] },
  { old: 2, cur: 2, type: "ctx", pieces: [{ text: '  const flavor = await getFlavor("pistachio");' }] },
  { old: 3, cur: 3, type: "ctx", pieces: [{ text: "  const base = await dairy.fetch({ flavor });" }] },
  { old: 4, cur: null, type: "del", pieces: [{ text: "  await freezer.store(base, { temp: " }, { text: '"-14C"', change: "del" }, { text: " });" }] },
  { old: null, cur: 4, type: "add", pieces: [{ text: "  await freezer.store(base, { temp: " }, { text: '"-16C"', change: "add" }, { text: " });" }] },
  { old: null, cur: 5, type: "add", pieces: [{ text: "  if (!base.approved) return null;" }] },
  { old: 5, cur: 6, type: "ctx", pieces: [{ text: "  return base.gallons;" }] },
  { old: 6, cur: 7, type: "ctx", pieces: [{ text: "}" }] },
]

const DEFAULT_LABELS: CodeBlockLabels = { copy: "Copy", copied: "Copied" }

/* The source's text-[12.5px] leading-[1.65], in px (GPUIV line heights are px). */
const CODE_FONT_SIZE = 12.5
const CODE_LINE_HEIGHT = 21

export const CodeBlock = defineComponent({
  name: "BuiCodeBlock",
  props: {
    variant: { type: String as PropType<CodeBlockVariant>, default: "Code" },
    lines: { type: Array as PropType<string[]>, default: () => CODE_LINES },
    code: { type: String, default: undefined },
    diff: { type: Array as PropType<DiffRow[]>, default: () => DIFF },
    filename: { type: String, default: FILE },
    language: { type: String, default: "typescript" },
    labels: { type: Object as PropType<Partial<CodeBlockLabels>>, default: undefined },
    onCopy: { type: Function as PropType<(text: string) => void>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    const { renderer } = useGpuix()
    const copied = ref(false)
    let copyTimer: ReturnType<typeof setTimeout> | undefined

    const copy = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }))
    const isDiff = computed(() => props.variant === "Diff")
    const raw = computed(() => props.code ?? props.lines.join("\n"))
    const added = computed(() => props.diff.filter((row) => row.type === "add").length)
    const removed = computed(() => props.diff.filter((row) => row.type === "del").length)

    function copySource() {
      renderer?.writeClipboardText?.(raw.value)
      copied.value = true
      props.onCopy?.(raw.value)
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => {
        copied.value = false
      }, 1200)
    }
    onBeforeUnmount(() => clearTimeout(copyTimer))

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      // The native element's palette: body text, the line-number gutter, and
      // the syntax captures the original regex highlighter painted.
      const codeTheme: GpuixTheme = {
        appearance: theme.isDark.value ? "dark" : "light",
        codeText: t.ink2,
        textFaint: t.ink3,
        fontMono: fonts.mono,
        syntax: {
          keyword: t.accentInk,
          string: t.orange,
          number: t.orange,
          function: t.ink,
          // `SyntaxTheme.constructor` collides with Object.prototype.constructor
          // in a plain assignment check; the assertion sidesteps it.
        } as GpuixTheme["syntax"],
      }
      return (
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            overflow: "hidden",
            borderRadius: radius.card,
            backgroundColor: t.surface,
            ...shadows.card,
          }}
        >
          {/* header — file · language · (diff stat | copy) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 44,
              paddingLeft: 16,
              paddingRight: 16,
              borderBottomWidth: 1,
              borderColor: t.line,
              userSelect: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              <Icon name="fileCode" size={15} color={t.ink3} />
              <div
                style={{
                  fontSize: 12.5,
                  fontFamily: fonts.mono,
                  color: t.ink,
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
              >
                {props.filename}
              </div>
            </div>
            <div style={{ fontSize: 11, fontFamily: fonts.mono, color: t.ink3 }}>{props.language}</div>
            <div style={{ flexGrow: 1 }} />

            {isDiff.value ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, fontFamily: fonts.mono, color: t.green }}>{`+${added.value}`}</div>
                <div style={{ fontSize: 12, fontFamily: fonts.mono, color: t.red }}>{`-${removed.value}`}</div>
              </div>
            ) : (
              <div
                role="button"
                aria-label="Copy code"
                onClick={copySource}
                style={{
                  marginRight: -4,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  height: 24,
                  paddingLeft: 6,
                  paddingRight: 6,
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  color: copied.value ? t.green : t.ink3,
                  cursor: "pointer",
                  hover: { backgroundColor: t.hover, color: copied.value ? t.green : t.ink },
                }}
              >
                <Icon name={copied.value ? "check" : "copy"} size={11} color={copied.value ? t.green : t.ink3} />
                {copied.value ? copy.value.copied : copy.value.copy}
              </div>
            )}
          </div>

          {/* body */}
          {isDiff.value ? (
            <div style={{ position: "relative", paddingTop: 12, paddingBottom: 12 }}>
              <div
                style={{
                  position: "absolute",
                  left: 20,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  backgroundColor: t.line,
                  pointerEvents: "none",
                }}
              />
              {props.diff.map((row, i) => {
                const add = row.type === "add"
                const del = row.type === "del"
                // One number column: removals keep the old number,
                // additions/context show the new one.
                const num = del ? row.old : row.cur
                return (
                  <div
                    key={i}
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "flex-start",
                      backgroundColor: add ? t.greenTint : del ? t.redTint : undefined,
                    }}
                  >
                    {(add || del) && (
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: 3,
                          backgroundColor: add ? t.green : t.red,
                        }}
                      />
                    )}
                    <div
                      style={{
                        width: 20,
                        flexShrink: 0,
                        textAlign: "center",
                        fontSize: 11,
                        lineHeight: CODE_LINE_HEIGHT,
                        fontFamily: fonts.mono,
                        color: add ? t.green : del ? t.red : t.ink3,
                        userSelect: "none",
                      }}
                    >
                      {num ?? ""}
                    </div>
                    <div
                      style={{
                        width: 12,
                        flexShrink: 0,
                        textAlign: "center",
                        fontSize: 11,
                        lineHeight: CODE_LINE_HEIGHT,
                        fontFamily: fonts.mono,
                        color: add ? t.green : del ? t.red : t.ink3,
                        userSelect: "none",
                      }}
                    >
                      {add ? "+" : del ? "-" : ""}
                    </div>
                    <div
                      style={{
                        flexGrow: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "row",
                        flexWrap: "wrap",
                        paddingLeft: 4,
                        paddingRight: 12,
                      }}
                    >
                      {row.pieces.map((piece, j) => (
                        <text
                          key={j}
                          style={{
                            fontSize: CODE_FONT_SIZE,
                            lineHeight: CODE_LINE_HEIGHT,
                            fontFamily: fonts.mono,
                            color: t.ink2,
                            ...(piece.change
                              ? {
                                  backgroundColor: withAlpha(piece.change === "add" ? t.green : t.red, 0.18),
                                  borderRadius: 3,
                                  paddingLeft: 2,
                                  paddingRight: 2,
                                }
                              : {}),
                          }}
                        >
                          {piece.text}
                        </text>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <code
              code={props.lines.join("\n")}
              language={props.language}
              showLineNumbers={true}
              theme={codeTheme}
              style={{
                minWidth: 0,
                paddingTop: 12,
                paddingBottom: 12,
                paddingLeft: 12,
                paddingRight: 12,
                fontSize: CODE_FONT_SIZE,
                lineHeight: CODE_LINE_HEIGHT,
                fontFamily: fonts.mono,
                color: t.ink2,
              }}
            />
          )}
        </div>
      )
    }
  },
})
