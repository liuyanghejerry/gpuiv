/** RECOMMENDATION CARD — the card holds its shape. Pressing "Alternatives"
 *  opens a drawer listing the other options; picking one promotes it to the
 *  recommendation. The primary action confirms.
 *
 *  Ported from beautiful-ui `components/primitives/RecommendationCard.tsx`.
 *  Platform degradations:
 *  - The web `body` is a `ReactNode` with inline `<EntityChip>`/`<ValuePill>`
 *    inside flowing prose. GPUIV has no inline flow, so `body` is a typed
 *    segment array rendered as a `flexWrap: "wrap"` row: short segments sit
 *    on one line like inline elements; long text segments wrap as blocks
 *    instead of mid-sentence.
 *  - Content switching fade: the CSS `fade-in` keyframe re-run via `key`
 *    becomes a keyed `motion.div` (opacity 0 → 1, remounts on key change).
 *  - The `grid-template-rows: 0fr → 1fr` drawer cannot measure auto height in
 *    GPUIV. The drawer content IS knowable — a fixed header plus a fixed
 *    row height × row count — so `height` is tweened with `motion.div`
 *    (0 ↔ computed) alongside the opacity fade, same 300ms / ease.link as
 *    the source. Rows and the header pin their height to the constants
 *    below so the tween target always matches the laid-out content.
 *  - The Meter bars' `transition-colors` is dropped (colour is not an
 *    animatable property in GPUIV).
 *  - Option `tone` was a CSS variable string (`var(--green)`); there are no
 *    CSS variables and dark mode swaps token values, so it is a token name
 *    (`RecommendationTone`) resolved against the live theme at render time.
 *  - The original's unused `variant?: string` prop is dropped.
 *  - The footer drops its `bg-surface` (identical to the card's fill): GPUI's
 *    `overflow_hidden` content mask is a plain rect, it does not follow the
 *    card's corner radii, so a filled child hugging the bottom edge paints
 *    into the rounded corner crescents. With no fill of its own the footer
 *    leaves the corners to the card, and the drawer supplies the surface
 *    fill while open. Rule of thumb: never give a bottom-flush child its own
 *    background inside a rounded `overflow: "hidden"` card.
 */

import { computed, defineComponent, ref, type PropType } from "vue"
import { motion } from "@gpuiv/vue"
import { ease, radius } from "../tokens.js"
import { useTheme } from "../theme.js"
import { Button, EntityChip, ValuePill, type ButtonVariant, type ValuePillTone } from "../atoms/index.js"

export type RecommendationTone = "green" | "orange" | "neutral"

/** One piece of the recommendation prose: a text run, an inline entity
 *  chip, an inline value pill, or an emphasised text run. */
export type RecommendationBodySegment =
  | string
  | { chip: string }
  | { pill: string; tone?: ValuePillTone }
  | { strong: string }

export interface RecommendationOption {
  key: string
  body: RecommendationBodySegment[]
  short: string
  /** 0–3 filled meter bars. */
  signal: number
  tone: RecommendationTone
  label: string
  cta: string
  ctaVariant: ButtonVariant
}

export interface RecommendationLabels {
  title: string
  alternatives: string
  otherOptions: string
  accepted: string
}

const DEFAULT_LABELS: RecommendationLabels = {
  title: "Want me to place this restock order?",
  alternatives: "Alternatives",
  otherOptions: "Other options",
  accepted: "Accepted",
}

const DEFAULT_OPTIONS: RecommendationOption[] = [
  {
    key: "high",
    body: ["Reorder waffle cones from", { chip: "Cone King" }, "with lead time", { pill: "7 days", tone: "green" }],
    short: "Reorder from Cone King · 7-day lead",
    signal: 3,
    tone: "green",
    label: "High confidence",
    cta: "Accept",
    ctaVariant: "accent",
  },
  {
    key: "review",
    body: ["Switch vanilla to", { pill: "Vanilla Madagascar" }, "for peak season."],
    short: "Switch to Vanilla Madagascar",
    signal: 2,
    tone: "orange",
    label: "Needs review",
    cta: "Configure",
    ctaVariant: "primary",
  },
  {
    key: "none",
    body: ["Fall back to a", { strong: "full restock" }, "across every SKU."],
    short: "Full restock across every SKU",
    signal: 0,
    tone: "neutral",
    label: "No signal",
    cta: "Accept full restock",
    ctaVariant: "primary",
  },
]

/* Drawer geometry — the tween target. Every laid-out row/header pins its
 * height to these constants so the animated height always fits exactly. */
const DRAWER_BORDER = 1
const DRAWER_PAD_Y = 8
const DRAWER_HEADER_HEIGHT = 19
const DRAWER_ROW_HEIGHT = 28

