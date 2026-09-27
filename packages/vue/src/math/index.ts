/** TeX math → self-contained SVG for the read-only `<markdown>` element.
 *
 * KaTeX is a dead end off the DOM (its output is HTML spans + CSS fonts), so
 * this uses MathJax v3 headless with the `liteAdaptor`: no jsdom, glyph
 * outlines bake into `<defs><path>` inside each SVG (`fontCache: "local"`),
 * and the root element carries the layout metadata — `width`/`height` in ex
 * units plus `vertical-align: -<depth>ex` for the baseline.
 *
 * The SVG is post-processed for gpui's rasterizer (usvg/resvg):
 * - `ex` units are rewritten to explicit px, baked at 2× so the GPU
 *   downscale stays crisp (usvg parses unit-less or px sizes only).
 * - A `fill` is injected on the root — MathJax leaves glyph colour to CSS
 *   `color`, and usvg has no colour context (unfilled paths go black).
 * - `vertical-align` is dropped from the SVG (usvg ignores it) and returned
 *   as `depth` px; inline baseline alignment happens at the layout layer.
 *
 * MathJax is imported lazily: apps that never render math never load it.
 */

export interface MathRender {
  /** `data:image/svg+xml;base64,…` — a self-contained SVG sized in px. */
  src: string
  /** Layout width in px. */
  width: number
  /** Layout height in px. */
  height: number
  /** Baseline depth in px: how far the formula's baseline sits below the
   *  surrounding text baseline. Display math centers on it. */
  depth: number
}

export interface RenderMathOptions {
  /** Glyph colour. Defaults to a light neutral that reads on dark themes. */
  color?: string
  /** Pixels per ex unit. 8 matches a 16px body font (MathJax's ratio). */
  exPx?: number
  /** Raster bake multiple — the SVG's intrinsic size is this times the
   *  layout size. Defaults to 2. */
  scale?: number
}

/** A `<markdown math>` map entry, keyed by the exact TeX source. */
export type MathMap = Record<string, MathRender>

interface MathJaxState {
  adaptor: {
    outerHTML(node: unknown): string
  }
  doc: {
    convert(tex: string, options: Record<string, unknown>): unknown
  }
}

let mathjaxState: Promise<MathJaxState> | null = null

async function ensureMathJax(): Promise<MathJaxState> {
  mathjaxState ??= (async () => {
    const { mathjax } = await import("mathjax-full/js/mathjax.js")
    const { TeX } = await import("mathjax-full/js/input/tex.js")
    const { SVG } = await import("mathjax-full/js/output/svg.js")
    const { liteAdaptor } = await import("mathjax-full/js/adaptors/liteAdaptor.js")
    const { RegisterHTMLHandler } = await import("mathjax-full/js/handlers/html.js")
    const { AllPackages } = await import("mathjax-full/js/input/tex/AllPackages.js")

    const adaptor = liteAdaptor()
    RegisterHTMLHandler(adaptor)
    const tex = new TeX({ packages: AllPackages })
    const svg = new SVG({ fontCache: "local" })
    const doc = mathjax.document("", { InputJax: tex, OutputJax: svg })
    return { adaptor, doc }
  })()
  return mathjaxState
}

function encodeDataUrl(svg: string): string {
  if (typeof Buffer !== "undefined") {
    return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`
  }
  // UTF-8 safe btoa for non-Node runtimes.
  const bytes = encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  )
  return `data:image/svg+xml;base64,${btoa(bytes)}`
}

/** Parse `width="8.699ex"` / `style="vertical-align: -0.186ex;"` on the root. */
function exUnits(value: string): number | null {
  const match = /^(-?[\d.]+)ex$/.exec(value.trim())
  return match ? Number.parseFloat(match[1]) : null
}

/** Render one formula. Results are cached per (tex, display, options). */
export async function renderMath(
  tex: string,
  display: boolean,
  options: RenderMathOptions = {},
): Promise<MathRender> {
  const color = options.color ?? "#e8e8e8"
  const exPx = options.exPx ?? 8
  const scale = options.scale ?? 2
  const cacheKey = `${display ? "$$" : "$"}${tex}|${color}|${exPx}|${scale}`
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const { adaptor, doc } = await ensureMathJax()
  const node = doc.convert(tex, { display, em: 16, ex: exPx, containerWidth: 1280 })
  const outer = adaptor.outerHTML(node)
  const start = outer.indexOf("<svg")
  const end = outer.lastIndexOf("</svg>")
  if (start < 0 || end < 0) {
    throw new Error(`MathJax produced no SVG for ${tex.slice(0, 40)}`)
  }
  let svg = outer.slice(start, end + "</svg>".length)

  const widthMatch = /width="(-?[\d.]+ex)"/.exec(svg)
  const heightMatch = /height="(-?[\d.]+ex)"/.exec(svg)
  const depthMatch = /vertical-align:\s*(-?[\d.]+)ex/.exec(svg)
  const widthEx = widthMatch ? (exUnits(widthMatch[1]) ?? 0) : 0
  const heightEx = heightMatch ? (exUnits(heightMatch[1]) ?? 0) : 0
  const depthEx = depthMatch ? Number.parseFloat(depthMatch[1]) : 0

  const width = widthEx * exPx
  const height = heightEx * exPx
  const depth = -depthEx * exPx

  if (widthMatch) {
    svg = svg.replace(widthMatch[0], `width="${width * scale}px"`)
  }
  if (heightMatch) {
    svg = svg.replace(heightMatch[0], `height="${height * scale}px"`)
  }
  // usvg has no CSS colour context and resolves `currentColor` to black —
  // MathJax wraps its glyph groups in fill="currentColor", so the root fill
  // below is not enough. Rewrite every occurrence to the requested colour.
  svg = svg.split("currentColor").join(color)
  svg = svg.replace(/^<svg/, `<svg fill="${color}"`)
  // The layout layer owns baseline placement; usvg ignores this anyway.
  svg = svg.replace(/ vertical-align:\s*-?[\d.]+ex;?/, "")

  const render: MathRender = { src: encodeDataUrl(svg), width, height, depth }
  if (cache.size > 256) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(cacheKey, render)
  return render
}

const cache = new Map<string, MathRender>()

/** Scan markdown source for `$$display$$` and `$inline$` formulas, skipping
 *  fenced and inline code spans, and render each distinct formula once. */
export async function renderMathMap(
  source: string,
  options: RenderMathOptions = {},
): Promise<MathMap> {
  const formulas = new Set<{ tex: string; display: boolean }>()
  let i = 0
  while (i < source.length) {
    if (source.startsWith("```", i)) {
      const close = source.indexOf("```", i + 3)
      i = close < 0 ? source.length : close + 3
      continue
    }
    const char = source[i]
    if (char === "`") {
      const close = source.indexOf("`", i + 1)
      i = close < 0 ? source.length : close + 1
      continue
    }
    if (char === "$") {
      const display = source.startsWith("$$", i)
      const marker = display ? "$$" : "$"
      const start = i + marker.length
      let end: number
      if (display) {
        end = source.indexOf(marker, start)
      } else {
        // Inline math never crosses a newline.
        const nl = source.indexOf("\n", start)
        const close = source.indexOf(marker, start)
        end = close >= 0 && (nl < 0 || close < nl) ? close : -1
      }
      if (end > start) {
        const tex = source.slice(start, end).trim()
        if (tex) formulas.add({ tex, display })
        i = end + marker.length
        continue
      }
    }
    i += 1
  }

  const map: MathMap = {}
  for (const { tex, display } of formulas) {
    map[tex] = await renderMath(tex, display, options)
  }
  return map
}
