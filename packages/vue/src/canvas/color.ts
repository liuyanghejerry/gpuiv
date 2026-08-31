/**
 * CSS colour parsing for canvas fill/stroke styles.
 *
 * Covers what canvas apps actually write: `#rgb`, `#rgba`, `#rrggbb`,
 * `#rrggbbaa`, `rgb()`/`rgba()` (legacy comma and modern space syntax,
 * percentages, `/ alpha`), `hsl()`/`hsla()` (both syntaxes), `transparent`,
 * and the CSS named colours. Anything else parses to `null` and the caller
 * ignores the assignment, matching the DOM rule that invalid style values
 * leave the current style untouched.
 */

export interface RgbaColor {
  /** 0–255. */
  r: number
  g: number
  b: number
  /** 0–1. */
  a: number
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Parse a `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` hex string. */
function parseHex(body: string): RgbaColor | null {
  const hex = body.toLowerCase()
  if (!/^[0-9a-f]+$/.test(hex)) return null
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0]! + hex[0]!, 16),
      g: parseInt(hex[1]! + hex[1]!, 16),
      b: parseInt(hex[2]! + hex[2]!, 16),
      a: 1,
    }
  }
  if (hex.length === 4) {
    return {
      r: parseInt(hex[0]! + hex[0]!, 16),
      g: parseInt(hex[1]! + hex[1]!, 16),
      b: parseInt(hex[2]! + hex[2]!, 16),
      a: parseInt(hex[3]! + hex[3]!, 16) / 255,
    }
  }
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    }
  }
  if (hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: parseInt(hex.slice(6, 8), 16) / 255,
    }
  }
  return null
}

/** One channel value: a number, or a `<percentage>%`. */
function parseChannel(token: string, scale: number): number | null {
  const t = token.trim()
  if (t.endsWith("%")) {
    const v = Number(t.slice(0, -1))
    if (!Number.isFinite(v)) return null
    return clamp01(v / 100) * scale
  }
  const v = Number(t)
  if (!Number.isFinite(v)) return null
  return clamp01(v / scale) * scale
}

function parseAngleDegrees(token: string): number | null {
  const t = token.trim()
  const v = t.endsWith("deg") ? Number(t.slice(0, -3)) : Number(t)
  if (!Number.isFinite(v)) return null
  return ((v % 360) + 360) % 360
}

/** hsl → rgb, h in degrees, s and l in 0–1. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)]
}

/** Parse an `fn(args)` functional colour: rgb, rgba, hsl, hsla. */
function parseFunctional(spec: string): RgbaColor | null {
  const open = spec.indexOf("(")
  const close = spec.lastIndexOf(")")
  if (open < 0 || close < open) return null
  const fn = spec.slice(0, open).trim().toLowerCase()
  let inner = spec.slice(open + 1, close)
  let alpha = 1
  const slash = inner.lastIndexOf("/")
  if (slash >= 0) {
    const a = parseChannel(inner.slice(slash + 1), 1)
    if (a == null) return null
    alpha = a
    inner = inner.slice(0, slash)
  }
  const parts = inner.split(inner.includes(",") ? "," : /\s+/).filter((p) => p.length > 0)
  if (fn === "rgb" || fn === "rgba") {
    if (parts.length !== 3 && parts.length !== 4) return null
    if (parts.length === 4) {
      // Legacy `rgba(r, g, b, a)` — no slash form.
      const a = parseChannel(parts[3]!, 1)
      if (a == null) return null
      alpha = a
    }
    const r = parseChannel(parts[0]!, 255)
    const g = parseChannel(parts[1]!, 255)
    const b = parseChannel(parts[2]!, 255)
    if (r == null || g == null || b == null) return null
    return { r, g, b, a: clamp01(alpha) }
  }
  if (fn === "hsl" || fn === "hsla") {
    if (parts.length !== 3 && parts.length !== 4) return null
    if (parts.length === 4) {
      const a = parseChannel(parts[3]!, 1)
      if (a == null) return null
      alpha = a
    }
    const h = parseAngleDegrees(parts[0]!)
    const s = parseChannel(parts[1]!, 1)
    const l = parseChannel(parts[2]!, 1)
    if (h == null || s == null || l == null) return null
    const [r, g, b] = hslToRgb(h, s, l)
    return { r, g, b, a: clamp01(alpha) }
  }
  return null
}

