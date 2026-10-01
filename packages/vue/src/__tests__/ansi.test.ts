import { describe, expect, it } from "vitest"
import { ANSI_PALETTE, createAnsiParser, parseAnsi } from "../ansi.js"
import type { TextRun } from "../types.js"

const text = (runs: TextRun[]) => runs.map((run) => run.text).join("")
const characters = (runs: TextRun[]) => runs.flatMap(({ text, ...style }) => [...text].map((char) => ({ char, ...style })))

describe("ANSI log decoding", () => {
  it("decodes normal, bright and background colours and resets each attribute", () => {
    const runs = parseAnsi("\x1b[31;104;1;3;4;9mstyled\x1b[22;23;24;29;39;49mplain")
    expect(runs[0]).toMatchObject({ text: "styled", color: ANSI_PALETTE[1], backgroundColor: ANSI_PALETTE[12], fontWeight: 700,
      fontStyle: "italic", underline: true, strikethrough: true })
    expect(runs[1]).toMatchObject({ text: "plain", color: "#d4d4d4", fontWeight: 400, fontStyle: "normal", underline: false, strikethrough: false })
    expect(runs[1].backgroundColor).toBeUndefined()
  })

  it("decodes indexed and RGB colours with semicolon and colon forms", () => {
    const runs = parseAnsi("\x1b[38;5;196mred\x1b[48:5:232mblack\x1b[38;2;10;20;30mrgb\x1b[48:2::40:50:60mbackground")
    expect(runs[0].color).toBe("#ff0000")
    expect(runs[1].backgroundColor).toBe("#080808")
    expect(runs[2].color).toBe("#0a141e")
    expect(runs[3].backgroundColor).toBe("#28323c")
    expect(parseAnsi("\x1b[38:2:1:2:3mx")[0].color).toBe("#010203")
    expect(parseAnsi("\x1b[38;5;255mx")[0].color).toBe("#eeeeee")
  })

  it("does not reinterpret malformed RGB components as font attributes", () => {
    const runs = parseAnsi("\x1b[38;2;999;1;3mx\x1b[48;5;999my")
    expect(text(runs)).toBe("xy")
    expect(runs[0]).toMatchObject({ color: "#d4d4d4", fontWeight: 400, fontStyle: "normal" })
    expect(runs[0].backgroundColor).toBeUndefined()
  })

  it("keeps styling and control sequences correct across every chunk boundary", () => {
    const source = "你好 \x1b[1;38;2;20;40;60mred\x1b[0m\r\n\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x07\x1b[2Jdone"
    const expected = characters(parseAnsi(source))
    for (let split = 0; split <= source.length; split++) {
      const parser = createAnsiParser()
      expect(characters([...parser.write(source.slice(0, split)), ...parser.write(source.slice(split))])).toEqual(expected)
    }
    const parser = createAnsiParser()
    expect(characters([...source].flatMap((char) => parser.write(char)))).toEqual(expected)
  })

  it("discards OSC, DCS, cursor commands, charset selectors and incomplete controls", () => {
    expect(text(parseAnsi("a\x1b]0;secret title\x07b\x1bPsecret payload\x1b\\c\x1b[2Jd\x1b(Be\x1b[31"))).toBe("abcde")
    expect(text(parseAnsi(`a\x1b[${"1".repeat(2000)}mb`))).toBe("ab")
  })

  it("normalizes CR, LF and CRLF without adding two lines for a split CRLF", () => {
    const parser = createAnsiParser()
    expect(text([...parser.write("a\r"), ...parser.write("\nb\rc\n")])).toBe("a\nb\nc\n")
  })

  it("supports palette overrides, inverse video and parser reuse after reset", () => {
    const palette = [...ANSI_PALETTE]; palette[1] = "#123456"
    const parser = createAnsiParser({ palette, foreground: "#aaaaaa", background: "#111111" })
    expect(parser.write("\x1b[31mred")[0].color).toBe("#123456")
    expect(parser.write("\x1b[7minverse")[0]).toMatchObject({ color: "#111111", backgroundColor: "#123456" })
    parser.write("\x1b]pending")
    parser.reset()
    expect(parser.write("normal")[0]).toMatchObject({ text: "normal", color: "#aaaaaa", fontWeight: 400 })
    expect(() => createAnsiParser({ palette: [] })).toThrow(/sixteen/)
  })
})