export const RecommendationCard = defineComponent({
  name: "BuiRecommendationCard",
  props: {
    options: { type: Array as PropType<RecommendationOption[]>, default: () => DEFAULT_OPTIONS },
    labels: { type: Object as PropType<Partial<RecommendationLabels>>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    const copy = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }))
    const selected = ref(0)
    const open = ref(false)
    const accepted = ref(false)

    const drawerHeight = computed(
      () => DRAWER_BORDER + DRAWER_PAD_Y * 2 + DRAWER_HEADER_HEIGHT + Math.max(0, props.options.length - 1) * DRAWER_ROW_HEIGHT,
    )

    const renderMeter = (signal: number, toneColor: string, inactive: string) => (
      <div style={{ display: "flex", alignItems: "end", gap: 2 }}>
        {[0, 1, 2].map((bar) => (
          <div
            key={bar}
            style={{ width: 4, height: 10, borderRadius: 2, backgroundColor: bar < signal ? toneColor : inactive }}
          />
        ))}
      </div>
    )

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const toneColor: Record<RecommendationTone, string> = {
        green: t.green,
        orange: t.orange,
        neutral: t.ink3,
      }
      const index = Math.max(0, Math.min(selected.value, props.options.length - 1))
      const active = props.options[index]
      if (!active) return <div />
      const others = props.options.map((o, i) => ({ o, i })).filter(({ i }) => i !== index)

      const renderSegment = (seg: RecommendationBodySegment, i: number) => {
        if (typeof seg === "string") {
          return (
            <div key={i} style={{ fontSize: 13, lineHeight: 21, color: t.ink2 }}>
              {seg}
            </div>
          )
        }
        if ("chip" in seg) return <EntityChip key={i} name={seg.chip} />
        if ("pill" in seg) {
          return (
            <ValuePill key={i} tone={seg.tone}>
              {seg.pill}
            </ValuePill>
          )
        }
        return (
          <div key={i} style={{ fontSize: 13, lineHeight: 21, fontWeight: 500, color: t.ink }}>
            {seg.strong}
          </div>
        )
      }

      return (
        <div
          style={{
            width: "100%",
            maxWidth: 380,
            overflow: "hidden",
            borderRadius: radius.card,
            backgroundColor: t.surface,
            ...shadows.card,
          }}
        >
          {/* head — title + the active recommendation body */}
          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: t.ink }}>{copy.value.title}</div>
            <motion.div
              key={active.key}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18, ease: ease.outStrong }}
              style={{
                marginTop: 6,
                minHeight: 48,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                columnGap: 4,
                rowGap: 2,
              }}
            >
              {active.body.map(renderSegment)}
            </motion.div>
          </div>

          {/* alternatives drawer — a distinctly new section of the card */}
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: open.value ? drawerHeight.value : 0, opacity: open.value ? 1 : 0 }}
            transition={{ duration: 0.3, ease: ease.link }}
            style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
          >
            {/* flexShrink 0: keep natural height while the parent collapses,
                so the clip reveals instead of squashing the rows. */}
            <div
              style={{
                flexShrink: 0,
                borderTopWidth: 1,
                borderColor: t.line,
                backgroundColor: t.surface,
                paddingLeft: 8,
                paddingRight: 8,
                paddingTop: DRAWER_PAD_Y,
                paddingBottom: DRAWER_PAD_Y,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "end",
                  height: DRAWER_HEADER_HEIGHT,
                  paddingLeft: 6,
                  paddingRight: 6,
                  paddingBottom: 4,
                  fontSize: 11,
                  fontWeight: 500,
                  lineHeight: 15,
                  color: t.ink3,
                }}
              >
                {copy.value.otherOptions}
              </div>
              {others.map(({ o, i }) => (
                <div
                  key={o.key}
                  role="button"
                  onClick={() => {
                    selected.value = i
                    accepted.value = false
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    height: DRAWER_ROW_HEIGHT,
                    borderRadius: radius.control,
                    paddingLeft: 6,
                    paddingRight: 6,
                    cursor: "pointer",
                    userSelect: "none",
                    hover: { backgroundColor: t.hover },
                  }}
                >
                  {renderMeter(o.signal, toneColor[o.tone], t.lineStrong)}
                  <div
                    style={{
                      flexGrow: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      fontSize: 12.5,
                      color: t.ink,
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {o.short}
                  </div>
                  <div style={{ flexShrink: 0, fontSize: 11, color: t.ink3 }}>{o.label}</div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* footer — no background of its own: GPUI's overflow clip is a
              rect, so a fill here would bleed into the card's rounded
              corners (see the header note). The card already paints surface. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {renderMeter(active.signal, toneColor[active.tone], t.lineStrong)}
              <div style={{ fontSize: 12.5, fontWeight: 500, color: t.ink2 }}>{active.label}</div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: -2 }}>
              <Button
                variant="secondary"
                size="sm"
                aria-expanded={open.value}
                style={{ paddingLeft: 10, paddingRight: 10, fontSize: 12.5 }}
                // Button has no declared emits; onClick falls through attrs to
                // its root div at runtime. Spread form: TS excess-property
                // checking does not apply to spread attributes.
                {...{ onClick: () => (open.value = !open.value) }}
              >
                {copy.value.alternatives}
              </Button>
              <Button
                variant={accepted.value ? "success" : active.ctaVariant}
                size="sm"
                style={{ fontSize: 12.5 }}
                {...{ onClick: () => (accepted.value = true) }}
              >
                {accepted.value ? copy.value.accepted : active.cta}
              </Button>
            </div>
          </div>
        </div>
      )
    }
  },
})
