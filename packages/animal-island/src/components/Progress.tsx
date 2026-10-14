/** Progress — GPUIV port of animal-island-vue's `Progress.vue`.
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - Fill width animation (`width: percent%` + CSS transition) → the track is
 *    fluid (`flex: 1`), so the port measures the painted track with
 *    `useElementBounds` and tweens a numeric pixel width on `motion.div`
 *    (`duration` prop, 0.6s default, cubic-bezier(0.4, 0, 0.2, 1); 0 renders
 *    a static div). Consequences: the fill appears one frame after the track
 *    (first measurement), and a track resize re-tweens the fill instead of
 *    snapping like CSS.
 *  - Inset track shadow (`box-shadow: inset 0 2px 4px …`) → dropped (GPUIV
 *    has no inset shadows); the 2px bordered cream track carries the shape.
 *  - `variant` is accepted for API parity: in the Vue source it only adds a
 *    class hook and the fill is always amber `rgb(255, 193, 7)`, so it has no
 *    visual effect here either.
 *  - Inside label (`position: absolute; right: 8px; top: 50%` + translate) →
 *    in-flow flex centering at the fill's / track's right end.
 *  - Label `text-shadow` and `letter-spacing` are dropped (unsupported).
 */

import { computed, defineComponent, ref, type PropType } from "vue"
import { motion, useElementBounds, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { colors, ease, fontSize, fonts, radius } from "../tokens.js"

export type ProgressSize = "small" | "middle" | "large"
export type ProgressInfoPosition = "inside" | "right" | "top"
/** In the Vue source these only add a class hook; the fill stays amber. */
export type ProgressVariant = "sweet-corner" | "forest-grove" | "starry-camp" | "coffee-break"

/** fill 末端留出文字宽度的阈值（避免 fill 太窄时文字外溢到 track 上被白色看不清） */
const INSIDE_MIN_FILL = 18

interface ProgressGeometry {
  height: number
  border: number
  insideFontSize: number
  insidePad: number
}

const geometry: Record<ProgressSize, ProgressGeometry> = {
  small: { height: 12, border: 1.5, insideFontSize: 9, insidePad: 4 },
  middle: { height: 20, border: 2, insideFontSize: 11, insidePad: 8 },
  large: { height: 28, border: 2, insideFontSize: 13, insidePad: 8 },
}

const FILL_COLOR = "rgb(255, 193, 7)"
const TRACK_BORDER = "#e8dcc8"

export const Progress = defineComponent({
  name: "AnimalProgress",
  inheritAttrs: false,
  props: {
    /** 当前百分比，0–100 */
    percent: { type: Number, required: true },
    size: { type: String as PropType<ProgressSize>, default: "middle" },
    showInfo: { type: Boolean, default: true },
    variant: { type: String as PropType<ProgressVariant>, default: "sweet-corner" },
    infoPosition: { type: String as PropType<ProgressInfoPosition>, default: "right" },
    infoFormat: { type: Function as PropType<(percent: number) => string>, default: undefined },
    /** 进度条 fill 宽度动画时长（秒），0 = 不动画 */
    duration: { type: Number, default: 0.6 },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    const trackRef = ref<HostNode | null>(null)
    const { bounds } = useElementBounds(trackRef)
    // The fill depends on track width; window-space position changes during
    // scrolling must not re-render or re-send its otherwise unchanged styles.
    const trackWidth = computed(() => bounds.value?.width ?? null)

    return () => {
      const g = geometry[props.size]
      const p = props.percent
      const safePercent = typeof p !== "number" || Number.isNaN(p) ? 0 : Math.max(0, Math.min(100, p))
      const renderedInfo = props.infoFormat ? props.infoFormat(safePercent) : `${Math.round(safePercent)}%`

      const isInside = props.showInfo && props.infoPosition === "inside"
      const infoInsideVisible = isInside && safePercent >= INSIDE_MIN_FILL

      // The fill needs pixels for the native tween; the track is fluid, so
      // measure it. Null until the first painted frame — no fill before that.
      const trackInnerWidth = trackWidth.value === null ? null : trackWidth.value - g.border * 2
      const fillWidth = trackInnerWidth === null ? 0 : Math.round((trackInnerWidth * safePercent) / 100)

      const fillStyle: StyleDesc = {
        height: "100%",
        flexShrink: 0,
        backgroundColor: FILL_COLOR,
        borderRadius: radius.pill,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingRight: infoInsideVisible ? g.insidePad : 0,
        fontSize: g.insideFontSize,
        fontWeight: 800,
        color: "#ffffff",
        whiteSpace: "nowrap",
        lineHeight: g.insideFontSize,
      }

      const fill =
        trackInnerWidth === null ? null : props.duration > 0 ? (
          <motion.div
            key="fill"
            initial={false}
            animate={{ width: fillWidth }}
            transition={{ duration: props.duration, ease }}
            style={fillStyle}
          >
            {infoInsideVisible ? <text>{renderedInfo}</text> : null}
          </motion.div>
        ) : (
          <div key="fill" style={{ ...fillStyle, width: fillWidth }}>
            {infoInsideVisible ? <text>{renderedInfo}</text> : null}
          </div>
        )

      const track = (
        <div
          ref={trackRef}
          style={{
            position: "relative",
            flexGrow: 1,
            flexShrink: 1,
            minWidth: 80,
            height: g.height,
            backgroundColor: colors.bg,
            borderWidth: g.border,
            borderColor: TRACK_BORDER,
            borderRadius: radius.pill,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
          }}
        >
          {fill}
          {isInside && !infoInsideVisible ? (
            <>
              <div style={{ flexGrow: 1 }} />
              <text
                style={{
                  fontSize: g.insideFontSize,
                  fontWeight: 800,
                  color: colors.warmSoft,
                  whiteSpace: "nowrap",
                  marginRight: g.insidePad,
                  lineHeight: g.insideFontSize,
                }}
              >
                {renderedInfo}
              </text>
            </>
          ) : null}
        </div>
      )

      const infoStyle: StyleDesc = {
        flexShrink: 0,
        fontSize: fontSize.base,
        fontWeight: 700,
        color: colors.warmSoft,
        whiteSpace: "nowrap",
        lineHeight: fontSize.base,
      }

      return (
        <div
          {...attrs}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(safePercent)}
          aria-valuetext={renderedInfo}
          testId={props.testId}
          style={{
            ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
            display: "flex",
            alignItems: "center",
            width: "100%",
            userSelect: "none",
            lineHeight: fontSize.base,
            ...(attrs.style as StyleDesc | undefined),
          }}
        >
          {props.infoPosition === "top" ? (
            <div
              style={{
                flexGrow: 1,
                flexShrink: 1,
                minWidth: 0,
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {props.showInfo ? (
                <div style={{ ...infoStyle, alignSelf: "flex-end" }}>
                  <text>{renderedInfo}</text>
                </div>
              ) : null}
              {track}
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                flexGrow: 1,
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              {track}
              {props.showInfo && props.infoPosition === "right" ? (
                <div style={{ ...infoStyle, minWidth: 44, display: "flex", justifyContent: "flex-end" }}>
                  <text>{renderedInfo}</text>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )
    }
  },
})

export default Progress
