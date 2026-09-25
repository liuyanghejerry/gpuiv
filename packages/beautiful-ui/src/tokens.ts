/** Design tokens ported from beautiful-ui's `app/globals.css`.
 *
 *  Colours stay as oklch() strings — GPUIV's colour parser handles them
 *  natively. Light/dark are two flat maps; `useTheme()` picks the active one
 *  (there are no CSS variables in GPUIV, so token resolution happens here,
 *  in JS, at render time).
 *
 *  Derived colours that globals.css expresses with `color-mix()` are computed
 *  with the helpers in `./colors.js` at the call site.
 */

import type { StyleDesc } from "@gpuiv/vue"

/* ── Colour tokens ─────────────────────────────── */

export interface Tokens {
  // surfaces
  page: string
  canvas: string
  surface: string
  inset: string
  hover: string
  hover2: string
  // ink ramp (text)
  ink: string
  ink2: string
  ink3: string
  // borders
  line: string
  lineStrong: string
  lineSoft: string
  gridLine: string
  field: string
  stripe: string
  stripeBg: string
  // accent
  accent: string
  accentInk: string
  accentTint: string
  // semantic
  green: string
  greenTint: string
  orange: string
  orangeTint: string
  red: string
  redTint: string
  // chart overlays
  tooltipBg: string
  tooltipFg: string
  tooltipMuted: string
  tooltipBorder: string
}

export const lightTokens: Tokens = {
  page: "oklch(0.985 0.001 286.376)",
  canvas: "oklch(0.961 0.002 247.84)",
  surface: "oklch(1 0 0)",
  inset: "oklch(0.979 0.002 247.839)",
  hover: "oklch(0.97 0.002 247.839)",
  hover2: "oklch(0.933 0.003 247.86)",

  ink: "oklch(0.247 0.006 258.361)",
  ink2: "oklch(0.506 0.01 264.477)",
  ink3: "oklch(0.695 0.009 264.505)",

  line: "oklch(0.946 0.003 264.542)",
  lineStrong: "oklch(0.912 0.005 258.326)",
  lineSoft: "oklch(0.966 0.002 264.542)",
  gridLine: "oklch(0.946 0.003 264.542)",
  field: "oklch(0.961 0.001 286.375)",
  stripe: "oklch(0.405 0 0 / 0.075)",
  stripeBg: "oklch(0.97 0 0)",

  accent: "oklch(0.626 0.205 254.947)",
  accentInk: "oklch(0.556 0.187 255.617)",
  accentTint: "oklch(0.96 0.019 252.878)",

  green: "oklch(0.603 0.155 150.883)",
  greenTint: "oklch(0.958 0.017 159.118)",
  orange: "oklch(0.689 0.179 49.902)",
  orangeTint: "oklch(0.964 0.021 67.581)",
  red: "oklch(0.621 0.192 23.042)",
  redTint: "oklch(0.956 0.017 17.462)",

  tooltipBg: "oklch(0.272 0.008 264.435)",
  tooltipFg: "oklch(0.976 0.002 247.839)",
  tooltipMuted: "oklch(0.731 0.008 260.731)",
  tooltipBorder: "oklch(0.356 0.007 264.474)",
}

export const darkTokens: Tokens = {
  page: "oklch(0.209 0.004 264.477)",
  canvas: "oklch(0.231 0.004 264.487)",
  surface: "oklch(0.26 0.006 271.191)",
  inset: "oklch(0.243 0.004 264.492)",
  hover: "oklch(0.289 0.006 271.22)",
  hover2: "oklch(0.318 0.007 274.747)",

  ink: "oklch(0.964 0.002 247.839)",
  ink2: "oklch(0.731 0.008 260.731)",
  ink3: "oklch(0.541 0.01 264.484)",

  line: "oklch(0.308 0.006 258.354)",
  lineStrong: "oklch(0.356 0.007 264.474)",
  lineSoft: "oklch(0.278 0.006 258.354)",
  gridLine: "oklch(0.308 0.006 258.354)",
  field: "oklch(0.293 0.006 271.223)",
  stripe: "oklch(1 0 0 / 0.055)",
  stripeBg: "oklch(0.226 0.004 264.485)",

  accent: "oklch(0.68 0.173 253.301)",
  accentInk: "oklch(0.788 0.113 248.33)",
  accentTint: "oklch(0.68 0.173 253.301 / 0.16)",

  green: "oklch(0.705 0.154 153.814)",
  greenTint: "oklch(0.705 0.154 153.814 / 0.14)",
  orange: "oklch(0.746 0.156 55.642)",
  orangeTint: "oklch(0.746 0.156 55.642 / 0.14)",
  red: "oklch(0.666 0.18 21.433)",
  redTint: "oklch(0.666 0.18 21.433 / 0.14)",

  tooltipBg: "oklch(0.182 0.004 264.459)",
  tooltipFg: "oklch(0.964 0.002 247.839)",
  tooltipMuted: "oklch(0.731 0.008 260.731)",
  tooltipBorder: "oklch(0.308 0.006 258.354)",
}

