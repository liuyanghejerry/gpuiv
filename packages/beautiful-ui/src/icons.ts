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
  chevronLeft: strokeIcon('<path d="m15 18-6-6 6-6" />'),
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
  /** Filled four-point star — the ThinkingState header glyph. */
  sparkle: strokeIcon(
    '<g fill="black" stroke="none"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" /></g>',
  ),
  /** Wireframe globe — the ThinkingState Search source dot. */
  globe: strokeIcon('<circle cx="12" cy="12" r="9" /><path d="M3.5 12h17M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />', 2.5),
  chevronUp: strokeIcon('<path d="m18 15-6-6-6 6" />'),
  filter: strokeIcon('<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />'),
  /** Partial ring arc (28% sweep, round caps) — the TaskRows active spinner
   *  overlay. Static: GPUIV has no rotate, so the arc does not orbit. */
  ringArc: strokeIcon('<circle cx="12" cy="12" r="11" stroke-dasharray="19.35 49.76" />', 2),
  /** Circular arrow — the TaskRows failed pill's retry glyph. */
  retry: strokeIcon('<path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />', 3),
  /** Heavier check (3.5px stroke) — the TaskRows done badge glyph. */
  checkBold: strokeIcon('<path d="M20 6 9 17l-5-5" />', 3.5),
  /** Heavier X (3.5px stroke) — the TaskRows failed badge glyph. */
  xBold: strokeIcon('<path d="M18 6 6 18M6 6l12 12" />', 3.5),
  /** Pencil — the ToolChips Write glyph. */
  pencil: strokeIcon('<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />'),
  /** Terminal prompt — the ToolChips Run glyph. */
  terminal: strokeIcon('<path d="M4 17l6-5-6-5M12 19h8" />'),
  /** Document with a folded corner — the ToolChips Read glyph. */
  file: strokeIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />'),
  /** Softer circular arrow (1.8px stroke) — the StreamingText action-row
   *  retry glyph; the TaskRows `retry` above is the 3px bold variant. */
  retrySoft: strokeIcon('<path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />', 1.8),
  /** StreamingText feedback actions (1.8px stroke, like the source). */
  thumbsUp: strokeIcon(
    '<path d="M7 10v12M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z" />',
    1.8,
  ),
  thumbsDown: strokeIcon(
    '<path d="M17 14V2M9 18.12L10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88z" />',
    1.8,
  ),
  /** Turn-in arrow — the StreamingText follow-up prompt glyph. */
  cornerDownLeft: strokeIcon('<path d="M9 10l-5 5 5 5" /><path d="M20 4v7a4 4 0 0 1-4 4H4" />'),
  /** House — the SidebarNav Home rail glyph. */
  home: strokeIcon('<path d="M3 11 12 3l9 8" /><path d="M5 10v11h14V10" /><path d="M9.5 21v-6h5v6" />'),
  /** Gear as a hub with eight spokes — the SidebarNav settings glyph. */
  gear: strokeIcon(
    '<circle cx="12" cy="12" r="3.5" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />',
  ),
  /** Person with a plus — the SidebarNav Invite users rail glyph. */
  userAdd: strokeIcon(
    '<circle cx="9" cy="7" r="4" /><path d="M3 21v-1a6 6 0 0 1 12 0v1" /><path d="M19 8v6M16 11h6" />',
  ),
  /** Panel with a left-pointing arrow — the SidebarNav collapse glyph. */
  sidebarCollapse: strokeIcon(
    '<rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9.5 4v16" /><path d="m16.5 9.5-2.5 2.5 2.5 2.5" />',
  ),
  /** Panel with a right-pointing arrow — the SidebarNav expand glyph. */
  sidebarExpand: strokeIcon(
    '<rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9.5 4v16" /><path d="m13.5 9.5 2.5 2.5-2.5 2.5" />',
  ),
  /** Ice pop on a stick — the SidebarNav workspace logo glyph. */
  popsicle: strokeIcon('<rect x="7" y="2.5" width="10" height="13" rx="5" /><path d="M12 15.5V21" />'),
  /** Door with an outbound arrow — the SidebarNav sign-out glyph. */
  signOut: strokeIcon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" />'),
  /** Chat bubble with a question mark — the SelectionActions Explain glyph (1.8px stroke, like the source). */
  chatBubbleQuestion: strokeIcon(
    '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" />',
    1.8,
  ),
  /** Scissors — the SelectionActions Shorten glyph. */
  scissor: strokeIcon(
    '<circle cx="6" cy="6" r="3" /><path d="M8.12 8.12 12 12" /><path d="M20 4 8.12 15.88" /><circle cx="6" cy="18" r="3" /><path d="M14.8 14.8 20 20" />',
    1.8,
  ),
  /** Smiling face — the SelectionActions Tone glyph. */
  smile: strokeIcon(
    '<circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01" /><path d="M15 9h.01" />',
    1.8,
  ),
  /** Boxed T — the SelectionActions Grammar glyph. */
  textBox: strokeIcon('<rect x="3" y="3" width="18" height="18" rx="4" /><path d="M7 8h10" /><path d="M12 8v8" />', 1.8),
} as const

export type IconName = keyof typeof icons
