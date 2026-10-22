/// Non-native unit tests for the MathJax→SVG pipeline in src/math: option
/// handling, SVG post-processing (px rewrite, colour baking, baseline), the
/// render cache, and the markdown formula scanner's edge cases. MathJax is
/// real for a few integration cases and faked (fast, shape-controlled SVG)
/// for the post-processing branches real MathJax never emits.

import { afterEach, describe, expect, it, vi } from "vitest"
import { renderMath, renderMathMap } from "../math/index.js"

const MATHJAX_MODULES = [
  "mathjax-full/js/mathjax.js",
  "mathjax-full/js/input/tex.js",
  "mathjax-full/js/output/svg.js",
  "mathjax-full/js/adaptors/liteAdaptor.js",
  "mathjax-full/js/handlers/html.js",
  "mathjax-full/js/input/tex/AllPackages.js",
]

/** A fresh math module whose MathJax is replaced by a converter that renders
 * each TeX string to `outerHTML(tex)` — no real typesetting, same interface. */
async function mathWithFakeMathJax(outerHTML: (tex: string) => string) {
  vi.resetModules()
  vi.doMock("mathjax-full/js/mathjax.js", () => ({
    mathjax: { document: () => ({ convert: (tex: string) => ({ tex }) }) },
  }))
  vi.doMock("mathjax-full/js/input/tex.js", () => ({ TeX: class {} }))
  vi.doMock("mathjax-full/js/output/svg.js", () => ({ SVG: class {} }))
  vi.doMock("mathjax-full/js/adaptors/liteAdaptor.js", () => ({
    liteAdaptor: () => ({ outerHTML: (node: { tex: string }) => outerHTML(node.tex) }),
  }))
  vi.doMock("mathjax-full/js/handlers/html.js", () => ({ RegisterHTMLHandler: () => {} }))
  vi.doMock("mathjax-full/js/input/tex/AllPackages.js", () => ({ AllPackages: [] }))
  return await import("../math/index.js")
}

afterEach(() => {
  for (const name of MATHJAX_MODULES) vi.doUnmock(name)
  vi.resetModules()
  vi.unstubAllGlobals()
})

function decodeSrc(src: string): string {
  return Buffer.from(src.slice(src.indexOf(",") + 1), "base64").toString("utf8")
}

describe("renderMath with real MathJax", () => {
  it("bakes px sizes and the requested colour into a self-contained SVG", async () => {
    const render = await renderMath("x^2 + 1", true, { color: "#123456", exPx: 10, scale: 3 })
    const svg = decodeSrc(render.src)
    expect(render.src.startsWith("data:image/svg+xml;base64,")).toBe(true)
    expect(svg).toContain('fill="#123456"')
    expect(svg).not.toContain("currentColor")
    expect(svg).toMatch(/width="\d+(\.\d+)?px"/)
    expect(render.width).toBeGreaterThan(0)
    expect(render.height).toBeGreaterThan(0)
    expect(Number.isFinite(render.depth)).toBe(true)
  })

  it("caches per formula and options", async () => {
    const first = await renderMath("a+b", false)
    expect(await renderMath("a+b", false)).toBe(first)
    expect(await renderMath("a+b", true)).not.toBe(first)
    expect(await renderMath("a+b", false, { color: "#ffffff" })).not.toBe(first)
  })
})