/* ── Shadows ─────────────────────────────────────
 * globals.css stacks a solid 1px hairline ring on top of shadow-plugin's
 * layered blurs. GPUIV carries one border + one boxShadow per element, so
 * each elevation is flattened to `borderWidth: 1` (the ring) plus the
 * single most visible blur layer. Dark mode swaps the ring to a low-alpha
 * white, graduated by elevation, exactly like the source. */

export interface Shadow {
  borderWidth: 1
  borderColor: string
  boxShadow?: NonNullable<StyleDesc["boxShadow"]>
}

export interface Shadows {
  hairline: Shadow
  btn: Shadow
  card: Shadow
  raised: Shadow
  overlay: Shadow
  /** No inset shadows in GPUIV — approximated with a hairline border. */
  insetField: Shadow
}

export function createShadows(t: Tokens, isDark: boolean): Shadows {
  if (isDark) {
    return {
      hairline: { borderWidth: 1, borderColor: t.line },
      btn: {
        borderWidth: 1,
        borderColor: "rgba(255, 255, 255, 0.1)",
        boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: "rgba(0, 0, 0, 0.3)" },
      },
      card: {
        borderWidth: 1,
        borderColor: "rgba(255, 255, 255, 0.11)",
        boxShadow: { offsetX: 0, offsetY: 2, blurRadius: 6, spreadRadius: 0, color: "rgba(0, 0, 0, 0.2)" },
      },
      raised: {
        borderWidth: 1,
        borderColor: "rgba(255, 255, 255, 0.13)",
        boxShadow: { offsetX: 0, offsetY: 2, blurRadius: 10, spreadRadius: 0, color: "rgba(0, 0, 0, 0.22)" },
      },
      overlay: {
        borderWidth: 1,
        borderColor: "rgba(255, 255, 255, 0.15)",
        boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 28, spreadRadius: 0, color: "rgba(0, 0, 0, 0.34)" },
      },
      insetField: { borderWidth: 1, borderColor: t.line },
    }
  }
  return {
    hairline: { borderWidth: 1, borderColor: t.line },
    btn: {
      borderWidth: 1,
      borderColor: t.lineStrong,
      boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: "rgba(0, 0, 0, 0.05)" },
    },
    card: {
      borderWidth: 1,
      borderColor: t.line,
      boxShadow: { offsetX: 0, offsetY: 2, blurRadius: 6, spreadRadius: 0, color: "rgba(0, 0, 0, 0.06)" },
    },
    raised: {
      borderWidth: 1,
      borderColor: t.line,
      boxShadow: { offsetX: 0, offsetY: 2, blurRadius: 10, spreadRadius: 0, color: "rgba(0, 0, 0, 0.1)" },
    },
    overlay: {
      borderWidth: 1,
      borderColor: t.line,
      boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 28, spreadRadius: 0, color: "rgba(0, 0, 0, 0.15)" },
    },
    insetField: { borderWidth: 1, borderColor: t.line },
  }
}

/* ── Radii ─────────────────────────────────────── */

export const radius = {
  chip: 6,
  control: 8,
  card: 10,
  window: 14,
  pill: 999,
} as const

/* ── Type ──────────────────────────────────────── */

export const fonts = {
  /** Inter; falls back to the system font when not installed. */
  sans: "Inter",
  /** JetBrains Mono; falls back to the system monospace when not installed. */
  mono: "JetBrains Mono",
} as const

/* ── Motion ──────────────────────────────────────
 * Named curves match globals.css; `motion.div` accepts the cubic-bezier
 * array form. Durations are seconds (GPUIV convention). */

export const ease = {
  outStrong: [0.23, 1, 0.32, 1] as [number, number, number, number],
  inOutStrong: [0.77, 0, 0.175, 1] as [number, number, number, number],
  link: [0.16, 1, 0.3, 1] as [number, number, number, number],
  /** CSS `ease-out`. */
  out: [0, 0, 0.58, 1] as [number, number, number, number],
} as const

export const duration = {
  fast: 0.15,
  normal: 0.22,
  slow: 0.35,
} as const
