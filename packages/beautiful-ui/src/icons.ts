/** Inline stroke icons, embedded as `data:image/svg+xml` URLs for the
 *  tintable `<svg>` element (GPUIV colours the whole glyph from
 *  `style.color`, so the strokes here are plain black).
 *
 *  Paths are lifted from the inline SVGs in beautiful-ui's components, plus
 *  a few lucide-style glyphs where a component referenced an icon library.
 */

function strokeIcon(body: string, strokeWidth = 2): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="black" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`
}

export const icons = {
  /** Three horizontal rules, the last one short (chunk/context glyph). */
  lines: strokeIcon('<path d="M4 6h16M4 12h16M4 18h10" />', 2.5),
  arrowUpRight: strokeIcon('<path d="M7 17L17 7M7 7h10v10" />', 2.5),
  search: strokeIcon('<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />'),
  chevronDown: strokeIcon('<path d="m6 9 6 6 6-6" />'),
  chevronRight: strokeIcon('<path d="m9 18 6-6-6-6" />'),
  check: strokeIcon('<path d="M20 6 9 17l-5-5" />', 2.5),
  x: strokeIcon('<path d="M18 6 6 18M6 6l12 12" />'),
  copy: strokeIcon('<rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />'),
  /** Code brackets with a slash — the CodeBlock file glyph. */
  fileCode: strokeIcon('<path d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />', 1.8),
  plus: strokeIcon('<path d="M5 12h14M12 5v14" />'),
  arrowUp: strokeIcon('<path d="M12 19V5M5 12l7-7 7 7" />', 2.4),
  history: strokeIcon('<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />'),
  /** Filled dots — the inner `g` overrides the root fill="none"; still tinted monochrome. */
  ellipsis: strokeIcon(
    '<g fill="black" stroke="none"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></g>',
  ),
  send: strokeIcon('<path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />'),
  sparkles: strokeIcon('<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />'),
  filter: strokeIcon('<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />'),
} as const

export type IconName = keyof typeof icons
