/** RECORDS TABLE — an AI spreadsheet grid. Columns are *properties*: click a
 *  header to open its configuration popover (type, tool, grounding, inputs,
 *  prompt, run), add a new AI property from the + header and watch its cells
 *  resolve row-by-row while it calculates, and hover/select rows through a
 *  spreadsheet gutter where row numbers give way to checkboxes.
 *
 *  Ported from beautiful-ui `components/primitives/RecordsTable.tsx`.
 *
 *  Platform degradations and deliberate differences from the web original
 *  (issue #110 asks for the simplified port):
 *
 *  - Column resize handles and contentEditable prompt editing are cut (the
 *    issue #110 simplification). The prompt renders as a static preview with
 *    the @-mention chip; column widths are fixed proportions of the measured
 *    shell width, scaled from the original's pixel defaults.
 *  - The `<table>`/`<colgroup>`/sticky-`thead`/sticky-`tfoot` becomes flex
 *    rows between a fixed header row and a fixed footer row (structural
 *    stickiness) inside one vertical scroller — GPUIV forbids nested scroll
 *    areas, so the original's horizontal scrolling and the sticky Company
 *    column are dropped; text truncation ellipsizes like FilterTable.
 *  - The AI column's scroll-into-view reveal (scrollLeft = scrollWidth)
 *    becomes a `motion` width tween 0 → its share: every AI cell (header,
 *    rows, footer) grows in lockstep while the other columns reflow
 *    instantly; removal tweens back to 0 and the closing reflow lands one
 *    frame later. Its config popover auto-opens ~340ms after the add, once
 *    the reveal has settled (the original opened it after the scroll).
 *  - Popovers are raw `<anchored deferred>` layers (side/fit per the repo's
 *    overlay rules, their own style carrying the surface fill) instead of
 *    `fixed` divs at measured header rects. The document-level `pointerdown`
 *    outside-close becomes `onMouseDownOutside` on each menu body with a
 *    one-tick dismiss guard so a press on the same trigger closes instead of
 *    reopening (the Select dismiss pattern). The original's scroll listener
 *    closes popovers on body scroll; that is dropped — there is no vertical
 *    scroll inside the simplified table, and the popovers anchor to the fixed
 *    header, so they can't drift.
 *  - The type/tool/inputs flyout submenus (`absolute left-full ml-5`) stay
 *    absolute children of their config row inside the popover. mouseDownOutside
 *    is hitbox-rect based, so the listener sits on a transparent wrapper that
 *    widens to cover the open submenu; while a submenu is open, presses in
 *    its empty strip neither dismiss the popover nor reach the table.
 *  - Every `pop-in` (opacity + scale) and `transition-colors` becomes an
 *    opacity-only `motion` fade or an instant `hover:` swap. The sort arrow's
 *    `rotate(180deg)` becomes an arrowDown ↔ arrowUp glyph swap, and the
 *    header-hover arrow reveal (a CSS descendant selector) is tracked with JS
 *    mouseEnter/leave per header.
 *  - The calculating pulse (`records-pulse`: opacity + scale keyframes, 1.1s
 *    infinite — motion has no repeat) is driven by one shared 550ms interval
 *    that retargets a `motion` opacity square wave 0.35 ↔ 1 across every
 *    visible CalcCell; the scale is dropped.
 *  - GPUIV dispatches mouse events through the whole hovered hitbox chain and
 *    the first filled descendant cuts the chain (`hover_hitbox_count`), so
 *    the row hover/selected tints paint on absolute `pointerEvents: "none"`
 *    overlays (the GlideMenu highlight pattern) instead of on the cells — a
 *    direct cell fill would un-hover the row mid-tint and oscillate. Filled
 *    decorative leaves (checkbox box, tag chips, company mark, strength and
 *    pulse dots, switch knob) also carry `pointerEvents: "none"`; they keep
 *    their own hover chrome but never block the row. There is no
 *    stopPropagation, so the select-all checkbox and the sort arrows arm a
 *    one-tick suppress flag that the header click consumes (the original
 *    called stopPropagation in those handlers).
 *  - Tag overflow: the original measures hidden tag copies with a
 *    ResizeObserver; here tag widths are estimated (13px Inter ≈ 6.8px/char +
 *    16px chrome, capped at the original's 115px) and the same greedy fill —
 *    reserving the "+N" chip — runs against the known column width. Estimates
 *    run conservative, so a row can show one tag fewer than the web original.
 *  - MiniSwitch knob `translateX(12px)` becomes a `left` tween; the selected
 *    column's `inset 0 2px accent` shadow becomes an absolute 2px accent bar
 *    (no inset shadows); cell hairlines `color-mix(line 78%)` become
 *    `withAlpha(line, 0.78)`.
 *  - The checkbox is a plain div; the source's hover rule outranks its
 *    checked fill (hovering a checked box blanks the check), which reads as a
 *    bug — here hover restyling applies only to unchecked boxes. Link and
 *    company-name underlines are dropped (no textDecoration); the arrow glyph
 *    + accentInk colour carry the affordance, and `title` tooltips are
 *    dropped.
 *  - `tabular-nums`, `aria-*`/table semantics, and the unused `variant` prop
 *    are dropped (no DOM accessibility tree); the "Go calculate" stagger
 *    (110ms per row) and its disabled-while-running state are kept.
 */

import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, type PropType, type VNode } from "vue"
import { motion, useElementBounds, useGpuix, type HostNode, type StyleDesc } from "@gpuiv/vue"

import { ease, radius, type Tokens } from "../tokens.js"
import { useTheme } from "../theme.js"
import { mix, withAlpha } from "../colors.js"
import { Icon } from "../atoms/Icon.js"
import { GlideMenuItem, GlideMenuRoot } from "../atoms/GlideMenu.js"
import type { IconName } from "../icons.js"

export type RecordStrength = "strong" | "weak" | "veryweak" | "none"
type SortKey = "name" | "last" | "strength"
type ColumnKey = "company" | "categories" | "last" | "strength" | "links" | "ai"

const DEFAULT_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  company: 270,
  categories: 275,
  last: 190,
  strength: 210,
  links: 175,
  ai: 240,
}

const COMPACT_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  company: 220,
  categories: 220,
  last: 155,
  strength: 180,
  links: 160,
  ai: 200,
}

const ACTION_WIDTH = 100

const STRENGTH: Record<RecordStrength, { label: string; color: "green" | "orange" | "red" | "ink3"; rank: number }> = {
  strong: { label: "Very strong", color: "green", rank: 3 },
  weak: { label: "Weak", color: "orange", rank: 2 },
  veryweak: { label: "Very weak", color: "red", rank: 1 },
  none: { label: "No communication", color: "ink3", rank: 0 },
}

/* A single mid-lightness base hue per tag; background, text, and border are
 * derived via mix() against the theme tokens, like the source's color-mix(). */
type TagColor = { base: string }

const TAG_PALETTE: Record<string, TagColor> = {
  amber: { base: "oklch(0.76 0.13 70)" },
  lime: { base: "oklch(0.77 0.16 122)" },
  yellow: { base: "oklch(0.80 0.15 101)" },
  purple: { base: "oklch(0.62 0.18 293)" },
  orange: { base: "oklch(0.71 0.16 48)" },
  cyan: { base: "oklch(0.72 0.10 221)" },
  red: { base: "oklch(0.64 0.19 27)" },
  magenta: { base: "oklch(0.66 0.21 323)" },
  green: { base: "oklch(0.70 0.13 162)" },
  pink: { base: "oklch(0.67 0.19 1)" },
}

const TAG_COLORS: Record<string, TagColor> = {
  B2B: TAG_PALETTE.amber,
  B2C: TAG_PALETTE.lime,
  Cafe: TAG_PALETTE.red,
  Catering: TAG_PALETTE.magenta,
  "Dairy-free": TAG_PALETTE.cyan,
  Gelato: TAG_PALETTE.purple,
  Imports: TAG_PALETTE.orange,
  Local: TAG_PALETTE.green,
  Seasonal: TAG_PALETTE.yellow,
  Sorbet: TAG_PALETTE.pink,
  Vegan: TAG_PALETTE.lime,
  Wholesale: TAG_PALETTE.amber,
}

export type RecordRow = {
  id: string
  name: string
  tags: string[]
  last: string
  strength: RecordStrength
  website?: string
}

