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

/** Like `strokeIcon`, but for marks whose box is not square (brand logos). */
function brandIcon(body: string, viewBox: string, strokeWidth = 2): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" ` +
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
  /** Trailing text rules — the RecordsTable Text property glyph. */
  typeText: strokeIcon('<path d="M4 6h16M4 12h10M4 18h7" />', 1.8),
  /** Stacked database discs — the RecordsTable Collection property glyph. */
  typeCollection: strokeIcon(
    '<ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />',
    1.8,
  ),
  /** Circled check — the RecordsTable Single select property glyph. */
  typeSelectSingle: strokeIcon('<circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.4 2.4 4.6-4.9" />', 1.8),
  /** Check list — the RecordsTable Multi select property glyph. */
  typeSelectMulti: strokeIcon(
    '<path d="M11 6h9M11 12h9M11 18h9" /><path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17" />',
    1.8,
  ),
  /** Chain links — the RecordsTable URL property glyph. */
  typeUrl: strokeIcon(
    '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" />',
    1.8,
  ),
  /** North-east arrow — the RecordsTable Reference property glyph. */
  typeReference: strokeIcon('<path d="M7 17 17 7M9 7h8v8" />', 1.8),
  /** Braces — the RecordsTable JSON property glyph. */
  typeJson: strokeIcon(
    '<path d="M8 4c-2 0-2 2-2 3s.5 3-2 3c2.5 0 2 2 2 3s0 3 2 3" /><path d="M16 4c2 0 2 2 2 3s-.5 3 2 3c-2.5 0-2 2-2 3s0 3-2 3" />',
    1.8,
  ),
  /** Overlapping squares — the RecordsTable File splitter property glyph. */
  typeFileSplitter: strokeIcon(
    '<rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />',
    1.8,
  ),
  /** Calendar — the RecordsTable Date property glyph. */
  typeDate: strokeIcon('<rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3 10h18" />', 1.8),
  /** Filled curved four-point star — the RecordsTable model tool glyph (filled, like the source). */
  toolModel: strokeIcon(
    '<g fill="black" stroke="none"><path d="M12 3l1.7 5.1a2 2 0 0 0 1.2 1.2L20 11l-5.1 1.7a2 2 0 0 0-1.2 1.2L12 19l-1.7-5.1a2 2 0 0 0-1.2-1.2L4 11l5.1-1.7a2 2 0 0 0 1.2-1.2z" /></g>',
  ),
  /** Person — the RecordsTable user tool glyph. */
  toolUser: strokeIcon('<circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />', 1.8),
  /** Down arrow (2.4px stroke) — the RecordsTable sort glyph; pairs with `arrowUp`. */
  arrowDown: strokeIcon('<path d="M12 5v14M5 12l7 7 7-7" />', 2.4),
  /** Pushpin — the RecordsTable Pin action glyph. */
  pin: strokeIcon('<path d="M12 17v5M8 3h8l-1 7 3 3H6l3-3-1-7z" />', 1.8),
  /** Crossed eye — the RecordsTable Hide from view glyph. */
  eyeOff: strokeIcon(
    '<path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c7 0 10 7 10 7a16.3 16.3 0 0 1-2.1 3M6.6 6.6A16 16 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6M3 3l18 18" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />',
    1.8,
  ),
  /** Opposed arrows on rules — the RecordsTable Compact columns glyph. */
  compactColumns: strokeIcon('<path d="M4 8h16M7 4 3 8l4 4M17 4l4 4-4 4M4 16h16" />', 1.8),
  /** Counter-clockwise circular arrow — the RecordsTable Reset column widths glyph. */
  resetColumns: strokeIcon('<path d="M3 12a9 9 0 1 0 3-6.7M3 4v6h6" />', 1.8),
  /** Circled i — the RecordsTable grounding help glyph. */
  infoCircle: strokeIcon('<circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" />', 1.8),
  /** Paperclip — the PromptBar Add photos & files source glyph. */
  paperclip: strokeIcon(
    '<path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />',
    1.8,
  ),
  /** Bar chart — the PromptBar Scoop Data source glyph. */
  chart: strokeIcon('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />', 1.8),
  /** Layered sheets — the PromptBar Flavor records source glyph. */
  layers: strokeIcon('<path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" />', 1.8),
  /** Microphone — the PromptBar dictation glyph. */
  mic: strokeIcon(
    '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />',
    2,
  ),
  /** Monochrome Figma mark (four stacked lobes, 2:3 box) — the PromptBar
   *  Figma source; the web original is a multicolour filled logo. */
  figma: brandIcon(
    '<circle cx="12" cy="6" r="5" /><circle cx="6.5" cy="18" r="5" /><circle cx="17.5" cy="18" r="5" /><circle cx="12" cy="30" r="5" />',
    "0 0 24 36",
    2.5,
  ),
  /** Monochrome Slack mark (rounded hash) — the PromptBar Slack source. */
  slack: brandIcon('<path d="M9 3.5v7M15 13.5v7M3.5 15h7M13.5 9h7" />', "0 0 24 24", 2.6),
  /** Monochrome Gmail mark (envelope, 5:4 box) — the PromptBar Gmail source. */
  gmail: brandIcon('<rect x="1.5" y="1.5" width="27" height="21" rx="3" /><path d="m3 5 12 9 12-9" />', "0 0 30 24", 2),
} as const

export type IconName = keyof typeof icons