describe("renderMath SVG post-processing (fake MathJax)", () => {
  const svgOf = (attrs: string, body = "<path/>") =>
    `<mjx-container><svg ${attrs} style="vertical-align: -0.5ex;">${body}</svg></mjx-container>`

  it("throws when MathJax produces no SVG", async () => {
    const math = await mathWithFakeMathJax(() => "<span>no svg here</span>")
    await expect(math.renderMath("x", true)).rejects.toThrow("produced no SVG")
  })

  it("reads ex units, rewrites sizes and bakes the colour", async () => {
    const math = await mathWithFakeMathJax(() => svgOf('width="8.5ex" height="2.25ex"'))
    const render = await math.renderMath("y", false, { color: "#abcdef", exPx: 4, scale: 2 })
    expect(render).toMatchObject({ width: 34, height: 9, depth: 2 })
    const svg = decodeSrc(render.src)
    expect(svg).toContain('width="68px"')
    expect(svg).toContain('height="18px"')
    expect(svg).toContain('<svg fill="#abcdef"')
  })

  it("falls back to zero for missing or non-ex dimensions", async () => {
    const math = await mathWithFakeMathJax(() => svgOf('width="400px" height="1ex"'))
    const render = await math.renderMath("z", true, { exPx: 5 })
    expect(render).toMatchObject({ width: 0, height: 5 })
    const svg = decodeSrc(render.src)
    expect(svg).toContain('width="400px"')
    expect(svg).toContain('height="10px"')
  })

  it("strips a space-prefixed vertical-align but not the quote-prefixed form MathJax emits", async () => {
    // The strip regex needs a leading space, which real MathJax never emits
    // (style="vertical-align: …"); the quote-prefixed declaration survives —
    // harmless, usvg ignores it, and the baseline travels via `depth`.
    const spaced = await mathWithFakeMathJax(
      () => `<svg width="1ex" height="1ex" style="color: red; vertical-align: -0.5ex;"><path/></svg>`,
    )
    expect(decodeSrc((await spaced.renderMath("a", false)).src)).not.toContain("vertical-align")

    const quoted = await mathWithFakeMathJax(() => svgOf('width="1ex" height="1ex"'))
    expect(decodeSrc((await quoted.renderMath("a", false)).src)).toContain("vertical-align")
    expect((await quoted.renderMath("a", false)).depth).toBe(4)

    const withoutAlign = await mathWithFakeMathJax(() => `<svg width="1ex" height="1ex"><path/></svg>`)
    expect(decodeSrc((await withoutAlign.renderMath("a", false)).src)).not.toContain("vertical-align")
    expect((await withoutAlign.renderMath("a", false)).depth).toBe(-0)
  })

  it("evicts the oldest cache entry past 256 formulas", async () => {
    const math = await mathWithFakeMathJax(() => svgOf('width="1ex" height="1ex"'))
    const first = await math.renderMath("f0", false)
    for (let index = 1; index < 300; index++) await math.renderMath(`f${index}`, false)
    expect(await math.renderMath("f0", false)).not.toBe(first)
  })

  it("encodes through the UTF-8-safe btoa path when Buffer is unavailable", async () => {
    const math = await mathWithFakeMathJax(() => svgOf('width="1ex" height="1ex"', "<text>δ</text>"))
    vi.stubGlobal("Buffer", undefined)
    const render = await math.renderMath("δ", true)
    vi.unstubAllGlobals()
    expect(decodeSrc(render.src)).toContain("δ")
  })
})

describe("renderMathMap scanning edges (fake MathJax)", () => {
  const emptyMath = () => mathWithFakeMathJax(() => `<svg width="1ex" height="1ex"><path/></svg>`)

  it("scans display and inline math while skipping code spans", async () => {
    const math = await emptyMath()
    const map = await math.renderMathMap("$$display$$ and $in$ but `$code$` and\n```\n$$fence$$\n```")
    expect(Object.keys(map).sort()).toEqual(["display", "in"])
  })

  it("ignores unterminated fences, code spans and display markers", async () => {
    const math = await emptyMath()
    expect(Object.keys(await math.renderMathMap("```\n$x$"))).toEqual([])
    expect(Object.keys(await math.renderMathMap("`\n$x$"))).toEqual([])
    expect(Object.keys(await math.renderMathMap("a $$never closed"))).toEqual([])
  })

  it("skips empty formulas but keeps their valid siblings", async () => {
    const math = await emptyMath()
    const map = await math.renderMathMap("$$ $$ and $x$")
    expect(Object.keys(map)).toEqual(["x"])
  })

  it("keeps inline math from crossing newlines while display math may", async () => {
    const math = await emptyMath()
    expect(Object.keys(await math.renderMathMap("price $5\nand $x$ here"))).toEqual(["x"])
    expect(Object.keys(await math.renderMathMap("$$a\nb$$"))).toEqual(["a\nb"])
  })

  it("renders each distinct formula once", async () => {
    const math = await emptyMath()
    const map = await math.renderMathMap("$x$ mid $x$ end $y$")
    expect(Object.keys(map).sort()).toEqual(["x", "y"])
  })
})