export const INITIAL_ROWS: RecordRow[] = [
  { id: "aurora", name: "Aurora Scoops — Reykjavík", tags: ["Gelato", "Seasonal"], last: "9 days ago", strength: "strong", website: "aurora-scoops.example.com" },
  { id: "kumo", name: "Kumo Creamery — Tokyo", tags: ["B2C", "Cafe", "Vegan"], last: "3 weeks ago", strength: "strong", website: "kumo-creamery.example.com" },
  { id: "sol-nieve", name: "Sol y Nieve — Buenos Aires", tags: ["Gelato", "Local"], last: "2 months ago", strength: "weak", website: "sol-y-nieve.example.com" },
  { id: "maple-orbit", name: "Maple Orbit — Montréal", tags: ["B2B", "Wholesale", "Seasonal"], last: "15 days ago", strength: "weak", website: "maple-orbit.example.com" },
  { id: "blue-fig", name: "Blue Fig Gelato — Florence", tags: ["Gelato", "Cafe"], last: "over 1 year ago", strength: "veryweak", website: "blue-fig.example.com" },
  { id: "sahara-swirl", name: "Sahara Swirl — Marrakech", tags: ["Sorbet", "Local"], last: "5 months ago", strength: "veryweak" },
  { id: "cloudberry", name: "Cloudberry Cone — Helsinki", tags: ["Dairy-free", "Seasonal"], last: "No contact", strength: "none", website: "cloudberry-cone.example.com" },
  { id: "palm-sugar", name: "Palm Sugar Creamery — Bangkok", tags: ["B2C", "Vegan"], last: "3 months ago", strength: "veryweak", website: "palm-sugar.example.com" },
  { id: "cape-vanilla", name: "Cape Vanilla Co. — Cape Town", tags: ["Wholesale", "Imports"], last: "over 1 year ago", strength: "veryweak", website: "cape-vanilla.example.com" },
  { id: "andes-snow", name: "Andes Snow Creamery — Quito", tags: ["Gelato", "Catering"], last: "almost 2 years ago", strength: "veryweak" },
  { id: "tasman-sea", name: "Tasman Sea Gelato — Hobart", tags: ["Gelato", "Local"], last: "2 months ago", strength: "weak", website: "tasman-sea.example.com" },
  { id: "silk-road", name: "Silk Road Sorbet — Tbilisi", tags: ["Sorbet", "Imports"], last: "about 1 month ago", strength: "weak", website: "silk-road.example.com" },
  { id: "rosewater", name: "Rosewater Kulfi — Jaipur", tags: ["B2C", "Seasonal"], last: "2 months ago", strength: "veryweak" },
  { id: "lumen", name: "Lumen Soft Serve — Copenhagen", tags: ["Dairy-free", "Cafe"], last: "8 months ago", strength: "weak", website: "lumen-soft-serve.example.com" },
  { id: "cacao-norte", name: "Cacao Norte — Oaxaca", tags: ["B2B", "Local", "Wholesale"], last: "about 2 years ago", strength: "none", website: "cacao-norte.example.com" },
  { id: "pine-pistachio", name: "Pine & Pistachio — Istanbul", tags: ["Gelato", "Catering"], last: "about 1 month ago", strength: "veryweak" },
  { id: "ember-cone", name: "Ember Cone Company — Seoul", tags: ["B2C", "Vegan"], last: "15 days ago", strength: "weak", website: "ember-cone.example.com" },
  { id: "coral-coast", name: "Coral Coast Sorbet — Honolulu", tags: ["Sorbet", "Local"], last: "9 days ago", strength: "strong", website: "coral-coast.example.com" },
  { id: "sunbird", name: "Sunbird Gelateria — Lisbon", tags: ["Gelato", "Cafe"], last: "over 2 years ago", strength: "none", website: "sunbird.example.com" },
  { id: "mooncake", name: "Mooncake Ice Cream — Singapore", tags: ["B2B", "Wholesale"], last: "about 1 month ago", strength: "veryweak", website: "mooncake-ice-cream.example.com" },
  { id: "juniper", name: "Juniper & Cream — Vancouver", tags: ["Dairy-free", "Catering"], last: "No contact", strength: "none" },
  { id: "mango-moon", name: "Mango Moon Gelato — Nairobi", tags: ["Sorbet", "Vegan"], last: "almost 2 years ago", strength: "veryweak", website: "mango-moon.example.com" },
  { id: "fjord-fizz", name: "Fjord Fizz Ice — Oslo", tags: ["Dairy-free", "Seasonal"], last: "No contact", strength: "none" },
  { id: "pampa", name: "Pampa Creamery — Córdoba", tags: ["B2C", "Local"], last: "12 months ago", strength: "veryweak", website: "pampa-creamery.example.com" },
  { id: "lotus-leaf", name: "Lotus Leaf Scoops — Hanoi", tags: ["Vegan", "Cafe"], last: "15 days ago", strength: "weak" },
  { id: "saffron-sky", name: "Saffron Sky Kulfi — Dubai", tags: ["Imports", "Catering"], last: "almost 2 years ago", strength: "veryweak", website: "saffron-sky.example.com" },
  { id: "alpine-churn", name: "Alpine Churn — Zürich", tags: ["B2B", "Gelato", "Wholesale"], last: "4 days ago", strength: "strong", website: "alpine-churn.example.com" },
  { id: "monsoon-mango", name: "Monsoon Mango — Mumbai", tags: ["Sorbet", "Vegan", "Catering"], last: "18 days ago", strength: "weak", website: "monsoon-mango.example.com" },
  { id: "cedar-spoon", name: "Cedar Spoon — Beirut", tags: ["Cafe", "Local", "Seasonal"], last: "6 days ago", strength: "strong", website: "cedar-spoon.example.com" },
  { id: "baltic-berry", name: "Baltic Berry — Tallinn", tags: ["Dairy-free", "Seasonal", "B2C"], last: "5 weeks ago", strength: "weak", website: "baltic-berry.example.com" },
  { id: "delta-dairy", name: "Delta Dairy Works — New Orleans", tags: ["B2B", "Wholesale", "Local"], last: "2 days ago", strength: "strong", website: "delta-dairy.example.com" },
  { id: "yuzu-yard", name: "Yuzu Yard — Kyoto", tags: ["Sorbet", "Cafe", "Seasonal"], last: "11 days ago", strength: "strong", website: "yuzu-yard.example.com" },
  { id: "copper-cone", name: "Copper Cone — Melbourne", tags: ["Gelato", "Cafe", "B2C"], last: "about 1 month ago", strength: "weak", website: "copper-cone.example.com" },
  { id: "mint-medina", name: "Mint Medina — Tunis", tags: ["Dairy-free", "Vegan", "Local"], last: "No contact", strength: "none" },
  { id: "glacier-grove", name: "Glacier Grove — Anchorage", tags: ["Seasonal", "Local", "Catering"], last: "7 weeks ago", strength: "weak", website: "glacier-grove.example.com" },
  { id: "orchard-cloud", name: "Orchard Cloud — Lyon", tags: ["Gelato", "Seasonal", "Cafe"], last: "5 days ago", strength: "strong", website: "orchard-cloud.example.com" },
  { id: "tamarind-tide", name: "Tamarind Tide — Chennai", tags: ["Vegan", "Sorbet", "B2C"], last: "9 months ago", strength: "veryweak", website: "tamarind-tide.example.com" },
  { id: "amber-scoop", name: "Amber Scoop — Prague", tags: ["Gelato", "B2B"], last: "over 1 year ago", strength: "none" },
  { id: "boreal-batch", name: "Boreal Batch — Yellowknife", tags: ["Dairy-free", "Local", "Seasonal"], last: "8 days ago", strength: "strong", website: "boreal-batch.example.com" },
  { id: "coconut-commons", name: "Coconut Commons — Manila", tags: ["Vegan", "B2C", "Cafe"], last: "24 days ago", strength: "weak", website: "coconut-commons.example.com" },
  { id: "dolomite-dairy", name: "Dolomite Dairy — Bolzano", tags: ["Gelato", "Wholesale"], last: "3 days ago", strength: "strong", website: "dolomite-dairy.example.com" },
  { id: "equator-cream", name: "Equator Cream — Kampala", tags: ["B2B", "Catering", "Local"], last: "10 months ago", strength: "veryweak", website: "equator-cream.example.com" },
  { id: "hibiscus-house", name: "Hibiscus House — Accra", tags: ["Sorbet", "Cafe"], last: "6 weeks ago", strength: "weak", website: "hibiscus-house.example.com" },
  { id: "lagoon-ladle", name: "Lagoon Ladle — Venice", tags: ["Gelato", "Seasonal", "Catering"], last: "7 days ago", strength: "strong", website: "lagoon-ladle.example.com" },
  { id: "midnight-milk", name: "Midnight Milk — Tromsø", tags: ["Dairy-free", "Vegan", "Wholesale"], last: "No contact", strength: "none" },
  { id: "nomad-nougat", name: "Nomad Nougat — Ulaanbaatar", tags: ["Imports", "B2B"], last: "almost 2 years ago", strength: "none", website: "nomad-nougat.example.com" },
  { id: "olive-snow", name: "Olive Snow — Athens", tags: ["Gelato", "Cafe", "Local"], last: "4 days ago", strength: "strong", website: "olive-snow.example.com" },
  { id: "pacific-pear", name: "Pacific Pear — Valparaíso", tags: ["Sorbet", "Seasonal"], last: "2 months ago", strength: "weak", website: "pacific-pear.example.com" },
  { id: "quartz-cone", name: "Quartz Cone — Denver", tags: ["B2C", "Wholesale"], last: "10 days ago", strength: "strong", website: "quartz-cone.example.com" },
  { id: "red-lantern", name: "Red Lantern Creamery — Taipei", tags: ["Cafe", "Vegan"], last: "about 1 month ago", strength: "weak", website: "red-lantern.example.com" },
  { id: "salt-silk", name: "Salt & Silk — Muscat", tags: ["Imports", "Catering", "Gelato"], last: "8 months ago", strength: "veryweak", website: "salt-and-silk.example.com" },
  { id: "tropic-churn", name: "Tropic Churn — San Juan", tags: ["Sorbet", "Local", "B2C"], last: "6 days ago", strength: "strong", website: "tropic-churn.example.com" },
  { id: "umber-cream", name: "Umber Cream — Warsaw", tags: ["B2B", "Wholesale", "Cafe"], last: "5 weeks ago", strength: "weak", website: "umber-cream.example.com" },
  { id: "vanilla-vale", name: "Vanilla Vale — Antananarivo", tags: ["Imports", "Local"], last: "No contact", strength: "none" },
  { id: "willow-whip", name: "Willow Whip — Portland", tags: ["Dairy-free", "Vegan", "Cafe"], last: "3 days ago", strength: "strong", website: "willow-whip.example.com" },
  { id: "zenith-gelato", name: "Zenith Gelato — Auckland", tags: ["Gelato", "Seasonal"], last: "3 weeks ago", strength: "weak", website: "zenith-gelato.example.com" },
  { id: "apricot-atlas", name: "Apricot Atlas — Algiers", tags: ["Sorbet", "Imports"], last: "11 months ago", strength: "veryweak", website: "apricot-atlas.example.com" },
  { id: "black-sesame", name: "Black Sesame Social — Bandung", tags: ["Vegan", "Cafe", "B2C"], last: "9 days ago", strength: "strong", website: "black-sesame.example.com" },
  { id: "crimson-clover", name: "Crimson Clover — Brussels", tags: ["Gelato", "Wholesale", "Catering"], last: "2 months ago", strength: "weak", website: "crimson-clover.example.com" },
  { id: "dragonfruit-dock", name: "Dragonfruit Dock — Shenzhen", tags: ["Sorbet", "B2B", "Wholesale"], last: "No contact", strength: "none" },
]

