/// Unit tests for the CSS colour parser behind canvas fill/stroke styles:
/// every supported form (named, hex 3/4/6/8, rgb/rgba, hsl/hsla, color(srgb)),
/// the invalid forms that must parse to null, and the hsl→rgb / lerp /
/// serialize helpers the context getters round-trip through.

import { describe, expect, it } from "vitest"
import { hslToRgb, lerpColor, parseColor, serializeColor } from "../canvas/color.js"

describe("parseColor", () => {
  it("parses named colours case-insensitively with surrounding whitespace", () => {
    expect(parseColor("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor("  RED  ")).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor("RebeccaPurple")).toEqual({ r: 102, g: 51, b: 153, a: 1 })
    expect(parseColor("threedface")).toEqual({ r: 240, g: 240, b: 240, a: 1 })
    // The grey aliases share one value.
    expect(parseColor("gray")).toEqual(parseColor("grey"))
  })

  it("maps transparent to fully transparent black", () => {
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(parseColor("TRANSPARENT")).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it("parses 3-digit hex with digit doubling", () => {
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 })
    expect(parseColor("#ABC")).toEqual({ r: 170, g: 187, b: 204, a: 1 })
  })

  it("parses 4-digit hex alpha with digit doubling", () => {
    expect(parseColor("#abc8")).toEqual({ r: 170, g: 187, b: 204, a: 0x88 / 255 })
  })

  it("parses 6-digit hex", () => {
    expect(parseColor("#ff8000")).toEqual({ r: 255, g: 128, b: 0, a: 1 })
    expect(parseColor("#FF8000")).toEqual({ r: 255, g: 128, b: 0, a: 1 })
  })

  it("parses 8-digit hex alpha as /255", () => {
    expect(parseColor("#ff800080")).toEqual({ r: 255, g: 128, b: 0, a: 128 / 255 })
  })

  it("rejects hex strings that are not 3/4/6/8 hex digits", () => {
    expect(parseColor("#ab")).toBeNull()
    expect(parseColor("#abcde")).toBeNull()
    expect(parseColor("#abcdefghi")).toBeNull()
    expect(parseColor("#")).toBeNull()
    expect(parseColor("#ff00zz")).toBeNull()
    expect(parseColor("#ff00 00")).toBeNull()
  })

  it("rejects non-string and empty inputs", () => {
    expect(parseColor(255 as unknown as string)).toBeNull()
    expect(parseColor(null as unknown as string)).toBeNull()
    expect(parseColor("")).toBeNull()
    expect(parseColor("   ")).toBeNull()
  })

  it("parses legacy comma rgb()", () => {
    expect(parseColor("rgb(255, 0, 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor("RGB(12, 34, 56)")).toEqual({ r: 12, g: 34, b: 56, a: 1 })
  })

  it("parses modern space-separated rgb()", () => {
    expect(parseColor("rgb(255 0 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor("rgb( 12   34  56 )")).toEqual({ r: 12, g: 34, b: 56, a: 1 })
  })

  it("parses slash alpha in rgb()", () => {
    expect(parseColor("rgb(255 0 0 / 0.25)")).toEqual({ r: 255, g: 0, b: 0, a: 0.25 })
    expect(parseColor("rgb(255 0 0 / 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 0.5 })
  })

  it("parses legacy 4-argument rgba()", () => {
    expect(parseColor("rgba(255, 0, 0, 0.5)")).toEqual({ r: 255, g: 0, b: 0, a: 0.5 })
    expect(parseColor("rgba(1, 2, 3, 0)")).toEqual({ r: 1, g: 2, b: 3, a: 0 })
  })

  it("clamps rgb channels from numbers and percentages", () => {
    expect(parseColor("rgb(300, -20, 128)")).toEqual({ r: 255, g: 0, b: 128, a: 1 })
    expect(parseColor("rgb(200%, -10%, 50%)")).toEqual({ r: 255, g: 0, b: 127.5, a: 1 })
    expect(parseColor("rgba(255, 0, 0, 2)")).toEqual({ r: 255, g: 0, b: 0, a: 1 })
  })

  it("rejects malformed rgb()/rgba()", () => {
    expect(parseColor("rgb(255, 0)")).toBeNull()
    expect(parseColor("rgb(255, 0, 0, 0.5, 9)")).toBeNull()
    expect(parseColor("rgb(255, 0, zz)")).toBeNull()
    expect(parseColor("rgba(255, 0, 0, abc)")).toBeNull()
    expect(parseColor("rgb(255 0 0 / abc)")).toBeNull()
    expect(parseColor("rgb")).toBeNull()
    expect(parseColor("rgb(")).toBeNull()
    expect(parseColor(")rgb(")).toBeNull()
  })

  it("parses legacy comma hsl()", () => {
    expect(parseColor("hsl(0, 100%, 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor("hsl(120, 50%, 50%)")).toEqual({ r: 63.75, g: 191.25, b: 63.75, a: 1 })
  })

  it("parses modern hsl() with slash alpha and deg suffixes", () => {
    expect(parseColor("hsl(120 100% 50% / 0.3)")).toEqual({ r: 0, g: 255, b: 0, a: 0.3 })
    expect(parseColor("hsl(90deg, 100%, 50%)")).toEqual({ r: 127.5, g: 255, b: 0, a: 1 })
  })

  it("parses legacy 4-argument hsla()", () => {
    expect(parseColor("hsla(240, 100%, 50%, 0.5)")).toEqual({ r: 0, g: 0, b: 255, a: 0.5 })
    expect(parseColor("hsla(0, 100%, 50%, 0)")).toEqual({ r: 255, g: 0, b: 0, a: 0 })
  })

  it("wraps negative and >360 hue angles", () => {
    expect(parseColor("hsl(-120, 100%, 50%)")).toEqual(parseColor("hsl(240, 100%, 50%)"))
    expect(parseColor("hsl(480, 100%, 50%)")).toEqual(parseColor("hsl(120, 100%, 50%)"))
  })

  it("rejects malformed hsl()/hsla()", () => {
    expect(parseColor("hsl(0, 50%)")).toBeNull()
    expect(parseColor("hsl(0, 100%, 50%, 0.5, 9)")).toBeNull()
    expect(parseColor("hsl(0, abc, 50%)")).toBeNull()
    expect(parseColor("hsl(abc, 100%, 50%)")).toBeNull()
    expect(parseColor("hsla(0, 100%, 50%, xyz)")).toBeNull()
    expect(parseColor("hsl(0 100% 50% / xyz)")).toBeNull()
  })

  it("parses color(srgb r g b) with a trailing alpha channel and percentages", () => {
    expect(parseColor("color(srgb 1 0 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    // The alpha travels as a fourth bare channel; the CSS `/`-separated form
    // is not accepted (see the parser's channel splitting).
    expect(parseColor("color(srgb 1 0 0 0.5)")).toEqual({ r: 255, g: 0, b: 0, a: 0.5 })
    expect(parseColor("color(srgb 100% 0% 0%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor("color(srgb 0.5 0.25 0)")).toEqual({ r: 127.5, g: 63.75, b: 0, a: 1 })
  })

  it("rejects color() in unsupported spaces and shapes", () => {
    expect(parseColor("color(display-p3 1 0 0)")).toBeNull()
    expect(parseColor("color(srgb 1 0)")).toBeNull()
    expect(parseColor("color(srgb 1 0 0 0.5 0.2)")).toBeNull()
    expect(parseColor("color(srgb 1 0 xyz)")).toBeNull()
    expect(parseColor("color(srgb 1 0 0 / abc)")).toBeNull()
    expect(parseColor("color(srgb 1 0 0 abc)")).toBeNull()
    expect(parseColor("color(srgb 1 0 0")).toBeNull()
    expect(parseColor("color(srgb)")).toBeNull()
  })

  it("rejects percentage channels that do not convert", () => {
    expect(parseColor("rgb(255, 0, 5o%)")).toBeNull()
    expect(parseColor("hsl(0, 5o%, 50%)")).toBeNull()
  })

  it("rejects unknown functional forms", () => {
    expect(parseColor("cmyk(0, 0, 0, 0)")).toBeNull()
    expect(parseColor("device-cmyk(0 0 0 0)")).toBeNull()
  })

  it("ignores unknown bare keywords", () => {
    expect(parseColor("notacolor")).toBeNull()
    expect(parseColor("reddish")).toBeNull()
  })
})

describe("hslToRgb", () => {
  it("hits each 60-degree sextant", () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0])
    expect(hslToRgb(60, 1, 0.5)).toEqual([255, 255, 0])
    expect(hslToRgb(120, 1, 0.5)).toEqual([0, 255, 0])
    expect(hslToRgb(180, 1, 0.5)).toEqual([0, 255, 255])
    expect(hslToRgb(240, 1, 0.5)).toEqual([0, 0, 255])
    expect(hslToRgb(300, 1, 0.5)).toEqual([255, 0, 255])
  })

  it("clamps lightness extremes to black and white", () => {
    expect(hslToRgb(0, 1, 0)).toEqual([0, 0, 0])
    expect(hslToRgb(120, 1, 1)).toEqual([255, 255, 255])
    // Saturation/lightness beyond 1 are the caller's contract (parseColor
    // clamps before calling); the raw math still clamps channels to 0–255.
    expect(hslToRgb(200, 3, 2)).toEqual([255, 255, 0])
  })

  it("desaturates towards grey at s = 0", () => {
    expect(hslToRgb(90, 0, 0.5)).toEqual([127.5, 127.5, 127.5])
  })
})

describe("lerpColor", () => {
  const black = { r: 0, g: 0, b: 0, a: 1 }
  const white = { r: 255, g: 255, b: 255, a: 0 }

  it("returns the endpoints at t = 0 and t = 1", () => {
    expect(lerpColor(black, white, 0)).toEqual(black)
    expect(lerpColor(black, white, 1)).toEqual(white)
  })

  it("interpolates every channel at the midpoint", () => {
    expect(lerpColor(black, white, 0.5)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 0.5 })
  })
})

describe("serializeColor", () => {
  it("serializes opaque colours as 6-digit lowercase hex", () => {
    expect(serializeColor({ r: 255, g: 0, b: 0, a: 1 })).toBe("#ff0000")
    expect(serializeColor({ r: 10, g: 20, b: 30, a: 1 })).toBe("#0a141e")
    expect(serializeColor({ r: 0, g: 0, b: 0, a: 1 })).toBe("#000000")
  })

  it("serializes translucent colours as legacy rgba()", () => {
    expect(serializeColor({ r: 255, g: 0, b: 0, a: 0.5 })).toBe("rgba(255, 0, 0, 0.5)")
    expect(serializeColor({ r: 0, g: 0, b: 0, a: 0 })).toBe("rgba(0, 0, 0, 0)")
  })

  it("rounds and clamps channels into range", () => {
    expect(serializeColor({ r: 127.6, g: 0, b: 0, a: 1 })).toBe("#800000")
    expect(serializeColor({ r: 300, g: -5, b: 0, a: 1 })).toBe("#ff0000")
    expect(serializeColor({ r: 300, g: -5, b: 0, a: 0.5 })).toBe("rgba(255, 0, 0, 0.5)")
  })

  it("round-trips parse → serialize → parse for opaque colours", () => {
    for (const spec of ["#abc", "#abcd", "#ff8000", "#ff800080", "rgb(12, 34, 56)", "red"]) {
      const parsed = parseColor(spec)!
      const again = parseColor(serializeColor(parsed))
      expect(again).not.toBeNull()
      expect(again!.r).toBe(Math.round(parsed.r))
      expect(again!.g).toBe(Math.round(parsed.g))
      expect(again!.b).toBe(Math.round(parsed.b))
    }
  })
})
