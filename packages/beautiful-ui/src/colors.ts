/** Colour helpers — the runtime answer to globals.css's `color-mix()`.
 *
 *  beautiful-ui derives tinted tags, status pills and gridlines with
 *  `color-mix(in srgb, <token> N%, transparent|white|…)`. GPUIV colours are
 *  parsed from strings at the Rust boundary, so the mixing has to happen
 *  here, in JS, before styles cross the FFI.
 *
 *  Inputs may be `oklch(L C H / A)` strings (all design tokens are) or
 *  `#rgb`/`#rrggbb` hex. Mixing happens in the oklch polar space, which is
 *  close enough to the source's srgb mixes at these low chromas.
 */

interface Oklch {
  l: number
  c: number
  h: number
  a: number
}

const OKLCH_RE = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/

/** srgb channel (0–1) → oklch. Standard Björn Ottosson matrices. */
function srgbToOklch(r: number, g: number, b: number, a: number): Oklch {
  const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb
  const lRoot = Math.cbrt(l)
  const mRoot = Math.cbrt(m)
  const sRoot = Math.cbrt(s)
  const okL = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot
  const okA = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot
  const okB = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot
  return { l: okL, c: Math.hypot(okA, okB), h: ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360, a }
}

function oklchToSrgb({ l, c, h, a }: Oklch): [number, number, number, number] {
  const hRad = (h * Math.PI) / 180
  const okA = c * Math.cos(hRad)
  const okB = c * Math.sin(hRad)
  const lRoot = l + 0.3963377774 * okA + 0.2158037573 * okB
  const mRoot = l - 0.1055613458 * okA - 0.0638541728 * okB
  const sRoot = l - 0.0894841775 * okA - 1.291485548 * okB
  const l3 = lRoot ** 3
  const m3 = mRoot ** 3
  const s3 = sRoot ** 3
  const toGamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)
  const r = toGamma(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3)
  const g = toGamma(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3)
  const b = toGamma(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3)
  const clamp = (x: number) => Math.min(1, Math.max(0, x))
  return [clamp(r), clamp(g), clamp(b), a]
}

export function parseColor(color: string): Oklch {
  const oklch = OKLCH_RE.exec(color.trim())
  if (oklch) {
    const alphaRaw = oklch[4]
    const a = alphaRaw === undefined ? 1 : alphaRaw.endsWith("%") ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw)
    return { l: parseFloat(oklch[1]), c: parseFloat(oklch[2]), h: parseFloat(oklch[3]), a }
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (hex) {
    let body = hex[1]
    if (body.length === 3) body = body.split("").map((c) => c + c).join("")
    const r = parseInt(body.slice(0, 2), 16) / 255
    const g = parseInt(body.slice(2, 4), 16) / 255
    const b = parseInt(body.slice(4, 6), 16) / 255
    return srgbToOklch(r, g, b, 1)
  }
  throw new Error(`@gpuiv/beautiful-ui: cannot parse colour "${color}" (expected oklch() or #hex)`)
}

function format({ l, c, h, a }: Oklch): string {
  const round = (x: number) => Math.round(x * 1000) / 1000
  return a >= 1
    ? `oklch(${round(l)} ${round(c)} ${round(h)})`
    : `oklch(${round(l)} ${round(c)} ${round(h)} / ${round(a)})`
}

/** `color-mix(in oklch, a, b p%)` — p is the percentage of `b` (0–100). */
export function mix(a: string, b: string, p: number): string {
  const ca = parseColor(a)
  const cb = parseColor(b)
  const t = p / 100
  // Shortest arc around the hue circle.
  let dh = cb.h - ca.h
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  return format({
    l: ca.l + (cb.l - ca.l) * t,
    c: ca.c + (cb.c - ca.c) * t,
    h: (ca.h + dh * t + 360) % 360,
    a: ca.a + (cb.a - ca.a) * t,
  })
}

/** Same colour with its alpha multiplied by `factor` — `color-mix(x N%, transparent)`. */
export function withAlpha(color: string, factor: number): string {
  const c = parseColor(color)
  return format({ ...c, a: c.a * factor })
}

/** Resolve a colour to `rgb()/rgba()` — for spots where a flat srgb value reads better in diffs. */
export function toSrgb(color: string): string {
  const [r, g, b, a] = oklchToSrgb(parseColor(color))
  const chan = (x: number) => Math.round(x * 255)
  return a >= 1
    ? `rgb(${chan(r)}, ${chan(g)}, ${chan(b)})`
    : `rgba(${chan(r)}, ${chan(g)}, ${chan(b)}, ${Math.round(a * 1000) / 1000})`
}