/* the AI column resolves to fictional competitor pairs */
const AI_LABEL = "Competitors"
const COMPETITOR_POOL = [
  "Frost & Ladle",
  "Polar Pint Co.",
  "Meltwater Creamery",
  "Cirrus Scoops",
  "Golden Churn",
  "Velvet Freeze",
  "North Cone Collective",
  "Sundae Syndicate",
]
const competitorsFor = (index: number) => `${COMPETITOR_POOL[index % 8]}, ${COMPETITOR_POOL[(index + 3) % 8]}`

const TYPE_ICONS: Record<string, IconName> = {
  Text: "typeText",
  File: "file",
  Collection: "typeCollection",
  "Single select": "typeSelectSingle",
  "Multi select": "typeSelectMulti",
  URL: "typeUrl",
  Reference: "typeReference",
  JSON: "typeJson",
  "File splitter": "typeFileSplitter",
  Date: "typeDate",
}

/* per-property configuration shown in the popover */
type Prompt = { before: string; chip?: string; after?: string }
type ToolKind = "model" | "web" | "user"
type ColumnMeta = { type: string; tool: string; toolKind: ToolKind; inputs?: string; prompt?: Prompt }

const COLUMN_META: Record<string, ColumnMeta> = {
  Company: { type: "Text", tool: "User input", toolKind: "user" },
  Categories: { type: "Multi select", tool: "Sprinkles 5", toolKind: "model", inputs: "Company", prompt: { before: "Tag each ", chip: "Company", after: " with its market categories." } },
  "Last interaction": { type: "Date", tool: "User input", toolKind: "user" },
  "Connection strength": { type: "Single select", tool: "Sprinkles 5", toolKind: "model", inputs: "Last interaction", prompt: { before: "Score the relationship from ", chip: "Last interaction", after: "." } },
  Links: { type: "URL", tool: "Web search", toolKind: "web", inputs: "Company", prompt: { before: "Find the website for ", chip: "Company", after: "." } },
  [AI_LABEL]: { type: "Text", tool: "Web search", toolKind: "web", inputs: "Company", prompt: { before: "Find competitors for ", chip: "Company" } },
}

const NEW_PROPERTY_TYPES = ["Text", "File", "Collection", "Single select", "Multi select", "URL", "Reference", "JSON", "File splitter"]
const MODEL_OPTIONS = ["Sprinkles 5", "Sprinkles 4.2", "Sprinkles Mini"]
const INPUT_OPTIONS = ["Company", "Categories", "Last interaction", "Connection strength", "Links"]

/* checkbox chrome from the records-checkbox block of globals.css */
const CHECKBOX_LIGHT = { border: "oklch(0.845 0.011 247.953)", hoverBorder: "oklch(0.773 0.016 251.194)", hoverBg: "oklch(0.966 0.003 228.784)" }
const CHECKBOX_DARK = { border: "oklch(0.45 0.017 254.711)", hoverBorder: "oklch(0.521 0.019 254)", hoverBg: "oklch(0.391 0.016 251.761)", bg: "oklch(0.346 0.015 252.294)" }

/** The AI reveal — the original's scroll-into-view, as a width tween. */
const AI_REVEAL = { duration: 0.3, ease: ease.outStrong }
/** MiniSwitch knob — the 150ms source transition. */
const SWITCH_TRANSITION = { duration: 0.15, ease: ease.outStrong }
/** Popover / submenu / advanced fades — the 160ms pop-in, opacity only. */
const MENU_FADE = { duration: 0.16, ease: ease.outStrong }
/** The calc pulse square wave, retargeted every 550ms. */
const PULSE_TRANSITION = { duration: 0.5, ease: ease.inOutStrong }

const ROW_HEIGHT = 35
/** The scroll area's height cap when not filling the parent (the source's 438px). */
const ROW_VIEWPORT_H = 438
/** Rows kept mounted beyond the visible window, top and bottom. */
const ROW_OVERSCAN = 4
const CELL_LINE = 18
/** One calc row resolves per beat (the original's 110ms). */
const CALC_STEP_MS = 110

/* Tag width estimation — see the header note. */
const TAG_MAX = 115
const TAG_CHAR = 6.8
const TAG_PAD = 16
const TAG_GAP = 4

const estimateTagWidth = (name: string) => Math.min(TAG_MAX, Math.ceil(name.length * TAG_CHAR) + TAG_PAD)
const estimateMoreWidth = (count: number) => Math.ceil(String(count).length * 6.5) + TAG_PAD

/* ── Checkbox ────────────────────────────────────────────── */

