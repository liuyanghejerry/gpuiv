/** Divider — GPUIV port of animal-island-vue's `Divider.vue`.
 *
 *  Ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT).
 *
 *  Fidelity notes (see issue #164):
 *  - The original paints every line type as a repeating CSS background —
 *    `linear-gradient` dashes for dashed-brown/hairline, inline-SVG waves for
 *    wave-yellow/squiggle, tiled with `background-repeat: repeat-x`. GPUIV has
 *    no background images, so each pattern is baked at module load into one
 *    wide SVG (exact original dash cadence, wave path, stroke widths and
 *    colours, same period) and painted by a single `<img>` clipped by
 *    `overflow: hidden`. Tiling stops at ~3.2k px where the original repeats
 *    forever.
 *  - `thin` is an exact port (1px solid #e8dec7).
 *  - icon mode repeats `<Icon>` + a 4×2 connecting line to fill the measured
 *    row; `useElementBounds` stands in for the original's ResizeObserver.
 *  - Colours missing from tokens.ts stay as literals from the original Less:
 *    #e8dec7 (thin), #d5c3a2 (hairline), #f5d04a (wave-yellow).
 */

import { computed, defineComponent, ref, type PropType } from "vue"
import { useElementBounds, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { colors } from "../tokens.js"
import { Icon, type IconName } from "./Icon.js"

export type DividerType = "dashed-brown" | "thin" | "hairline" | "wave-yellow" | "squiggle"
/** Same union as the original (`DividerIconName = IconName`). */
export type DividerIconName = IconName

/* Baked repeat tiles — each width is an exact multiple of the pattern period. */

const DASH_TILE_WIDTH = 3204 // 12px period × 267
const HAIRLINE_TILE_WIDTH = 3204 // 6px period × 534
const WAVE_TILE_WIDTH = 3200 // 40px period × 80
const SQUIGGLE_TILE_WIDTH = 3120 // 120px period × 26

function svgTile(width: number, height: number, body: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>${body}</svg>`,
  )}`
}

/** dashed-brown: 6px dash / 6px gap, 2px stroke centred in the 12px box. */
const DASHED_BROWN_TILE = svgTile(
  DASH_TILE_WIDTH,
  12,
  `<path d='M0 6 H${DASH_TILE_WIDTH}' fill='none' stroke='${colors.textDisabled}' stroke-width='2' stroke-dasharray='6 6'/>`,
)

/** hairline: 3px dash / 3px gap, 1px stroke. */
const HAIRLINE_TILE = svgTile(
  HAIRLINE_TILE_WIDTH,
  1,
  `<path d='M0 0.5 H${HAIRLINE_TILE_WIDTH}' fill='none' stroke='#d5c3a2' stroke-width='1' stroke-dasharray='3 3'/>`,
)

/** wave-yellow: the original 40px period ('M0 7 Q10 0 20 7 T40 7') chained
 *  with smooth T commands. */
function wavePath(width: number): string {
  let d = "M0 7 Q10 0 20 7"
  for (let x = 40; x <= width; x += 40) d += ` T${x} 7`
  return d
}

const WAVE_YELLOW_TILE = svgTile(
  WAVE_TILE_WIDTH,
  14,
  `<path d='${wavePath(WAVE_TILE_WIDTH)}' fill='none' stroke='#f5d04a' stroke-width='2.5' stroke-linecap='round'/>`,
)

/** squiggle: the original seamless 120px period
 *  ('M0 2.5 C 30 2.5, 30 7.5, 60 7.5 C 90 7.5, 90 2.5, 120 2.5'), offset per cycle. */
function squigglePath(width: number): string {
  let d = "M0 2.5"
  for (let x = 0; x < width; x += 120) {
    d += ` C ${x + 30} 2.5, ${x + 30} 7.5, ${x + 60} 7.5 C ${x + 90} 7.5, ${x + 90} 2.5, ${x + 120} 2.5`
  }
  return d
}

const SQUIGGLE_TILE = svgTile(
  SQUIGGLE_TILE_WIDTH,
  10,
  `<path d='${squigglePath(SQUIGGLE_TILE_WIDTH)}' fill='none' stroke='${colors.primary}' stroke-width='5' stroke-linecap='round'/>`,
)

const lineTypes: Record<Exclude<DividerType, "thin">, { src: string; height: number; tileWidth: number; center: boolean }> = {
  // dashed-brown tiles from the centre (background-position: center).
  "dashed-brown": { src: DASHED_BROWN_TILE, height: 12, tileWidth: DASH_TILE_WIDTH, center: true },
  hairline: { src: HAIRLINE_TILE, height: 1, tileWidth: HAIRLINE_TILE_WIDTH, center: false },
  "wave-yellow": { src: WAVE_YELLOW_TILE, height: 14, tileWidth: WAVE_TILE_WIDTH, center: false },
  squiggle: { src: SQUIGGLE_TILE, height: 10, tileWidth: SQUIGGLE_TILE_WIDTH, center: false },
}

export const Divider = defineComponent({
  name: "AnimalDivider",
  inheritAttrs: false,
  props: {
    type: { type: String as PropType<DividerType>, default: "dashed-brown" },
    icon: { type: String as PropType<DividerIconName>, default: undefined },
    iconSize: { type: Number, default: 24 },
    iconGap: { type: Number, default: 8 },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    // Only icon mode measures — the ref is attached on that branch alone, so
    // the bounds poll short-circuits on a null target for plain line types.
    const root = ref<HostNode | null>(null)
    const { bounds } = useElementBounds(root)

    const cycles = computed(() => {
      const width = bounds.value?.width ?? 0
      return Math.max(1, Math.floor(width / (props.iconSize + props.iconGap)))
    })

    return () => {
      const attrsStyle = attrs.style as StyleDesc | undefined

      if (props.icon) {
        const items = Array.from({ length: cycles.value }, (_, i) => i)
        return (
          <div
            {...attrs}
            ref={root}
            testId={props.testId}
            aria-hidden="true"
            style={{
              display: "flex",
              width: "100%",
              overflow: "hidden",
              alignItems: "center",
              minHeight: 20,
              ...attrsStyle,
            }}
          >
            {items.map((i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                <Icon name={props.icon} size={props.iconSize} />
                {i < items.length - 1 ? (
                  <div
                    style={{
                      width: props.iconGap,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <div style={{ width: 4, height: 2, backgroundColor: colors.textDisabled }} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )
      }

      const type = props.type
      if (type === "thin") {
        return (
          <div
            {...attrs}
            testId={props.testId}
            style={{ width: "100%", height: 1, backgroundColor: "#e8dec7", ...attrsStyle }}
          />
        )
      }

      const line = lineTypes[type]
      return (
        <div
          {...attrs}
          testId={props.testId}
          style={{
            display: "flex",
            width: "100%",
            height: line.height,
            overflow: "hidden",
            justifyContent: line.center ? "center" : "flex-start",
            ...attrsStyle,
          }}
        >
          <img src={line.src} style={{ width: line.tileWidth, height: line.height, flexShrink: 0 }} />
        </div>
      )
    }
  },
})

export default Divider
