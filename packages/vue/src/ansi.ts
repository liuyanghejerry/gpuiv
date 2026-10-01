/** Append-only ANSI log decoding. SGR follows xterm's control-sequence
 * reference: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
 * Non-SGR terminal commands and OSC/DCS payloads are discarded. */
import type { TextRun } from "./types.js"

export const ANSI_PALETTE: readonly string[] = Object.freeze([
  "#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
  "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff",
])

export interface AnsiOptions {
  /** Default colours, also used for inverse video. */
  foreground?: string
  background?: string
  /** The sixteen normal and bright ANSI colours. */
  palette?: readonly string[]
}

export interface AnsiParser {
  /** Decode the next chunk. Incomplete control sequences stay pending. */
  write(chunk: string): TextRun[]
  /** Discard pending controls and restore the initial SGR state. */
  reset(): void
}

type Mode = "text" | "escape" | "csi" | "osc" | "string" | "osc-escape" | "string-escape"
type Attributes = Omit<TextRun, "text">

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`
}

function byte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255
}

/** A parser owns only SGR state and a bounded control prefix, never the log. */
export function createAnsiParser(options: AnsiOptions = {}): AnsiParser {
  const palette = [...(options.palette ?? ANSI_PALETTE)]
  if (palette.length !== 16) throw new Error("ANSI palette must contain sixteen colours")
  const foreground = options.foreground ?? "#d4d4d4"
  const background = options.background ?? "#1e1e1e"
  let mode: Mode = "text"
  let parameters = ""
  let overflow = false
  let afterCR = false
  let attributes: Attributes
  let inverse = false
  let hidden = false

  function resetAttributes(): void {
    attributes = { color: foreground, fontWeight: 400, fontStyle: "normal", underline: false, strikethrough: false }
    inverse = false
    hidden = false
  }
  resetAttributes()

  function indexed(index: number): string | undefined {
    if (!byte(index)) return undefined
    if (index < 16) return palette[index]
    if (index < 232) {
      const n = index - 16
      const levels = [0, 95, 135, 175, 215, 255]
      return hex(levels[Math.floor(n / 36)], levels[Math.floor(n / 6) % 6], levels[n % 6])
    }
    const grey = 8 + (index - 232) * 10
    return hex(grey, grey, grey)
  }

  function sgr(value: string): void {
    const values = value.split(";")
    for (let i = 0; i < values.length; i++) {
      const parts = values[i].split(":")
      const code = Number(parts[0])
      if (code === 38 || code === 48) {
        let colour: string | undefined
        if (parts.length > 1) {
          if (parts[1] === "5" && parts.length === 3 && parts[2] !== "") colour = indexed(Number(parts[2]))
          if (parts[1] === "2" && (parts.length === 5 || parts.length === 6)) {
            const rgb = parts.slice(-3).map((part) => part === "" ? NaN : Number(part))
            if (rgb.every(byte)) colour = hex(rgb[0], rgb[1], rgb[2])
          }
        } else {
          const format = Number(values[++i])
          if (format === 5) { const index = values[++i]; if (index !== "") colour = indexed(Number(index)) }
          if (format === 2) {
            const rgb = [values[++i], values[++i], values[++i]].map((part) => part === "" ? NaN : Number(part))
            if (rgb.every(byte)) colour = hex(rgb[0], rgb[1], rgb[2])
          }
        }
        if (colour) {
          if (code === 38) attributes.color = colour
          else attributes.backgroundColor = colour
        }
      } else if (code === 0) resetAttributes()
      else if (code === 1) attributes.fontWeight = 700
      else if (code === 3) attributes.fontStyle = "italic"
      else if (code === 4 || code === 21) attributes.underline = true
      else if (code === 7) inverse = true
      else if (code === 8) hidden = true
      else if (code === 9) attributes.strikethrough = true
      else if (code === 22) attributes.fontWeight = 400
      else if (code === 23) attributes.fontStyle = "normal"
      else if (code === 24) attributes.underline = false
      else if (code === 27) inverse = false
      else if (code === 28) hidden = false
      else if (code === 29) attributes.strikethrough = false
      else if (code === 39) attributes.color = foreground
      else if (code === 49) delete attributes.backgroundColor
      else if (code >= 30 && code <= 37) attributes.color = palette[code - 30]
      else if (code >= 90 && code <= 97) attributes.color = palette[code - 90 + 8]
      else if (code >= 40 && code <= 47) attributes.backgroundColor = palette[code - 40]
      else if (code >= 100 && code <= 107) attributes.backgroundColor = palette[code - 100 + 8]
    }
  }

  return {
    reset() {
      mode = "text"
      parameters = ""
      overflow = afterCR = false
      resetAttributes()
    },
    write(chunk) {
      const runs: TextRun[] = []
      let lastStyle = ""
      let renderedStyle: Attributes | undefined
      let styleKey = ""
      function append(text: string): void {
        if (!renderedStyle) {
          renderedStyle = { ...attributes }
          if (inverse) {
            renderedStyle.color = attributes.backgroundColor ?? background
            renderedStyle.backgroundColor = attributes.color ?? foreground
          }
          if (hidden) renderedStyle.color = "#00000000"
          styleKey = JSON.stringify(renderedStyle)
        }
        if (styleKey === lastStyle && runs.length) runs[runs.length - 1].text += text
        else { runs.push({ ...renderedStyle, text }); lastStyle = styleKey }
      }
      for (const char of chunk) {
        if (mode === "osc" || mode === "string") {
          if (char === "\u009c" || (mode === "osc" && char === "\u0007")) mode = "text"
          else if (char === "\u001b") mode = mode === "osc" ? "osc-escape" : "string-escape"
          continue
        }
        if (mode === "osc-escape" || mode === "string-escape") {
          if (char === "\\" || char === "\u009c" || (mode === "osc-escape" && char === "\u0007")) mode = "text"
          else if (char !== "\u001b") mode = mode === "osc-escape" ? "osc" : "string"
          continue
        }
        if (mode === "escape") {
          if (char === "[") { mode = "csi"; parameters = ""; overflow = false }
          else if (char === "]") mode = "osc"
          else if ("PX^_".includes(char)) mode = "string"
          else if (char !== "\u001b" && !(char >= " " && char <= "/")) mode = "text"
          continue
        }
        if (mode === "csi") {
          if (char === "\u001b") { mode = "escape"; continue }
          if (char >= "@" && char <= "~") {
            if (char === "m" && !overflow && /^[\d;:]*$/.test(parameters)) {
              sgr(parameters)
              renderedStyle = undefined
            }
            mode = "text"
          } else if (parameters.length < 1024) parameters += char
          else overflow = true
          continue
        }
        if (char === "\u001b") { mode = "escape"; continue }
        if (char === "\u009b") { mode = "csi"; parameters = ""; overflow = false; continue }
        if (char === "\u009d") { mode = "osc"; continue }
        if (char === "\r") { append("\n"); afterCR = true; continue }
        if (char === "\n" && afterCR) { afterCR = false; continue }
        afterCR = false
        if (char === "\n" || char === "\t" || char >= " " && !(char >= "\u007f" && char <= "\u009f")) append(char)
      }
      return runs
    },
  }
}

/** Decode a complete ANSI string to the existing native text-run protocol. */
export function parseAnsi(source: string, options?: AnsiOptions): TextRun[] {
  return createAnsiParser(options).write(source)
}
