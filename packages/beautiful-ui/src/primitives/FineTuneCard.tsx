/** FINE-TUNE CARD — compact interactive inspector: a segmented layout
 *  switch, scrub-able number fields, and a type menu.
 *
 *  Ported from beautiful-ui `components/primitives/FineTuneCard.tsx`.
 *
 *  Number fields scrub: hover the label for an ↔ cursor and drag to adjust,
 *  use ↑/↓/←/→ (⇧ for ×10) when the handle is focused, or type directly.
 *  The segmented control's raised thumb glides to the active segment; the
 *  header flips from an "Adjust" hint to a green "Edited" once anything is
 *  touched.
 *
 *  Platform degradations vs the web original:
 *
 *  - The thumb's `transform: translateX(seg * 100%)` (300ms
 *    cubic-bezier(0.23,1,0.32,1)) becomes a `motion.div` `left`/`width`
 *    tween in pixels: the track is measured with `useElementBounds`
 *    (painted, window-space) and split into equal segments. Until the first
 *    measurement lands (one poll, ≤100ms) the thumb is not rendered; it then
 *    mounts at the active segment with no entrance tween.
 *  - The header "Adjust" shimmer (`background-clip: text` + an animated
 *    gradient sweep, 1.4s) has no GPUIV equivalent — the label is static
 *    `accent`-coloured text.
 *  - The "Edited" badge `pop-in` (opacity + scale 0.95 → 1, 250ms) becomes an
 *    opacity-only `motion.div` fade (no scale in GPUIV), same duration and
 *    `ease.outStrong` curve.
 *  - The type menu's `pop-in` (scale from `transform-origin: bottom right`,
 *    200ms) becomes an opacity + height `motion.div` tween: anchored
 *    top/end, the menu grows upward from the button's right edge as its
 *    height animates, matching the origin. The menu renders through a raw
 *    `<anchored deferred>` layer (per the repo's overlay rules) whose own
 *    style carries the surface fill — `FloatingLayer` never forwards a fill
 *    to the `anchored` element, and the adapter then paints its #1A1A1A
 *    fallback behind the rounded menu.
 *  - The menu chevron's `rotate(180deg)` transition becomes an instant
 *    chevronDown ↔ chevronUp glyph swap (no rotate in GPUIV).
 *  - The scrub field's active ring (`box-shadow: 0 0 0 1px accent`) becomes a
 *    permanent 1px border whose colour swaps between `accent` and fully
 *    transparent `accent` — the constant border avoids a 1px layout shift.
 *    The field's 200ms background/box-shadow transition and the segment
 *    buttons' `transition-colors` swap instantly (no colour transitions
 *    outside motion).
 *  - The selected menu row's `bg-field group-hover/glide-menu:bg-transparent`
 *    rule is replicated by tracking pointer hover on the menu's padding
 *    wrapper (GlideMenuRoot's typed attrs accept only `style`).
 *  - Scrubbing uses GPUIV's automatic pointer capture (mouseDown + mouseMove
 *    on the same node, like HTML `setPointerCapture`) with the original's
 *    math: `(dx / 2) * step`, rounded and clamped.
 *  - `tabular-nums` on the numeric input is dropped (no
 *    font-feature-settings); `touch-action: none` on the handle is dropped
 *    (no touch-pan conflict on desktop GPUIV).
 *  - `<label>`/`<button>` semantics and the slider's `aria-valuenow/min/max`
 *    reduce to `role`, `aria-label`, `aria-valuetext` and `tabIndex`
 *    passthroughs — there is no DOM accessibility tree in GPUIV;
 *    `focus-visible` outlines are dropped. Buttons keep keyboard parity via
 *    tabIndex + Enter/Space.
 */

import { computed, defineComponent, h, ref, type PropType } from "vue"
import { motion, useElementBounds, type EventPayload, type HostNode } from "@gpuiv/vue"

import { ease, radius } from "../tokens.js"
import { useTheme } from "../theme.js"
import { withAlpha } from "../colors.js"
import { Icon } from "../atoms/Icon.js"
import { GlideMenuItem, GlideMenuRoot } from "../atoms/GlideMenu.js"

/** A single scrub-able number property. `value` is the initial/default value. */
export interface FineTuneField {
  key: string
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
}

/** Prominent copy strings on the card. */
export interface FineTuneCardLabels {
  title: string
  layout: string
  type: string
  placeholder: string
  adjust: string
  edited: string
}

/** The editable state emitted by `onChange`. */
export interface FineTuneState {
  segment: number
  values: Record<string, number>
  type: string
}