const Checkbox = defineComponent({
  name: "BuiRecordsCheckbox",
  props: {
    checked: { type: Boolean, default: false },
    mixed: { type: Boolean, default: false },
    testId: { type: String, default: undefined },
    onToggle: { type: Function as PropType<() => void>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    return () => {
      const t = theme.tokens.value
      const active = props.checked || props.mixed
      const palette = theme.isDark.value ? CHECKBOX_DARK : CHECKBOX_LIGHT
      return (
        <div
          role="checkbox"
          aria-checked={props.mixed ? "mixed" : props.checked}
          testId={props.testId}
          onClick={() => props.onToggle?.()}
          style={{
            display: "flex",
            width: 24,
            height: 24,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.chip,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              display: "flex",
              width: 18,
              height: 18,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderRadius: 6,
              /* The box must not become a mouse-blocking hitbox: GPUIV
               * dispatches click through `hitbox.is_hovered`, which the first
               * filled descendant cuts off — the wrapper's onClick would never
               * fire. pointerEvents "none" keeps the hitbox non-blocking (the
               * hover chrome below still applies). */
              pointerEvents: "none",
              ...(active
                ? { borderColor: t.accent, backgroundColor: t.accent }
                : {
                    borderColor: palette.border,
                    backgroundColor: theme.isDark.value ? CHECKBOX_DARK.bg : t.surface,
                    hover: { borderColor: palette.hoverBorder, backgroundColor: palette.hoverBg },
                  }),
            }}
          >
            {props.mixed ? (
              <div style={{ width: 8, height: 1.5, borderRadius: 1, backgroundColor: "#ffffff" }} />
            ) : props.checked ? (
              <Icon name="check" size={12} color="#ffffff" />
            ) : null}
          </div>
        </div>
      )
    }
  },
})

/* ── MiniSwitch ──────────────────────────────────────────── */

const MiniSwitch = defineComponent({
  name: "BuiRecordsMiniSwitch",
  props: {
    on: { type: Boolean, default: false },
    label: { type: String, default: "" },
    onToggle: { type: Function as PropType<() => void>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    return () => {
      const t = theme.tokens.value
      return (
        <div
          role="switch"
          aria-checked={props.on}
          aria-label={props.label}
          onClick={() => props.onToggle?.()}
          style={{
            position: "relative",
            width: 30,
            height: 18,
            flexShrink: 0,
            borderRadius: 9,
            backgroundColor: props.on ? t.accent : t.lineStrong,
            cursor: "pointer",
          }}
        >
          <motion.div
            initial={false}
            animate={{ left: props.on ? 14 : 2 }}
            transition={SWITCH_TRANSITION}
            style={{
              position: "absolute",
              top: 2,
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: "#ffffff",
              pointerEvents: "none",
              boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: "rgba(0, 0, 0, 0.1)" },
            }}
          />
        </div>
      )
    }
  },
})

/* ── Cell helpers ────────────────────────────────────────── */

const tagChip = (name: string, t: Tokens): VNode => {
  const base = TAG_COLORS[name]?.base ?? t.ink3
  return (
    <div
      key={name}
      style={{
        display: "flex",
        height: 23,
        maxWidth: TAG_MAX,
        flexShrink: 0,
        alignItems: "center",
        overflow: "hidden",
        borderWidth: 1,
        borderRadius: 8,
        paddingLeft: 7,
        paddingRight: 7,
        borderColor: mix(base, t.surface, 68),
        backgroundColor: mix(base, t.surface, 82),
        color: mix(base, t.ink, 8),
        fontSize: 13,
        fontWeight: 500,
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        pointerEvents: "none",
      }}
    >
      {name}
    </div>
  )
}

const tagRow = (tags: string[], available: number, t: Tokens): VNode => {
  let used = 0
  let count = 0
  for (let index = 0; index < tags.length; index += 1) {
    const nextUsed = used + (count > 0 ? TAG_GAP : 0) + estimateTagWidth(tags[index] ?? "")
    const hiddenAfter = tags.length - (index + 1)
    const withOverflow = nextUsed + (hiddenAfter > 0 ? TAG_GAP + estimateMoreWidth(hiddenAfter) : 0)
    if (withOverflow > available) break
    used = nextUsed
    count += 1
  }
  const hidden = tags.length - count
  return (
    <div style={{ display: "flex", width: "100%", minWidth: 0, alignItems: "center", gap: TAG_GAP, overflow: "hidden" }}>
      {tags.slice(0, count).map((tag) => tagChip(tag, t))}
      {hidden > 0 ? (
        <div
          style={{
            display: "flex",
            height: 23,
            flexShrink: 0,
            alignItems: "center",
            borderWidth: 1,
            borderColor: t.lineStrong,
            borderRadius: 6,
            paddingLeft: 7,
            paddingRight: 7,
            backgroundColor: t.inset,
            fontSize: 11,
            fontWeight: 500,
            color: t.ink3,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {`+${hidden}`}
        </div>
      ) : null}
    </div>
  )
}

const calcCell = (t: Tokens, pulseOn: boolean): VNode => (
  <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
    <div style={{ fontSize: 13, fontWeight: 500, color: t.ink3 }}>Calculating…</div>
    <motion.div
      initial={false}
      animate={{ opacity: pulseOn ? 1 : 0.35 }}
      transition={PULSE_TRANSITION}
      style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 4, backgroundColor: t.accent, pointerEvents: "none" }}
    />
  </div>
)

/* ── The table ───────────────────────────────────────────── */

export const RecordsTable = defineComponent({
  name: "BuiRecordsTable",
  props: {
    /** The records shown; the demo dataset when omitted. */
    rows: { type: Array as PropType<RecordRow[]>, default: () => INITIAL_ROWS },
    /** Stretch to the parent's height instead of capping the scroll area. */
    fill: { type: Boolean, default: false },
  },
  setup(props) {
    const theme = useTheme()
    const { renderer } = useGpuix()

    const selected = ref(new Set<string>())
    const sort = ref<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 })
    const columnWidths = ref<Record<ColumnKey, number>>({ ...DEFAULT_COLUMN_WIDTHS })

    /* property popover, anchored to the clicked header */
    const prop = ref<string | null>(null)
    const grounding = ref(false)
    const groundingHelpOpen = ref(false)
    const configMenu = ref<"type" | "tool" | "inputs" | null>(null)
    const columnOverrides = ref<Record<string, Partial<ColumnMeta>>>({})
    const inputSelections = ref<Record<string, string[]>>({})
    const pinnedColumns = ref(new Set<string>())
    const moreSettingsOpen = ref(false)
    const advancedSettings = ref({ required: false, allowEmpty: true, confidence: false })

    /* + new-property menu and table options menu */
    const addOpen = ref(false)
    const tableMenuOpen = ref(false)

    /* the added AI column and its lifecycle */
    const aiState = ref<"off" | "on" | "removing">("off")
    const aiDone = ref(false)

    /* a running calculation resolves rows one by one */
    const calc = ref<{ col: string; resolved: number } | null>(null)
    const pulseOn = ref(false)

    /* JS-tracked hover: the gutter swap and the per-cell tints */
    const hoveredRow = ref<string | null>(null)
    const headerHover = ref<string | null>(null)

    const shellRef = ref<HostNode | null>(null)
    const shell = useElementBounds(shellRef)

    /* ── Row virtualization ─────────────────────────────────
     * Every mounted element costs build time on every frame (GPUI is
     * immediate-mode), and a 60-row table is ~1200 elements ≈ 11ms/frame —
     * over budget while the page scrolls. Rows have a fixed height, so only
     * the rows intersecting the table's own scroller (plus an overscan
     * fringe) are rendered, with spacers preserving the scroll geometry.
     * The scroll offset is polled at 120ms and only triggers a re-render
     * when the first visible row changes. */
    const rowsScrollRef = ref<HostNode | null>(null)
    const rowsScrollBounds = useElementBounds(rowsScrollRef, { intervalMs: 250 })
    const rowsScrollTop = ref(0)
    let rowsScrollTimer: ReturnType<typeof setInterval> | undefined

    let calcTimer: ReturnType<typeof setTimeout> | undefined
    let pulseTimer: ReturnType<typeof setInterval> | undefined
    let revealTimer: ReturnType<typeof setTimeout> | undefined
    let pendingTimer: ReturnType<typeof setTimeout> | undefined
    onMounted(() => {
      rowsScrollTimer = setInterval(() => {
        const id = rowsScrollRef.value?.id
        if (id == null) return
        if (visibleRows.value.length * ROW_HEIGHT <= ROW_VIEWPORT_H) return
        try {
          const offset = renderer?.getScrollOffset?.(id)
          if (!offset || offset.length < 2) return
          const next = Math.max(0, -offset[1])
          if (Math.floor(next / ROW_HEIGHT) !== Math.floor(rowsScrollTop.value / ROW_HEIGHT)) {
            rowsScrollTop.value = next
          }
        } catch {
          /* renderer not ready */
        }
      }, 120)
    })
    onBeforeUnmount(() => {
      if (calcTimer !== undefined) clearTimeout(calcTimer)
      if (pulseTimer !== undefined) clearInterval(pulseTimer)
      if (revealTimer !== undefined) clearTimeout(revealTimer)
      if (pendingTimer !== undefined) clearTimeout(pendingTimer)
      if (rowsScrollTimer !== undefined) clearInterval(rowsScrollTimer)
    })

    /* Dismiss guard (the Select pattern): a press that closed a menu from
     * outside sets this flag, and the trigger click that follows in the same
     * event batch consumes it instead of reopening. Cleared on a microtask —
     * a 0ms timeout runs between mouseDown and the click on the real event
     * loop and would let the menu reopen. */
    let dismissedKind: string | null = null
    const armDismissGuard = (kind: string) => {
      dismissedKind = kind
      queueMicrotask(() => {
        dismissedKind = null
      })
    }
    const guard = (kind: string) => {
      if (dismissedKind === kind) {
        dismissedKind = null
        return true
      }
      return false
    }

    /* One-tick suppress for nested header controls (see openProp), cleared on
     * a microtask like the dismiss guard. */
    let suppressHeaderClick = false
    const armSuppress = () => {
      suppressHeaderClick = true
      queueMicrotask(() => {
        suppressHeaderClick = false
      })
    }

    const closeMenus = () => {
      prop.value = null
      configMenu.value = null
      groundingHelpOpen.value = false
      moreSettingsOpen.value = false
      addOpen.value = false
      tableMenuOpen.value = false
    }
    const dismissFromOutside = () => {
      const kind = prop.value ?? (addOpen.value ? "add" : tableMenuOpen.value ? "tableMenu" : null)
      closeMenus()
      if (kind !== null) armDismissGuard(kind)
    }

    const openProp = (col: string) => {
      /* Mouse events dispatch through the whole hovered hitbox chain, so a
       * press on a nested control (the select-all checkbox, a sort arrow)
       * would also arrive here. Those handlers arm this one-tick suppress
       * first — the stand-in for the original's stopPropagation. */
      if (suppressHeaderClick) {
        suppressHeaderClick = false
        return
      }
      if (guard(col)) return
      closeMenus()
      prop.value = col
    }
    const toggleAddMenu = () => {
      if (guard("add")) return
      closeMenus()
      addOpen.value = true
    }
    const toggleTableMenu = () => {
      if (guard("tableMenu")) return
      closeMenus()
      tableMenuOpen.value = true
    }

    const visibleRows = computed(() =>
      [...props.rows].sort((a, b) => {
        const value =
          sort.value.key === "name"
            ? a.name.localeCompare(b.name)
            : sort.value.key === "last"
              ? a.last.localeCompare(b.last)
              : STRENGTH[a.strength]!.rank - STRENGTH[b.strength]!.rank
        return value * sort.value.dir
      }),
    )

    const isCalc = (col: string, index: number) => !!calc.value && calc.value.col === col && index >= calc.value.resolved

    const toggleSort = (key: SortKey) => {
      armSuppress()
      sort.value = sort.value.key === key ? { key, dir: (sort.value.dir * -1) as 1 | -1 } : { key, dir: 1 }
    }

    const allSelected = computed(() => visibleRows.value.length > 0 && visibleRows.value.every((row) => selected.value.has(row.id)))
    const partiallySelected = computed(() => !allSelected.value && visibleRows.value.some((row) => selected.value.has(row.id)))

    const toggleRow = (id: string) => {
      armSuppress()
      const next = new Set(selected.value)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      selected.value = next
    }
    const toggleAll = () => {
      armSuppress()
      const next = new Set(selected.value)
      if (allSelected.value) visibleRows.value.forEach((row) => next.delete(row.id))
      else visibleRows.value.forEach((row) => next.add(row.id))
      selected.value = next
    }

    /* stagger: one row resolves every beat */
    const stopPulse = () => {
      if (pulseTimer !== undefined) {
        clearInterval(pulseTimer)
        pulseTimer = undefined
      }
      pulseOn.value = false
    }
    const stepCalc = () => {
      calcTimer = setTimeout(() => {
        calcTimer = undefined
        const current = calc.value
        if (!current) return
        if (current.resolved > visibleRows.value.length) {
          if (current.col === AI_LABEL) aiDone.value = true
          calc.value = null
          stopPulse()
          return
        }
        calc.value = { ...current, resolved: current.resolved + 1 }
        stepCalc()
      }, CALC_STEP_MS)
    }
    const startCalc = (col: string) => {
      if (calc.value) return
      closeMenus()
      calc.value = { col, resolved: 0 }
      pulseOn.value = false
      pulseTimer = setInterval(() => {
        pulseOn.value = !pulseOn.value
      }, 550)
      stepCalc()
    }

    /* after adding the AI column, open its config anchored to the new header
     * once the reveal tween has settled */
    const addAiColumn = () => {
      closeMenus()
      aiDone.value = false
      aiState.value = "on"
      /* A pending "removing" collapse would otherwise fire 320ms after this
       * add and flip the fresh column back off. */
      if (revealTimer !== undefined) {
        clearTimeout(revealTimer)
        revealTimer = undefined
      }
      if (pendingTimer !== undefined) clearTimeout(pendingTimer)
      pendingTimer = setTimeout(() => {
        pendingTimer = undefined
        if (aiState.value === "on") openProp(AI_LABEL)
      }, 340)
    }
    const removeAiColumn = () => {
      closeMenus()
      aiDone.value = false
      aiState.value = "removing"
      if (revealTimer !== undefined) clearTimeout(revealTimer)
      revealTimer = setTimeout(() => {
        revealTimer = undefined
        aiState.value = "off"
      }, 320)
    }

    /* Width-only view of the shell bounds: a scroll translates x/y but not
     * width, so the table does not re-render on every bounds poll tick
     * while the page scrolls. */
    const shellWidth = computed(() => shell.bounds.value?.width ?? null)

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const dark = theme.isDark.value

      const aiShown = aiState.value !== "off"
      const bases = columnWidths.value
      const baseTotal =
        bases.company + bases.categories + bases.last + bases.strength + bases.links + (aiShown ? bases.ai : 0) + ACTION_WIDTH
      const contentWidth = Math.max((shellWidth.value ?? baseTotal) - (props.fill ? 0 : 2), 1)
      const colWidth = (base: number) => (base / baseTotal) * contentWidth
      const wCompany = colWidth(bases.company)
      const wCategories = colWidth(bases.categories)
      const wLast = colWidth(bases.last)
      const wStrength = colWidth(bases.strength)
      const wLinks = colWidth(bases.links)
      const wAction = colWidth(ACTION_WIDTH)
      const aiW = colWidth(bases.ai)

      const cellBorder = withAlpha(t.line, 0.78)

      const cell = (width: number, last = false): StyleDesc => ({
        display: "flex",
        alignItems: "center",
        width,
        flexShrink: 0,
        height: ROW_HEIGHT,
        paddingLeft: 8,
        paddingRight: 8,
        overflow: "hidden",
        ...(last ? {} : { borderRightWidth: 1, borderColor: cellBorder }),
      })

      const colselBar = (sel: boolean): VNode | null =>
        sel ? (
          <div
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, backgroundColor: t.accent, pointerEvents: "none" }}
          />
        ) : null

      /* ── popovers ─────────────────────────────────────────── */

      const configRow = (label: string, value: VNode | null, key: string, extra?: VNode | null): VNode => (
        <div
          key={key}
          style={{
            position: "relative",
            display: "flex",
            height: 32,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 13, color: t.ink3 }}>{label}</div>
          {value}
          {extra ?? null}
        </div>
      )

      const menuRowStyle = (): StyleDesc => ({
        display: "flex",
        alignItems: "center",
        width: "100%",
        height: 32,
        gap: 10,
        paddingLeft: 6,
        paddingRight: 6,
        borderRadius: 8,
        cursor: "pointer",
      })

      const configPicker = (opts: {
        label: string
        selected: string
        options: { label: string; icon: IconName; iconSize?: number; iconColor?: string }[]
        onPick: (value: string) => void
        testPrefix: string
      }): VNode => (
        <div
          style={{
            position: "absolute",
            left: 334,
            top: 0,
            width: 210,
            borderRadius: 12,
            backgroundColor: t.surface,
            ...shadows.overlay,
            padding: 6,
          }}
        >
          <div style={{ paddingLeft: 8, paddingBottom: 4, paddingTop: 2, fontSize: 11.5, fontWeight: 500, color: t.ink3 }}>
            {opts.label}
          </div>
          <GlideMenuRoot style={{ gap: 1 }}>
            {opts.options.map((option) =>
              h(
                GlideMenuItem,
                {
                  key: option.label,
                  testId: `${opts.testPrefix}-${option.label}`,
                  onClick: () => opts.onPick(option.label),
                  style: {
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    height: 32,
                    gap: 6,
                    paddingLeft: 6,
                    paddingRight: 6,
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    color: t.ink,
                    cursor: "pointer",
                  } satisfies StyleDesc,
                },
                () => [
                  <div style={{ display: "flex", width: 16, height: 16, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
                    <Icon name={option.icon} size={option.iconSize ?? 14} color={option.iconColor ?? t.ink2} />
                  </div>,
                  <div style={{ minWidth: 0, flexGrow: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                    {option.label}
                  </div>,
                  option.label === opts.selected ? <Icon name="check" size={14} color={t.ink} /> : null,
                ],
              ),
            )}
          </GlideMenuRoot>
        </div>
      )

      const inputPicker = (opts: { col: string; inputs: string[]; onToggle: (value: string) => void }): VNode => (
        <div
          style={{
            position: "absolute",
            left: 334,
            top: 0,
            width: 220,
            borderRadius: 12,
            backgroundColor: t.surface,
            ...shadows.overlay,
            padding: 6,
          }}
        >
          <div style={{ paddingLeft: 8, paddingBottom: 4, paddingTop: 2, fontSize: 11.5, fontWeight: 500, color: t.ink3 }}>
            Use values from
          </div>
          <GlideMenuRoot style={{ gap: 1 }}>
            {INPUT_OPTIONS.filter((input) => input !== opts.col).map((input) => {
              const checked = opts.inputs.includes(input)
              return h(
                GlideMenuItem,
                {
                  key: input,
                  testId: `records-input-${input}`,
                  onClick: () => opts.onToggle(input),
                  style: {
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    height: 32,
                    gap: 6,
                    paddingLeft: 6,
                    paddingRight: 6,
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    color: t.ink,
                    cursor: "pointer",
                  } satisfies StyleDesc,
                },
                () => [
                  <div
                    style={{
                      display: "flex",
                      width: 16,
                      height: 16,
                      flexShrink: 0,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderRadius: 5,
                      ...(checked ? { borderColor: t.accent, backgroundColor: t.accent } : { borderColor: t.lineStrong }),
                    }}
                  >
                    {checked ? <Icon name="check" size={11} color="#ffffff" /> : null}
                  </div>,
                  <div style={{ minWidth: 0, flexGrow: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                    {input}
                  </div>,
                ],
              )
            })}
          </GlideMenuRoot>
        </div>
      )

      const propPopover = (): VNode => {
        const col = prop.value
        if (col === null) return <div />
        const meta: ColumnMeta = { ...COLUMN_META[col], ...columnOverrides.value[col] }
        const inputsSel = inputSelections.value[col] ?? (meta.inputs ? [meta.inputs] : [])
        const pinned = pinnedColumns.value.has(col)
        const typeIcon = TYPE_ICONS[meta.type] ?? "typeText"
        const toolGlyph =
          meta.toolKind === "model" ? (
            <Icon name="toolModel" size={14} color={t.accent} />
          ) : (
            <Icon name={meta.toolKind === "web" ? "globe" : "toolUser"} size={14} color={t.ink2} />
          )

        const triggerButton = (testId: string, menu: "type" | "tool" | "inputs", children: VNode[]): VNode => (
          <div
            testId={testId}
            onClick={() => {
              configMenu.value = configMenu.value === menu ? null : menu
              groundingHelpOpen.value = false
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              maxWidth: 220,
              borderRadius: 6,
              paddingLeft: 6,
              paddingRight: 6,
              paddingTop: 4,
              paddingBottom: 4,
              cursor: "pointer",
              hover: { backgroundColor: t.hover },
            }}
          >
            {children}
          </div>
        )

        const typeRow = triggerButton("records-type-row", "type", [
          <Icon name={typeIcon} size={14} color={t.ink2} />,
          <div style={{ fontSize: 13, fontWeight: 500, color: t.ink }}>{meta.type}</div>,
          <Icon name="chevronRight" size={12} color={t.ink3} />,
        ])
        const toolRow = triggerButton("records-tool-row", "tool", [
          toolGlyph,
          <div style={{ fontSize: 13, fontWeight: 500, color: t.ink, whiteSpace: "nowrap" }}>{meta.tool}</div>,
          <Icon name="chevronRight" size={12} color={t.ink3} />,
        ])
        const inputsRow = triggerButton("records-inputs-row", "inputs", [
          inputsSel.length > 0 ? (
            <div style={{ display: "flex", minWidth: 0, alignItems: "center", gap: 4 }}>
              {inputsSel.slice(0, 2).map((input) => (
                <div
                  key={input}
                  style={{
                    maxWidth: 92,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    borderRadius: 5,
                    backgroundColor: t.accentTint,
                    paddingLeft: 6,
                    paddingRight: 6,
                    paddingTop: 2,
                    paddingBottom: 2,
                    fontSize: 12,
                    fontWeight: 500,
                    color: t.accentInk,
                  }}
                >
                  {input}
                </div>
              ))}
              {inputsSel.length > 2 ? (
                <div style={{ fontSize: 11, fontWeight: 500, color: t.ink3 }}>+{inputsSel.length - 2}</div>
              ) : null}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: t.ink2 }}>Select inputs</div>
          ),
          <Icon name="chevronRight" size={12} color={t.ink3} />,
        ])

        const groundingRow = configRow(
          "Grounding",
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MiniSwitch
              on={grounding.value}
              label="Grounding"
              onToggle={() => {
                grounding.value = !grounding.value
              }}
            />
            <div
              aria-label="About grounding"
              onClick={() => {
                groundingHelpOpen.value = !groundingHelpOpen.value
              }}
              style={{
                display: "flex",
                width: 24,
                height: 24,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                cursor: "pointer",
                hover: { backgroundColor: t.hover },
              }}
            >
              <Icon name="infoCircle" size={13} color={t.ink3} />
            </div>
          </div>,
          "grounding",
          groundingHelpOpen.value ? (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: 30,
                width: 230,
                borderRadius: 10,
                paddingLeft: 12,
                paddingRight: 12,
                paddingTop: 10,
                paddingBottom: 10,
                backgroundColor: t.tooltipBg,
                color: t.tooltipFg,
                fontSize: 12,
                lineHeight: 16,
                ...shadows.overlay,
              }}
            >
              Grounding lets the model verify generated values against connected sources.
            </div>
          ) : null,
        )

        const running = calc.value !== null

        return h(
          "anchored",
          {
            side: "bottom",
            align: "start",
            gap: 6,
            offset: { x: 0, y: 0 },
            fit: "snap",
            snapMargin: 8,
            deferred: true,
            priority: 1,
            occlude: true,
            style: {
              width: 320,
              borderRadius: radius.window,
              backgroundColor: t.surface,
              ...shadows.overlay,
            } satisfies StyleDesc,
          },
          [
            /* The catcher widens over an open submenu: mouseDownOutside is
             * hitbox-rect based, so its rect must cover the flyout too. */
            <div
              key="prop"
              motion={{
                initial: { opacity: 0 },
                animate: { opacity: 1 },
                transition: MENU_FADE,
              }}
              onMouseDownOutside={() => {
                dismissFromOutside()
              }}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                width: configMenu.value !== null ? 560 : 320,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  width: 320,
                  paddingTop: 12,
                  paddingLeft: 12,
                  paddingRight: 12,
                  paddingBottom: 6,
                }}
              >
                <div style={{ paddingBottom: 8, fontSize: 13.5, fontWeight: 500, color: t.ink }}>{col}</div>

                {configRow(
                  "Type",
                  typeRow,
                  "type",
                  configMenu.value === "type"
                    ? configPicker({
                        label: "Property type",
                        selected: meta.type,
                        options: NEW_PROPERTY_TYPES.map((type) => ({ label: type, icon: TYPE_ICONS[type] ?? "typeText", iconSize: 15 })),
                        onPick: (type) => {
                          columnOverrides.value = { ...columnOverrides.value, [col]: { ...columnOverrides.value[col], type } }
                          configMenu.value = null
                        },
                        testPrefix: "records-type-option",
                      })
                    : null,
                )}
                {configRow(
                  "Tool",
                  toolRow,
                  "tool",
                  configMenu.value === "tool"
                    ? configPicker({
                        label: "Model",
                        selected: meta.tool,
                        options: MODEL_OPTIONS.map((model) => ({ label: model, icon: "toolModel", iconColor: t.accent })),
                        onPick: (tool) => {
                          columnOverrides.value = { ...columnOverrides.value, [col]: { ...columnOverrides.value[col], tool, toolKind: "model" } }
                          configMenu.value = null
                        },
                        testPrefix: "records-model-option",
                      })
                    : null,
                )}
                {groundingRow}
                {configRow(
                  "Inputs",
                  inputsRow,
                  "inputs",
                  configMenu.value === "inputs"
                    ? inputPicker({
                        col,
                        inputs: inputsSel,
                        onToggle: (input) => {
                          const existing = inputSelections.value[col] ?? (meta.inputs ? [meta.inputs] : [])
                          const next = existing.includes(input) ? existing.filter((item) => item !== input) : [...existing, input]
                          inputSelections.value = { ...inputSelections.value, [col]: next }
                        },
                      })
                    : null,
                )}

                {/* prompt — static preview with the @-mention chip */}
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    alignContent: "flex-start",
                    alignItems: "center",
                    minHeight: 88,
                    borderRadius: 10,
                    backgroundColor: t.inset,
                    padding: 12,
                    ...shadows.hairline,
                  }}
                >
                  {meta.prompt ? (
                    [
                      <div key="before" style={{ fontSize: 13, lineHeight: 18, color: t.ink }}>
                        {meta.prompt.before}
                      </div>,
                      meta.prompt.chip ? (
                        <div
                          key="chip"
                          style={{
                            borderRadius: 5,
                            backgroundColor: t.accentTint,
                            paddingLeft: 6,
                            paddingRight: 6,
                            paddingTop: 2,
                            paddingBottom: 2,
                            fontSize: 12,
                            fontWeight: 500,
                            color: t.accentInk,
                          }}
                        >
                          {meta.prompt.chip}
                        </div>
                      ) : null,
                      meta.prompt.after ? (
                        <div key="after" style={{ fontSize: 13, lineHeight: 18, color: t.ink }}>
                          {meta.prompt.after}
                        </div>
                      ) : null,
                    ]
                  ) : (
                    <div style={{ fontSize: 13, color: t.ink3 }}>Set a prompt (press @ to mention an input)</div>
                  )}
                </div>

                <div
                  testId="records-go-calculate"
                  onClick={running ? undefined : () => startCalc(col)}
                  style={{
                    display: "flex",
                    marginTop: 10,
                    width: "100%",
                    height: 36,
                    flexShrink: 0,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    borderRadius: 9,
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: t.ink,
                    cursor: running ? "default" : "pointer",
                    opacity: running ? 0.6 : 1,
                    ...shadows.btn,
                    ...(running ? {} : { hover: { backgroundColor: t.hover } }),
                  }}
                >
                  <Icon name="retrySoft" size={14} color={t.ink2} />
                  Go calculate
                </div>

                <GlideMenuRoot style={{ marginTop: 12, borderTopWidth: 1, borderColor: t.line, paddingTop: 8, gap: 2 }}>
                  {h(
                    GlideMenuItem,
                    {
                      key: "pin",
                      testId: "records-pin",
                      onClick: () => {
                        const next = new Set(pinnedColumns.value)
                        if (next.has(col)) next.delete(col)
                        else next.add(col)
                        pinnedColumns.value = next
                      },
                      style: menuRowStyle(),
                    },
                    () => [
                      <div style={{ display: "flex", width: 15, height: 15, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
                        <Icon name="pin" size={15} color={pinned ? t.accent : t.ink2} />
                      </div>,
                      <div style={{ fontSize: 13, lineHeight: 13, color: t.ink }}>{pinned ? "Unpin" : "Pin"}</div>,
                    ],
                  )}
                  {h(
                    GlideMenuItem,
                    {
                      key: "more",
                      testId: "records-more-settings",
                      onClick: () => {
                        moreSettingsOpen.value = !moreSettingsOpen.value
                      },
                      style: menuRowStyle(),
                    },
                    () => [
                      <div style={{ display: "flex", width: 15, height: 15, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
                        <Icon name="gear" size={15} color={moreSettingsOpen.value ? t.ink : t.ink2} />
                      </div>,
                      <div style={{ minWidth: 0, flexGrow: 1, fontSize: 13, lineHeight: 13, color: t.ink }}>More settings</div>,
                      <Icon name={moreSettingsOpen.value ? "chevronDown" : "chevronRight"} size={12} color={t.ink3} />,
                    ],
                  )}
                  {col === AI_LABEL
                    ? h(
                        GlideMenuItem,
                        {
                          key: "hide",
                          testId: "records-hide-ai",
                          onClick: removeAiColumn,
                          style: menuRowStyle(),
                        },
                        () => [
                          <div style={{ display: "flex", width: 15, height: 15, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
                            <Icon name="eyeOff" size={15} color={t.ink2} />
                          </div>,
                          <div style={{ fontSize: 13, lineHeight: 13, color: t.ink }}>Hide from view</div>,
                        ],
                      )
                    : null}
                </GlideMenuRoot>

                {moreSettingsOpen.value ? (
                  <motion.div
                    key="advanced"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={MENU_FADE}
                    style={{ marginTop: 8, borderTopWidth: 1, borderColor: t.line, paddingTop: 8, width: "100%" }}
                  >
                    <div style={{ paddingBottom: 4, fontSize: 11.5, fontWeight: 500, color: t.ink3 }}>Behavior</div>
                    {configRow(
                      "Required value",
                      <MiniSwitch
                        on={advancedSettings.value.required}
                        label="Required value"
                        onToggle={() => {
                          advancedSettings.value = { ...advancedSettings.value, required: !advancedSettings.value.required }
                        }}
                      />,
                      "required",
                    )}
                    {configRow(
                      "Allow empty results",
                      <MiniSwitch
                        on={advancedSettings.value.allowEmpty}
                        label="Allow empty results"
                        onToggle={() => {
                          advancedSettings.value = { ...advancedSettings.value, allowEmpty: !advancedSettings.value.allowEmpty }
                        }}
                      />,
                      "allowEmpty",
                    )}
                    {configRow(
                      "Show confidence",
                      <MiniSwitch
                        on={advancedSettings.value.confidence}
                        label="Show confidence"
                        onToggle={() => {
                          advancedSettings.value = { ...advancedSettings.value, confidence: !advancedSettings.value.confidence }
                        }}
                      />,
                      "confidence",
                    )}
                  </motion.div>
                ) : null}
              </div>
            </div>,
          ],
        )
      }

      const addMenu = (): VNode =>
        h(
          "anchored",
          {
            side: "bottom",
            align: "start",
            gap: 6,
            offset: { x: 0, y: 0 },
            fit: "snap",
            snapMargin: 8,
            deferred: true,
            priority: 1,
            occlude: true,
            style: {
              width: 260,
              borderRadius: radius.window,
              backgroundColor: t.surface,
              ...shadows.overlay,
            } satisfies StyleDesc,
          },
          [
            <div
              key="add"
              motion={{
                initial: { opacity: 0 },
                animate: { opacity: 1 },
                transition: MENU_FADE,
              }}
              onMouseDownOutside={() => {
                dismissFromOutside()
              }}
              style={{ padding: 6 }}
            >
              <div style={{ paddingLeft: 8, paddingBottom: 4, paddingTop: 4, fontSize: 12, fontWeight: 500, color: t.ink3 }}>
                New property
              </div>
              <GlideMenuRoot style={{ gap: 1 }}>
                {NEW_PROPERTY_TYPES.map((type) =>
                  h(
                    GlideMenuItem,
                    {
                      key: type,
                      testId: `records-new-property-${type}`,
                      onClick: addAiColumn,
                      style: {
                        display: "flex",
                        alignItems: "center",
                        width: "100%",
                        height: 36,
                        gap: 10,
                        paddingLeft: 8,
                        paddingRight: 8,
                        borderRadius: 8,
                        fontSize: 13,
                        color: t.ink,
                        cursor: "pointer",
                      } satisfies StyleDesc,
                    },
                    () => [
                      <div style={{ display: "flex", width: 18, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
                        <Icon name={TYPE_ICONS[type] ?? "typeText"} size={15} color={t.ink2} />
                      </div>,
                      <div>{type}</div>,
                    ],
                  ),
                )}
              </GlideMenuRoot>
            </div>,
          ],
        )

      const tableMenu = (): VNode =>
        h(
          "anchored",
          {
            side: "bottom",
            align: "end",
            gap: 6,
            offset: { x: 0, y: 0 },
            fit: "snap",
            snapMargin: 8,
            deferred: true,
            priority: 1,
            occlude: true,
            style: {
              width: 220,
              borderRadius: radius.window,
              backgroundColor: t.surface,
              ...shadows.overlay,
            } satisfies StyleDesc,
          },
          [
            <div
              key="table-menu"
              motion={{
                initial: { opacity: 0 },
                animate: { opacity: 1 },
                transition: MENU_FADE,
              }}
              onMouseDownOutside={() => {
                dismissFromOutside()
              }}
              style={{ padding: 6 }}
            >
              <div style={{ paddingLeft: 8, paddingBottom: 4, paddingTop: 4, fontSize: 12, fontWeight: 500, color: t.ink3 }}>
                Table options
              </div>
              <GlideMenuRoot style={{ gap: 1 }}>
                {h(
                  GlideMenuItem,
                  {
                    key: "add-property",
                    testId: "records-menu-add-property",
                    onClick: () => {
                      closeMenus()
                      addOpen.value = true
                    },
                    style: { ...menuRowStyle(), height: 36, paddingLeft: 8, paddingRight: 8, gap: 10 } satisfies StyleDesc,
                  },
                  () => [
                    <div style={{ display: "flex", width: 18, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
                      <Icon name="plus" size={15} color={t.ink2} />
                    </div>,
                    <div style={{ fontSize: 13, color: t.ink }}>Add property</div>,
                  ],
                )}
                {h(
                  GlideMenuItem,
                  {
                    key: "compact",
                    testId: "records-menu-compact",
                    onClick: () => {
                      columnWidths.value = { ...COMPACT_COLUMN_WIDTHS }
                      closeMenus()
                    },
                    style: { ...menuRowStyle(), height: 36, paddingLeft: 8, paddingRight: 8, gap: 10 } satisfies StyleDesc,
                  },
                  () => [
                    <div style={{ display: "flex", width: 18, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
                      <Icon name="compactColumns" size={15} color={t.ink2} />
                    </div>,
                    <div style={{ fontSize: 13, color: t.ink }}>Compact columns</div>,
                  ],
                )}
                {h(
                  GlideMenuItem,
                  {
                    key: "reset",
                    testId: "records-menu-reset",
                    onClick: () => {
                      columnWidths.value = { ...DEFAULT_COLUMN_WIDTHS }
                      closeMenus()
                    },
                    style: { ...menuRowStyle(), height: 36, paddingLeft: 8, paddingRight: 8, gap: 10 } satisfies StyleDesc,
                  },
                  () => [
                    <div style={{ display: "flex", width: 18, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
                      <Icon name="resetColumns" size={15} color={t.ink2} />
                    </div>,
                    <div style={{ fontSize: 13, color: t.ink }}>Reset column widths</div>,
                  ],
                )}
                <div style={{ height: 1, marginTop: 4, marginBottom: 4, backgroundColor: t.line }} />
                {h(
                  GlideMenuItem,
                  {
                    key: "clear",
                    testId: "records-menu-clear",
                    onClick: () => {
                      selected.value = new Set()
                      closeMenus()
                    },
                    style: { ...menuRowStyle(), height: 36, paddingLeft: 8, paddingRight: 8, gap: 10 } satisfies StyleDesc,
                  },
                  () => [
                    <div style={{ display: "flex", width: 18, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
                      <Icon name="x" size={15} color={t.ink2} />
                    </div>,
                    <div style={{ fontSize: 13, color: t.ink }}>Clear selection</div>,
                  ],
                )}
              </GlideMenuRoot>
            </div>,
          ],
        )

      /* ── header ───────────────────────────────────────────── */

      const companySelected = prop.value === "Company"
      const companyHeader = (
        <div
          key="company"
          testId="records-header-company"
          onMouseEnter={() => {
            headerHover.value = "company"
          }}
          onMouseLeave={() => {
            if (headerHover.value === "company") headerHover.value = null
          }}
          onClick={() => {
            openProp("Company")
          }}
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            width: wCompany,
            height: ROW_HEIGHT,
            flexShrink: 0,
            paddingLeft: 6,
            paddingRight: 12,
            gap: 8,
            cursor: "pointer",
            ...(companySelected ? { backgroundColor: mix(t.accent, t.surface, 92) } : {}),
            borderRightWidth: 1,
            borderColor: cellBorder,
          }}
        >
          {colselBar(companySelected)}
          <Checkbox testId="records-check-all" checked={allSelected.value} mixed={partiallySelected.value} onToggle={toggleAll} />
          <div style={{ fontSize: 12.5, fontWeight: 500, color: companySelected ? t.accentInk : t.ink2, whiteSpace: "nowrap" }}>
            Company
          </div>
          {companySelected ? propPopover() : null}
        </div>
      )

      const headerCell = (opts: {
        key: string
        col: string
        label: string
        icon: IconName
        sortKey?: SortKey
        width: number
      }): VNode => {
        const sel = prop.value === opts.col
        const sortActive = opts.sortKey !== undefined && sort.value.key === opts.sortKey
        return (
          <div
            key={opts.key}
            testId={`records-header-${opts.key}`}
            onMouseEnter={() => {
              headerHover.value = opts.key
            }}
            onMouseLeave={() => {
              if (headerHover.value === opts.key) headerHover.value = null
            }}
            onClick={() => {
              openProp(opts.col)
            }}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              width: opts.width,
              height: ROW_HEIGHT,
              flexShrink: 0,
              paddingLeft: 12,
              paddingRight: 12,
              gap: 8,
              cursor: "pointer",
              ...(sel ? { backgroundColor: mix(t.accent, t.surface, 92) } : {}),
              borderRightWidth: 1,
              borderColor: cellBorder,
            }}
          >
            {colselBar(sel)}
            <Icon name={opts.icon} size={15} color={sel ? t.accentInk : t.ink3} />
            <div
              style={{
                minWidth: 0,
                flexGrow: 1,
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                fontSize: 12.5,
                fontWeight: 500,
                lineHeight: 16,
                color: sel ? t.accentInk : t.ink2,
              }}
            >
              {opts.label}
            </div>
            {opts.sortKey ? (
              <div
                testId={`records-sort-${opts.sortKey}`}
                onClick={() => {
                  toggleSort(opts.sortKey as SortKey)
                }}
                style={{
                  display: "flex",
                  flexShrink: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  cursor: "pointer",
                  opacity: sortActive || headerHover.value === opts.key ? 1 : 0,
                }}
              >
                <Icon
                  name={sortActive && sort.value.dir === -1 ? "arrowUp" : "arrowDown"}
                  size={12}
                  color={sel ? t.accentInk : t.ink3}
                />
              </div>
            ) : null}
            {sel ? propPopover() : null}
          </div>
        )
      }

      const aiHeader = aiShown ? (
        <div
          key="ai"
          testId="records-header-ai"
          motion={{
            initial: { width: 0 },
            animate: { width: aiState.value === "on" ? aiW : 0 },
            transition: AI_REVEAL,
          }}
          onMouseEnter={() => {
            headerHover.value = "ai"
          }}
          onMouseLeave={() => {
            if (headerHover.value === "ai") headerHover.value = null
          }}
          onClick={() => {
            openProp(AI_LABEL)
          }}
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            height: ROW_HEIGHT,
            flexShrink: 0,
            paddingLeft: 12,
            paddingRight: 12,
            gap: 8,
            overflow: "hidden",
            cursor: "pointer",
            ...(prop.value === AI_LABEL ? { backgroundColor: mix(t.accent, t.surface, 92) } : {}),
            borderRightWidth: 1,
            borderColor: cellBorder,
          }}
        >
          {colselBar(prop.value === AI_LABEL)}
          <Icon name="typeText" size={15} color={prop.value === AI_LABEL ? t.accentInk : t.ink3} />
          <div
            style={{
              minWidth: 0,
              flexGrow: 1,
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              fontSize: 12.5,
              fontWeight: 500,
              lineHeight: 16,
              color: prop.value === AI_LABEL ? t.accentInk : t.ink2,
            }}
          >
            {AI_LABEL}
          </div>
          {prop.value === AI_LABEL ? propPopover() : null}
        </div>
      ) : null

      const actionHeader = (
        <div
          key="action"
          style={{
            display: "flex",
            alignItems: "center",
            width: wAction,
            height: ROW_HEIGHT,
            flexShrink: 0,
            paddingLeft: 8,
            paddingRight: 8,
            gap: 4,
          }}
        >
          <div style={{ position: "relative", display: "flex" }}>
            <div
              testId="records-add-property"
              aria-label="New property"
              onClick={toggleAddMenu}
              style={{
                display: "flex",
                width: 28,
                height: 28,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 7,
                cursor: "pointer",
                hover: { backgroundColor: t.hover },
              }}
            >
              <Icon name="plus" size={15} color={t.ink2} />
            </div>
            {addOpen.value ? addMenu() : null}
          </div>
          <div style={{ position: "relative", display: "flex" }}>
            <div
              testId="records-table-menu"
              aria-label="Table options"
              onClick={toggleTableMenu}
              style={{
                display: "flex",
                width: 28,
                height: 28,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 7,
                cursor: "pointer",
                hover: { backgroundColor: t.hover },
              }}
            >
              <Icon name="ellipsis" size={15} color={t.ink3} />
            </div>
            {tableMenuOpen.value ? tableMenu() : null}
          </div>
        </div>
      )

      /* ── rows ─────────────────────────────────────────────── */

      const avgPercent =
        props.rows.length > 0
          ? Math.round(
              (props.rows.reduce((sum, row) => sum + STRENGTH[row.strength]!.rank, 0) / props.rows.length / 3) * 100,
            )
          : 0
      const linksCount = props.rows.filter((row) => row.website).length

      const aiCellContent = (index: number): VNode => {
        if (calc.value?.col === AI_LABEL) {
          return index < calc.value.resolved ? (
            <div
              style={{
                minWidth: 0,
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                fontSize: 13,
                fontWeight: 500,
                lineHeight: CELL_LINE,
                color: t.ink,
              }}
            >
              {competitorsFor(index)}
            </div>
          ) : (
            calcCell(t, pulseOn.value)
          )
        }
        if (aiDone.value) {
          return (
            <div
              style={{
                minWidth: 0,
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                fontSize: 13,
                fontWeight: 500,
                lineHeight: CELL_LINE,
                color: t.ink,
              }}
            >
              {competitorsFor(index)}
            </div>
          )
        }
        return <div style={{ fontSize: 13, fontWeight: 500, lineHeight: CELL_LINE, color: t.ink3 }}>—</div>
      }

      /* Virtualized slice: only rows intersecting the table's own scroller
       * (plus overscan) render; spacers keep the scroll geometry. Indices
       * stay real (row numbers, calc progress and the competitor pairs are
       * all index-derived). */
      const totalRows = visibleRows.value.length
      const viewportH = props.fill ? rowsScrollBounds.bounds.value?.height ?? ROW_VIEWPORT_H : ROW_VIEWPORT_H
      let firstRow = 0
      let lastRow = totalRows
      if (totalRows * ROW_HEIGHT > viewportH + ROW_HEIGHT) {
        firstRow = Math.max(0, Math.floor(rowsScrollTop.value / ROW_HEIGHT) - ROW_OVERSCAN)
        lastRow = Math.min(totalRows, Math.ceil((rowsScrollTop.value + viewportH) / ROW_HEIGHT) + ROW_OVERSCAN)
      }
      const rowNodes = visibleRows.value.slice(firstRow, lastRow).map((row, i) => {
        const index = firstRow + i
        const rowSel = selected.value.has(row.id)
        const hovered = hoveredRow.value === row.id
        const strength = STRENGTH[row.strength]!
        /* Row/cell tints paint on non-blocking overlays (the GlideMenu
         * highlight pattern): a backgroundColor directly on the cells would
         * make them mouse-blocking hitboxes that cut the row's hover, and the
         * hover tint would oscillate. */
        const rowTint = rowSel ? mix(t.accent, t.surface, 93) : hovered ? t.hover : undefined
        const colselTint = (col: string): string | undefined =>
          prop.value === col ? mix(t.accent, t.surface, rowSel ? 90 : hovered ? 92 : 96) : undefined
        const tintOverlay = (color: string | undefined): VNode | null =>
          color ? (
            <div
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color, pointerEvents: "none" }}
            />
          ) : null
        return (
          <div
            key={row.id}
            testId={`records-row-${row.id}`}
            onMouseEnter={() => {
              hoveredRow.value = row.id
            }}
            onMouseLeave={() => {
              if (hoveredRow.value === row.id) hoveredRow.value = null
            }}
            style={{ position: "relative", display: "flex", height: ROW_HEIGHT, flexShrink: 0, borderBottomWidth: 1, borderColor: cellBorder }}
          >
            {tintOverlay(rowTint)}
            <div
              style={{
                ...cell(wCompany),
                position: "relative",
                paddingLeft: 6,
                gap: 4,
                overflow: "visible",
              }}
            >
              {tintOverlay(colselTint("Company"))}
              {hovered || rowSel ? (
                <Checkbox testId={`records-check-${row.id}`} checked={rowSel} onToggle={() => toggleRow(row.id)} />
              ) : (
                <div
                  style={{
                    display: "flex",
                    width: 24,
                    height: 24,
                    flexShrink: 0,
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: t.ink3,
                  }}
                >
                  {index + 1}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  width: 20,
                  height: 20,
                  flexShrink: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 6,
                  backgroundColor: t.field,
                  fontSize: 10,
                  fontWeight: 500,
                  color: t.ink2,
                  pointerEvents: "none",
                }}
              >
                {row.name.slice(0, 1).toUpperCase()}
              </div>
              <div
                testId={`records-name-${row.id}`}
                style={{
                  minWidth: 0,
                  flexGrow: 1,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: CELL_LINE,
                  color: t.ink,
                  ...(row.website ? { cursor: "pointer", hover: { color: t.accentInk } } : {}),
                }}
              >
                {row.name}
              </div>
            </div>
            <div style={{ ...cell(wCategories), position: "relative" }}>
              {tintOverlay(colselTint("Categories"))}
              {isCalc("Categories", index) ? (
                calcCell(t, pulseOn.value)
              ) : (
                tagRow(row.tags, wCategories - 16, t)
              )}
            </div>
            <div style={{ ...cell(wLast), position: "relative" }}>
              {tintOverlay(colselTint("Last interaction"))}
              {isCalc("Last interaction", index) ? (
                calcCell(t, pulseOn.value)
              ) : (
                <div
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    fontSize: 13,
                    fontWeight: 500,
                    lineHeight: CELL_LINE,
                    color: row.last === "No contact" ? t.ink3 : t.ink,
                  }}
                >
                  {row.last}
                </div>
              )}
            </div>
            <div style={{ ...cell(wStrength), position: "relative" }}>
              {tintOverlay(colselTint("Connection strength"))}
              {isCalc("Connection strength", index) ? (
                calcCell(t, pulseOn.value)
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden" }}>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      flexShrink: 0,
                      borderRadius: 4,
                      backgroundColor: t[strength.color],
                      pointerEvents: "none",
                    }}
                  />
                  <div
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      fontSize: 13,
                      fontWeight: 500,
                      lineHeight: CELL_LINE,
                      color: t.ink2,
                    }}
                  >
                    {strength.label}
                  </div>
                </div>
              )}
            </div>
            <div style={{ ...cell(wLinks), position: "relative" }}>
              {tintOverlay(colselTint("Links"))}
              {isCalc("Links", index) ? (
                calcCell(t, pulseOn.value)
              ) : row.website ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    minWidth: 0,
                    overflow: "hidden",
                    cursor: "pointer",
                    color: t.accentInk,
                    hover: { color: t.ink },
                  }}
                >
                  <div
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      fontSize: 13,
                      fontWeight: 500,
                      lineHeight: CELL_LINE,
                    }}
                  >
                    {row.website}
                  </div>
                  <Icon name="arrowUpRight" size={12} color={t.accentInk} />
                </div>
              ) : (
                <div style={{ fontSize: 13, fontWeight: 500, lineHeight: CELL_LINE, color: t.ink3 }}>—</div>
              )}
            </div>
            {aiShown ? (
              <motion.div
                key="ai"
                initial={{ width: 0 }}
                animate={{ width: aiState.value === "on" ? aiW : 0 }}
                transition={AI_REVEAL}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  height: ROW_HEIGHT,
                  flexShrink: 0,
                  paddingLeft: 8,
                  paddingRight: 8,
                  overflow: "hidden",
                  borderRightWidth: 1,
                  borderColor: cellBorder,
                }}
              >
                {tintOverlay(colselTint(AI_LABEL))}
                {aiCellContent(index)}
              </motion.div>
            ) : null}
            <div style={cell(wAction, true)} />
          </div>
        )
      })

      /* ── footer ───────────────────────────────────────────── */

      const footerRow = (
        <div key="footer" style={{ display: "flex", height: ROW_HEIGHT, flexShrink: 0, backgroundColor: t.inset }}>
          <div style={{ ...cell(wCompany), paddingLeft: 6, backgroundColor: t.inset }}>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <div style={{ marginRight: 3, fontSize: 14, fontWeight: 500, color: t.ink }}>{props.rows.length}</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: t.ink2 }}>count</div>
            </div>
          </div>
          <div style={{ ...cell(wCategories), backgroundColor: t.inset }}>
            <div
              testId="records-add-calculation"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: ROW_HEIGHT,
                fontSize: 14,
                fontWeight: 500,
                color: t.ink3,
                cursor: "pointer",
                hover: { color: t.ink },
              }}
            >
              <div style={{ display: "flex", width: 15, height: 15, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
                <Icon name="plus" size={15} color={t.ink3} />
              </div>
              Add calculation
            </div>
          </div>
          <div style={{ ...cell(wLast), backgroundColor: t.inset }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: t.ink3 }}>—</div>
          </div>
          <div style={{ ...cell(wStrength), backgroundColor: t.inset }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 4, backgroundColor: t.orange }} />
              <div style={{ fontSize: 14, fontWeight: 500, color: t.ink2 }}>{avgPercent}% average</div>
            </div>
          </div>
          <div style={{ ...cell(wLinks), backgroundColor: t.inset }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: t.ink3 }}>{linksCount} links</div>
          </div>
          {aiShown ? (
            <motion.div
              key="ai"
              initial={{ width: 0 }}
              animate={{ width: aiState.value === "on" ? aiW : 0 }}
              transition={AI_REVEAL}
              style={{
                display: "flex",
                alignItems: "center",
                height: ROW_HEIGHT,
                flexShrink: 0,
                paddingLeft: 8,
                paddingRight: 8,
                overflow: "hidden",
                borderRightWidth: 1,
                borderColor: cellBorder,
                backgroundColor: t.inset,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 500, color: aiDone.value ? t.ink2 : t.ink3 }}>
                {aiDone.value ? `${props.rows.length} filled` : "—"}
              </div>
            </motion.div>
          ) : null}
          <div style={{ ...cell(wAction, true), backgroundColor: t.inset }} />
        </div>
      )

      return (
        <div
          testId="records-root"
          ref={shellRef}
          style={{
            width: "100%",
            minWidth: 0,
            overflow: "hidden",
            backgroundColor: t.surface,
            ...(props.fill
              ? { display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, height: "100%" }
              : {
                  borderWidth: 1,
                  borderColor: t.line,
                  borderRadius: radius.card,
                  boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: "rgba(0, 0, 0, 0.06)" },
                }),
          }}
        >
          <div
            style={{
              display: "flex",
              height: ROW_HEIGHT,
              flexShrink: 0,
              borderBottomWidth: 1,
              borderColor: cellBorder,
              backgroundColor: t.surface,
            }}
          >
            {companyHeader}
            {headerCell({ key: "categories", col: "Categories", label: "Categories", icon: "typeSelectMulti", width: wCategories })}
            {headerCell({
              key: "last",
              col: "Last interaction",
              label: "Last interaction",
              icon: "typeDate",
              sortKey: "last",
              width: wLast,
            })}
            {headerCell({
              key: "strength",
              col: "Connection strength",
              label: "Connection strength",
              icon: "typeSelectSingle",
              sortKey: "strength",
              width: wStrength,
            })}
            {headerCell({ key: "links", col: "Links", label: "Links", icon: "typeUrl", width: wLinks })}
            {aiHeader}
            {actionHeader}
          </div>

          <div
            ref={rowsScrollRef}
            aria-label="Companies table. Scroll vertically to view all records."
            style={{
              overflowY: "scroll",
              ...(props.fill ? { flexGrow: 1, minHeight: 0 } : { maxHeight: ROW_VIEWPORT_H }),
            }}
          >
            {firstRow > 0 ? <div style={{ width: "100%", height: firstRow * ROW_HEIGHT, flexShrink: 0 }} /> : null}
            {rowNodes}
            {lastRow < totalRows ? <div style={{ width: "100%", height: (totalRows - lastRow) * ROW_HEIGHT, flexShrink: 0 }} /> : null}
          </div>

          {footerRow}
        </div>
      )
    }
  },
})
