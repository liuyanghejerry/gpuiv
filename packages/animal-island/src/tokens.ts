/** Design tokens ported from animal-island-vue's `src/styles/variables.less`
 *  (https://github.com/guokaigdg/animal-island-vue, MIT — learning use only).
 *
 *  There are no CSS variables in GPUIV, so token resolution happens here, in
 *  TS, at render time. Values are plain numbers (px) and colour strings the
 *  GPUIV parser accepts (hex / rgb / rgba).
 *
 *  CSS features the original expresses but GPUIV cannot (dashed borders,
 *  radial-gradient dot patterns, inset shadows, letter-spacing, transform
 *  hovers) are dropped here and approximated inside each component instead.
 */

import type { BoxShadow } from "@gpuiv/vue"

/* ── Colour palette ────────────────────────────── */

export const colors = {
  primary: "#19c8b9",
  primaryHover: "#3dd4c6",
  primaryActive: "#50b9ab",
  primaryBg: "#e6f9f6",

  success: "#6fba2c",
  successHover: "#85cc45",
  successActive: "#5a9e1e",

  warning: "#f5c31c",
  warningHover: "#f7d04a",
  warningActive: "#dba90e",

  error: "#e05a5a",
  errorHover: "#e87878",
  errorActive: "#c94444",

  // neutral
  text: "#794f27",
  textSecondary: "#9f927d",
  textDisabled: "#c4b89e",

  border: "#aaa69d",
  borderHover: "#827157",
  borderLight: "#e8e2d6",

  bg: "#f8f8f0",
  bgSecondary: "#f0e8d8",
  bgDisabled: "#f0ece2",
  bgInput: "#fffbe7",

  // cream / warm-brown extras
  cream: "#f8f8f0",
  warm: "#794f27",
  warmSoft: "#725d42",
  shadowWarm: "#bdaea0",
  shadowSoft: "#d4c9b4",
  shadowSoftHover: "#c4b89e",
  shadowSoftStrong: "#a89878",
} as const

/* ── Card palette (Card.vue) ───────────────────── */

export type CardColor =
  | "default"
  | "app-pink"
  | "purple"
  | "app-blue"
  | "app-yellow"
  | "app-orange"
  | "app-teal"
  | "app-green"
  | "app-red"
  | "lime-green"
  | "yellow-green"
  | "brown"
  | "warm-peach-pink"

/** Solid fill variants (`animal-card--color-*`). */
export const cardSolid: Record<Exclude<CardColor, "default">, { bg: string; text: string }> = {
  "app-pink": { bg: "#f8a6b2", text: "#ffffff" },
  purple: { bg: "#b77dee", text: "#ffffff" },
  "app-blue": { bg: "#889df0", text: "#ffffff" },
  "app-yellow": { bg: "#f7cd67", text: "#725d42" },
  "app-orange": { bg: "#e59266", text: "#ffffff" },
  "app-teal": { bg: "#82d5bb", text: "#ffffff" },
  "app-green": { bg: "#8ac68a", text: "#ffffff" },
  "app-red": { bg: "#fc736d", text: "#ffffff" },
  "lime-green": { bg: "#d1da49", text: "#3d5a1a" },
  "yellow-green": { bg: "#ecdf52", text: "#725d42" },
  brown: { bg: "#9a835a", text: "#ffffff" },
  "warm-peach-pink": { bg: "#e18c6f", text: "#ffffff" },
}

/** Pattern variants (`animal-card--pattern-*`): the original paints a
 *  two-layer radial-gradient dot matrix; GPUIV has no radial gradients or
 *  background images, so the port keeps the tint/border/ink scheme and drops
 *  the dots. */
export const cardPattern: Record<Exclude<CardColor, "default">, { bg: string; border: string; text: string }> = {
  "app-pink": { bg: "#fde4e8", border: "#f8a6b2", text: "#a85565" },
  purple: { bg: "#f0e8ff", border: "#b77dee", text: "#6a3a9a" },
  "app-blue": { bg: "#e8edff", border: "#889df0", text: "#4a5a8a" },
  "app-yellow": { bg: "#fff8e0", border: "#f7cd67", text: "#7a6528" },
  "app-orange": { bg: "#fff0e8", border: "#e59266", text: "#8a4a2a" },
  "app-teal": { bg: "#e8faf5", border: "#82d5bb", text: "#2a6b5a" },
  "app-green": { bg: "#e8f5e8", border: "#8ac68a", text: "#3a6b3a" },
  "app-red": { bg: "#ffe8e8", border: "#fc736d", text: "#9a3a3a" },
  "lime-green": { bg: "#f5f8e0", border: "#d1da49", text: "#5a6b28" },
  "yellow-green": { bg: "#fffde8", border: "#ecdf52", text: "#6a5a28" },
  brown: { bg: "#f5f0e0", border: "#9a835a", text: "#5a4a2a" },
  "warm-peach-pink": { bg: "#fff0e8", border: "#e18c6f", text: "#8a4a2a" },
}

/* ── Typography ────────────────────────────────── */

export const fontSize = { sm: 12, base: 14, lg: 16 } as const
export const lineHeightBase = 1.5715

/** Resolved at runtime by `loadAnimalIslandFonts`; `undefined` = system default.
 *  The web original stacks Nunito → Noto Sans SC → system rounded faces. */
export const fonts = { sans: undefined as string | undefined }

/* ── Spacing / radius / sizing ─────────────────── */

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const

export const radius = { sm: 16, base: 18, lg: 24, card: 20, pill: 999 } as const

export const borderWidth = 2

export const height = { sm: 32, base: 40, middle: 45, lg: 48 } as const

/* ── Shadows (GPUIV single-shadow structs) ─────── */

function shadow(offsetY: number, blurRadius: number, color: string, spreadRadius = 0): BoxShadow {
  return { offsetX: 0, offsetY, blurRadius, spreadRadius, color }
}

export const shadows = {
  sm: shadow(2, 4, "rgba(61, 52, 40, 0.06)"),
  base: shadow(3, 10, "rgba(61, 52, 40, 0.1)"),
  lg: shadow(8, 24, "rgba(61, 52, 40, 0.14)"),
  /** The signature 3D hard shadow (`box-shadow: 0 5px 0 0 #bdaea0`). */
  hard: shadow(5, 0, colors.shadowWarm),
  hardHover: shadow(6, 0, colors.shadowWarm),
  hardActive: shadow(1, 0, colors.shadowWarm),
  hardError: shadow(5, 0, colors.errorActive),
  hardErrorHover: shadow(6, 0, colors.errorActive),
  hardErrorActive: shadow(1, 0, colors.errorActive),
} as const

/* ── Motion ────────────────────────────────────── */

export const duration = { fast: 0.15, base: 0.25, slow: 0.35 } as const
/** cubic-bezier(0.4, 0, 0.2, 1) */
export const ease: [number, number, number, number] = [0.4, 0, 0.2, 1]