const FIELDS: FineTuneField[] = [
  { key: "width", label: "W", value: 324, min: 40, max: 999 },
  { key: "height", label: "H", value: 96, min: 24, max: 999 },
  { key: "radius", label: "Radius", value: 28, min: 0, max: 64 },
  { key: "opacity", label: "Opacity", value: 100, min: 0, max: 100, suffix: "%" },
]

const OPTIONS = ["Seasonal", "Classic", "Limited"]

const DEFAULT_LABELS: FineTuneCardLabels = {
  title: "Flavor card",
  layout: "Layout",
  type: "Type",
  placeholder: "Select type",
  adjust: "Adjust",
  edited: "Edited",
}

const SEGMENTS = ["row", "col", "grid"] as const

/** Row height of one option in the type menu (the original's `h-6.5`). */
const MENU_ROW_HEIGHT = 26

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size))
  return rows
}

/* A scrub-able number field: drag the label horizontally, arrow keys when
 * focused, or type into the input. */
const ScrubField = defineComponent({
  name: "BuiFineTuneScrubField",
  props: {
    label: { type: String, required: true },
    value: { type: Number, required: true },
    min: { type: Number, required: true },
    max: { type: Number, required: true },
    step: { type: Number, default: 1 },
    suffix: { type: String, default: "" },
    active: { type: Boolean, default: false },
    testId: { type: String, default: undefined },
    onChange: { type: Function as PropType<(value: number) => void>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    const clamp = (v: number) => Math.min(props.max, Math.max(props.min, Math.round(v)))

    /* Scrub drag — armed on mousedown and sustained by GPUIV's automatic
     * pointer capture (the handle listens for both mouseDown and mouseMove,
     * so moves keep arriving after the pointer leaves the hitbox). */
    let drag: { x: number; value: number } | null = null
    const onMouseDown = (event: EventPayload) => {
      if ((event.button ?? 0) !== 0) return
      drag = { x: event.x ?? 0, value: props.value }
    }
    const onMouseMove = (event: EventPayload) => {
      if (drag === null) return
      props.onChange?.(clamp(drag.value + (((event.x ?? 0) - drag.x) / 2) * props.step))
    }
    const onMouseUp = () => {
      drag = null
    }
    const onKeyDown = (event: EventPayload) => {
      const mult = event.modifiers?.shift ? 10 : 1
      if (event.key === "up" || event.key === "right") props.onChange?.(clamp(props.value + props.step * mult))
      else if (event.key === "down" || event.key === "left") props.onChange?.(clamp(props.value - props.step * mult))
    }
    const onInput = (event: EventPayload) => {
      const n = Number((event.value ?? "").replace(/[^\d-]/g, ""))
      if (!Number.isNaN(n)) props.onChange?.(clamp(n))
    }

    return () => {
      const t = theme.tokens.value
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexGrow: 1,
            minWidth: 0,
            height: 26,
            gap: 4,
            paddingTop: 4,
            paddingBottom: 4,
            paddingRight: 4,
            paddingLeft: 2,
            borderRadius: radius.chip,
            borderWidth: 1,
            borderColor: props.active ? t.accent : withAlpha(t.accent, 0),
            backgroundColor: props.active ? t.accentTint : t.field,
          }}
        >
          {/* scrub handle */}
          <div
            role="slider"
            aria-label={props.label}
            aria-valuetext={String(props.value)}
            tabIndex={0}
            testId={props.testId}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onKeyDown={onKeyDown}
            style={{
              display: "flex",
              alignItems: "center",
              alignSelf: "stretch",
              flexShrink: 0,
              paddingLeft: 2,
              paddingRight: 2,
              borderRadius: 4,
              cursor: "ew-resize",
              userSelect: "none",
              fontSize: 12,
              color: t.ink3,
              hover: { color: t.ink2 },
            }}
          >
            {props.label}
          </div>
          <input
            value={String(props.value)}
            aria-label={`${props.label} value`}
            style={{ minWidth: 0, flexGrow: 1, height: 18, fontSize: 12, color: t.ink }}
            onChange={onInput}
          />
          {props.suffix !== "" && (
            <div style={{ flexShrink: 0, paddingRight: 2, fontSize: 11.5, color: t.ink3 }}>{props.suffix}</div>
          )}
        </div>
      )
    }
  },
})

