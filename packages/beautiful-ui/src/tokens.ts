/** Design tokens ported from beautiful-ui's globals.css.
 *
 * Colours are oklch strings (natively parsed by GPUI). Light/dark
 * variants are two flat maps — the active one is selected by
 * {@link useTheme}.
 */

/* ── Light theme ────────────────────────────────── */

export const lightTokens = {
  // surfaces
  page: "oklch(0.985 0.001 286.376)",
  canvas: "oklch(0.961 0.002 247.84)",
  surface: "oklch(1 0 0)",
  inset: "oklch(0.979 0.002 247.839)",
  hover: "oklch(0.97 0.002 247.839)",
  hover2: "oklch(0.933 0.003 247.86)",

  // ink ramp
  ink: "oklch(0.247 0.006 258.361)",
  ink2: "oklch(0.506 0.01 264.477)",
  ink3: "oklch(0.695 0.009 264.505)",

  // borders
  line: "oklch(0.946 0.003 264.542)",
  lineStrong: "oklch(0.912 0.005 258.326)",
  lineSoft: "oklch(0.966 0.002 264.542)",
  gridLine: "oklch(0.946 0.003 264.542)", /* 78% blended — approximated */
  field: "oklch(0.961 0.001 286.375)",
  stripe: "oklch(0.405 0 0 / 0.075)",
  stripeBg: "oklch(0.97 0 0)",

  // accent
  accent: "oklch(0.626 0.205 254.947)",
  accentInk: "oklch(0.556 0.187 255.617)",
  accentTint: "oklch(0.96 0.019 252.878)",

  // semantic
  green: "oklch(0.603 0.155 150.883)",
  greenTint: "oklch(0.958 0.017 159.118)",
  orange: "oklch(0.689 0.179 49.902)",
  orangeTint: "oklch(0.964 0.021 67.581)",
  red: "oklch(0.621 0.192 23.042)",
  redTint: "oklch(0.956 0.017 17.462)",

  // chart overlays
  tooltipBg: "oklch(0.272 0.008 264.435)",
  tooltipFg: "oklch(0.976 0.002 247.839)",
  tooltipMuted: "oklch(0.731 0.008 260.731)",
  tooltipBorder: "oklch(0.356 0.007 264.474)",
} as const

/* ── Dark theme ─────────────────────────────────── */

export const darkTokens = {
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
} as const

/* ── Shadow approximations ────────────────────────
 * GPUIV supports a single structured boxShadow + borderWidth,
 * so beautiful-ui's layered shadow stacks are flattened to a
 * 1px hairline ring + one blur layer.
 */

export const shadowHairline = {
  borderWidth: 1,
  borderColor: "var(--line)",
}
export const shadowBtn = {
  borderWidth: 1,
  borderColor: "var(--line-strong)",
  boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: "rgba(0,0,0,0.05)" },
}
export const shadowCard = {
  borderWidth: 1,
  borderColor: "var(--line)",
  boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: "rgba(0,0,0,0.05)" },
}
export const shadowRaised = {
  borderWidth: 1,
  borderColor: "var(--line)",
  boxShadow: { offsetX: 0, offsetY: 2, blurRadius: 6, spreadRadius: 0, color: "rgba(0,0,0,0.08)" },
}
export const shadowOverlay = {
  borderWidth: 1,
  borderColor: "var(--line)",
  boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 28, spreadRadius: 0, color: "rgba(0,0,0,0.15)" },
}
export const shadowInsetField = {
  boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: "rgba(0,0,0,0.12)", inset: true },
}

/* ── Radii ──────────────────────────────────────── */

export const radius = {
  chip: 6,
  control: 8,
  card: 10,
  window: 14,
  pill: 999,
} as const

/* ── Easings ────────────────────────────────────── */

export const ease = {
  outStrong: "cubic-bezier(0.23, 1, 0.32, 1)",
  inOutStrong: "cubic-bezier(0.77, 0, 0.175, 1)",
  link: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const

/** All token keys. */
export type TokenKey = keyof typeof lightTokens
/** Named shadow keys. */
export type ShadowKey = "hairline" | "btn" | "card" | "raised" | "overlay" | "insetField"