// The CSS named colours (plus `transparent`), values in hex rrggbb.
const NAMED_COLORS: Record<string, string> = {
  aliceblue: "f0f8ff",
  antiquewhite: "faebd7",
  aqua: "00ffff",
  aquamarine: "7fffd4",
  azure: "f0ffff",
  beige: "f5f5dc",
  bisque: "ffe4c4",
  black: "000000",
  blanchedalmond: "ffebcd",
  blue: "0000ff",
  blueviolet: "8a2be2",
  brown: "a52a2a",
  burlywood: "deb887",
  cadetblue: "5f9ea0",
  chartreuse: "7fff00",
  chocolate: "d2691e",
  coral: "ff7f50",
  cornflowerblue: "6495ed",
  cornsilk: "fff8dc",
  crimson: "dc143c",
  cyan: "00ffff",
  darkblue: "00008b",
  darkcyan: "008b8b",
  darkgoldenrod: "b8860b",
  darkgray: "a9a9a9",
  darkgreen: "006400",
  darkgrey: "a9a9a9",
  darkkhaki: "bdb76b",
  darkmagenta: "8b008b",
  darkolivegreen: "556b2f",
  darkorange: "ff8c00",
  darkorchid: "9932cc",
  darkred: "8b0000",
  darksalmon: "e9967a",
  darkseagreen: "8fbc8f",
  darkslateblue: "483d8b",
  darkslategray: "2f4f4f",
  darkslategrey: "2f4f4f",
  darkturquoise: "00ced1",
  darkviolet: "9400d3",
  deeppink: "ff1493",
  deepskyblue: "00bfff",
  dimgray: "696969",
  dimgrey: "696969",
  dodgerblue: "1e90ff",
  firebrick: "b22222",
  floralwhite: "fffaf0",
  forestgreen: "228b22",
  fuchsia: "ff00ff",
  gainsboro: "dcdcdc",
  ghostwhite: "f8f8ff",
  gold: "ffd700",
  goldenrod: "daa520",
  gray: "808080",
  green: "008000",
  greenyellow: "adff2f",
  grey: "808080",
  honeydew: "f0fff0",
  hotpink: "ff69b4",
  indianred: "cd5c5c",
  indigo: "4b0082",
  ivory: "fffff0",
  khaki: "f0e68c",
  lavender: "e6e6fa",
  lavenderblush: "fff0f5",
  lawngreen: "7cfc00",
  lemonchiffon: "fffacd",
  lightblue: "add8e6",
  lightcoral: "f08080",
  lightcyan: "e0ffff",
  lightgoldenrodyellow: "fafad2",
  lightgray: "d3d3d3",
  lightgreen: "90ee90",
  lightgrey: "d3d3d3",
  lightpink: "ffb6c1",
  lightsalmon: "ffa07a",
  lightseagreen: "20b2aa",
  lightskyblue: "87cefa",
  lightslategray: "778899",
  lightslategrey: "778899",
  lightsteelblue: "b0c4de",
  lightyellow: "ffffe0",
  lime: "00ff00",
  limegreen: "32cd32",
  linen: "faf0e6",
  magenta: "ff00ff",
  maroon: "800000",
  mediumaquamarine: "66cdaa",
  mediumblue: "0000cd",
  mediumorchid: "ba55d3",
  mediumpurple: "9370db",
  mediumseagreen: "3cb371",
  mediumslateblue: "7b68ee",
  mediumspringgreen: "00fa9a",
  mediumturquoise: "48d1cc",
  mediumvioletred: "c71585",
  midnightblue: "191970",
  mintcream: "f5fffa",
  mistyrose: "ffe4e1",
  moccasin: "ffe4b5",
  navajowhite: "ffdead",
  navy: "000080",
  oldlace: "fdf5e6",
  olive: "808000",
  olivedrab: "6b8e23",
  orange: "ffa500",
  orangered: "ff4500",
  orchid: "da70d6",
  palegoldenrod: "eee8aa",
  palegreen: "98fb98",
  paleturquoise: "afeeee",
  palevioletred: "db7093",
  papayawhip: "ffefd5",
  peachpuff: "ffdab9",
  peru: "cd853f",
  pink: "ffc0cb",
  plum: "dda0dd",
  powderblue: "b0e0e6",
  purple: "800080",
  rebeccapurple: "663399",
  red: "ff0000",
  rosybrown: "bc8f8f",
  royalblue: "4169e1",
  saddlebrown: "8b4513",
  salmon: "fa8072",
  sandybrown: "f4a460",
  seagreen: "2e8b57",
  seashell: "fff5ee",
  sienna: "a0522d",
  silver: "c0c0c0",
  skyblue: "87ceeb",
  slateblue: "6a5acd",
  slategray: "708090",
  slategrey: "708090",
  snow: "fffafa",
  springgreen: "00ff7f",
  steelblue: "4682b4",
  tan: "d2b48c",
  teal: "008080",
  thistle: "d8bfd8",
  tomato: "ff6347",
  turquoise: "40e0d0",
  violet: "ee82ee",
  wheat: "f5deb3",
  white: "ffffff",
  whitesmoke: "f5f5f5",
  yellow: "ffff00",
  yellowgreen: "9acd32",
}

/**
 * Parse a CSS colour string, or return `null` when it is not one of the
 * supported forms. `parseColor("red")` is the hot path for canvas styles —
 * keep it allocation-light.
 */
export function parseColor(spec: string): RgbaColor | null {
  if (typeof spec !== "string") return null
  const s = spec.trim().toLowerCase()
  if (s.length === 0) return null
  if (s.startsWith("#")) return parseHex(s.slice(1))
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 }
  const named = NAMED_COLORS[s]
  if (named !== undefined) {
    return {
      r: parseInt(named.slice(0, 2), 16),
      g: parseInt(named.slice(2, 4), 16),
      b: parseInt(named.slice(4, 6), 16),
      a: 1,
    }
  }
  return parseFunctional(s)
}

/** Linear interpolation between two parsed colours (rgb 0–255, a 0–1). */
export function lerpColor(from: RgbaColor, to: RgbaColor, t: number): RgbaColor {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
    a: from.a + (to.a - from.a) * t,
  }
}