export const FineTuneCard = defineComponent({
  name: "BuiFineTuneCard",
  props: {
    /** Accepted for gallery/registry parity; not used by this card. */
    variant: { type: String, default: undefined },
    /** The scrub-able properties shown in the layout grid (rendered in pairs). */
    fields: { type: Array as PropType<FineTuneField[]>, default: () => FIELDS },
    /** Options offered in the Type menu. */
    options: { type: Array as PropType<string[]>, default: () => OPTIONS },
    /** Prominent copy strings. */
    labels: { type: Object as PropType<Partial<FineTuneCardLabels>>, default: undefined },
    /** Called with the full editable state whenever the user edits it. */
    onChange: { type: Function as PropType<(state: FineTuneState) => void>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    const copy = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }))

    const seg = ref(0)
    const values = ref<Record<string, number>>(Object.fromEntries(props.fields.map((f) => [f.key, f.value])))
    const menuOpen = ref(false)
    /** null = the menu has never been chosen from; the placeholder shows. */
    const typeSelection = ref<string | null>(null)
    const currentType = computed(() => typeSelection.value ?? copy.value.placeholder)

    const emitChange = () => {
      props.onChange?.({ segment: seg.value, values: values.value, type: currentType.value })
    }
    const selectSeg = (i: number) => {
      seg.value = i
      emitChange()
    }
    const setValue = (key: string, v: number) => {
      values.value = { ...values.value, [key]: v }
      emitChange()
    }
    const selectType = (value: string) => {
      typeSelection.value = value
      menuOpen.value = false
      emitChange()
    }

    const changed = computed(() => props.fields.some((f) => values.value[f.key] !== f.value))
    const done = computed(() => seg.value !== 0 || changed.value || typeSelection.value !== null)

    /* Segmented-control thumb: the track is measured once painted and split
     * into equal segments; the thumb tweens `left`/`width` between them. */
    const trackRef = ref<HostNode | null>(null)
    const track = useElementBounds(trackRef)
    /* Width-only, so page scrolling (a pure translation) does not re-render
     * the card on every bounds poll tick. */
    const trackWidthRef = computed(() => track.bounds.value?.width ?? null)

    /* The selected menu row keeps its `field` background until the pointer
     * enters the menu — the original's `group-hover/glide-menu:bg-transparent`. */
    const menuHover = ref(false)

    /** The segment glyphs: 6px bordered squares in row / column / grid order. */
    const segmentIcon = (kind: string, color: string) => {
      const dot = {
        width: 6,
        height: 6,
        borderRadius: 2,
        borderWidth: 1.2,
        borderColor: color,
      } as const
      if (kind === "row")
        return (
          <div style={{ display: "flex", gap: 2 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={dot} />
            ))}
          </div>
        )
      if (kind === "col")
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {[0, 1].map((i) => (
              <div key={i} style={dot} />
            ))}
          </div>
        )
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", gap: 2 }}>
            {[0, 1].map((i) => (
              <div key={i} style={dot} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            {[2, 3].map((i) => (
              <div key={i} style={dot} />
            ))}
          </div>
        </div>
      )
    }

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const trackWidth = trackWidthRef.value
      const thumbWidth = trackWidth !== null ? (trackWidth - 4) / SEGMENTS.length : 0
      const menuHeight = 8 + props.options.length * MENU_ROW_HEIGHT + Math.max(props.options.length - 1, 0)

      return (
        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 240,
            borderRadius: radius.card,
            backgroundColor: t.surface,
            ...shadows.raised,
          }}
        >
          {/* header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 10,
              paddingBottom: 10,
              paddingLeft: 12,
              paddingRight: 12,
              borderBottomWidth: 1,
              borderColor: t.line,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: t.ink }}>{copy.value.title}</div>
            {done.value ? (
              <motion.div
                key="edited"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, ease: ease.outStrong }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  color: t.green,
                }}
              >
                <Icon name="checkBold" size={10} color={t.green} />
                {copy.value.edited}
              </motion.div>
            ) : (
              <div key="adjust" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 18,
                    height: 18,
                    borderRadius: 5,
                    borderWidth: 1,
                    borderColor: withAlpha(t.accent, 0.3),
                    backgroundColor: t.accentTint,
                  }}
                >
                  <Icon name="sparkle" size={9} color={t.accent} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 500, color: t.accent }}>{copy.value.adjust}</div>
              </div>
            )}
          </div>

          {/* layout section */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 12,
              borderBottomWidth: 1,
              borderColor: t.line,
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 500, color: t.ink }}>{copy.value.layout}</div>
            {/* segmented control: gray track, raised gliding thumb */}
            <div
              ref={trackRef}
              style={{
                position: "relative",
                display: "flex",
                borderRadius: radius.control,
                backgroundColor: t.field,
                padding: 2,
              }}
            >
              {trackWidth !== null && (
                <motion.div
                  animate={{ left: 2 + seg.value * thumbWidth, width: thumbWidth }}
                  transition={{ duration: 0.3, ease: ease.outStrong }}
                  style={{
                    position: "absolute",
                    top: 2,
                    height: 24,
                    borderRadius: 6,
                    backgroundColor: t.surface,
                    pointerEvents: "none",
                    ...shadows.btn,
                  }}
                />
              )}
              {SEGMENTS.map((s, i) => (
                <div
                  key={s}
                  role="button"
                  aria-label={`${s} layout`}
                  aria-selected={i === seg.value}
                  tabIndex={0}
                  testId={`fine-tune-segment-${s}`}
                  onClick={() => selectSeg(i)}
                  onKeyDown={(event: EventPayload) => {
                    if (event.key === "enter" || event.key === "space") selectSeg(i)
                  }}
                  style={{
                    position: "relative",
                    display: "flex",
                    flexGrow: 1,
                    alignItems: "center",
                    justifyContent: "center",
                    height: 24,
                    cursor: "pointer",
                  }}
                >
                  {segmentIcon(s, i === seg.value ? t.accent : t.ink3)}
                </div>
              ))}
            </div>
            {chunk(props.fields, 2).map((pair, ri) => (
              <div key={`pair-${ri}`} style={{ display: "flex", gap: 8, minWidth: 0 }}>
                {pair.map((f) => (
                  <ScrubField
                    key={f.key}
                    label={f.label}
                    value={values.value[f.key] ?? f.value}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    suffix={f.suffix}
                    active={(values.value[f.key] ?? f.value) !== f.value}
                    testId={`fine-tune-scrub-${f.key}`}
                    onChange={(v) => setValue(f.key, v)}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* interaction section */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 10,
            }}
          >
            <div style={{ fontSize: 12, color: t.ink3 }}>{copy.value.type}</div>
            <div style={{ position: "relative", width: 120, marginRight: -2 }}>
              <div
                role="button"
                aria-expanded={menuOpen.value}
                tabIndex={0}
                testId="fine-tune-type-button"
                onClick={() => {
                  menuOpen.value = !menuOpen.value
                }}
                onKeyDown={(event: EventPayload) => {
                  if (event.key === "enter" || event.key === "space") menuOpen.value = !menuOpen.value
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  height: 26,
                  paddingLeft: 8,
                  paddingRight: 4,
                  borderRadius: radius.chip,
                  backgroundColor: t.inset,
                  cursor: "pointer",
                  borderWidth: 1,
                  borderColor: menuOpen.value ? t.accent : t.line,
                }}
              >
                <div style={{ fontSize: 12, color: typeSelection.value !== null ? t.ink : t.ink3 }}>{currentType.value}</div>
                <Icon name={menuOpen.value ? "chevronUp" : "chevronDown"} size={11} color={t.ink3} />
              </div>

              {menuOpen.value &&
                /* A raw `<anchored deferred>` layer, styled directly:
                 * FloatingLayer never forwards a fill to the `anchored`
                 * element itself, whose adapter then paints its #1A1A1A
                 * fallback behind the rounded menu (visible in the corner
                 * cutouts). Styling the anchored element skips the fallback
                 * and puts the radius on the layer that owns the fill. */
                h(
                  "anchored",
                  {
                    side: "top",
                    align: "end",
                    gap: 6,
                    offset: { x: 0, y: 0 },
                    fit: "snap",
                    snapMargin: 8,
                    deferred: true,
                    priority: 1,
                    occlude: true,
                    style: {
                      width: 120,
                      borderRadius: 10,
                      backgroundColor: t.surface,
                      ...shadows.raised,
                    },
                  },
                  [
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: menuHeight }}
                      transition={{ duration: 0.2, ease: ease.outStrong }}
                      style={{ overflow: "hidden" }}
                    >
                      {/* Hover tracking lives on this padding wrapper:
                       *  GlideMenuRoot's attrs typing accepts only `style`. */}
                      <div
                        style={{ padding: 4 }}
                        onMouseEnter={() => {
                          menuHover.value = true
                        }}
                        onMouseLeave={() => {
                          menuHover.value = false
                        }}
                      >
                        <GlideMenuRoot style={{ gap: 1 }}>
                          {props.options.map((item) =>
                            h(
                              GlideMenuItem,
                              {
                                key: item,
                                testId: `fine-tune-type-option-${item}`,
                                onClick: () => selectType(item),
                                style: {
                                  display: "flex",
                                  alignItems: "center",
                                  width: "100%",
                                  height: MENU_ROW_HEIGHT,
                                  paddingLeft: 8,
                                  paddingRight: 8,
                                  borderRadius: 6,
                                  fontSize: 12.5,
                                  color: t.ink,
                                  cursor: "pointer",
                                  backgroundColor:
                                    item === currentType.value && !menuHover.value ? t.field : undefined,
                                },
                              },
                              () => item,
                            ),
                          )}
                        </GlideMenuRoot>
                      </div>
                    </motion.div>,
                  ],
                )}
            </div>
          </div>
        </div>
      )
    }
  },
})
