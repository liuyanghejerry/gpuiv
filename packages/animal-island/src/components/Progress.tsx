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
 *  - React's optional `variant` paints its bundled scene at full track width
 *    inside the animated clipping fill, revealing its left edge. No variant
 *    paints React's three-stop teal ramp, or its lighter completed ramp when
 *    rounded aria-valuenow reaches 100. Measured SVG decoration keeps the
 *    original 14px dotted track and its rounded edges. Track heights match
 *    React's 14/24/32px sizes; images never intercept pointer or wheel input.
 *  - Inside label (`position: absolute; right: 8px; top: 50%` + translate) →
 *    in-flow flex centering at the fill's / track's right end.
 *  - Label `text-shadow` and `letter-spacing` are dropped (unsupported).
 */

import { computed, defineComponent, ref, type PropType, type VNodeChild } from "vue"
import { motion, useElementBounds, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { colors, ease, fontSize, fonts, radius } from "../tokens.js"
import { coffeeBreakScene, forestGroveScene, starryCampScene, sweetCornerScene } from "../scene.js"
import { ProgressFillDecoration, ProgressTrackDecoration } from "./progress-decoration.js"

export type ProgressSize = "small" | "middle" | "large"
export type ProgressInfoPosition = "inside" | "right" | "top"
export type ProgressVariant = "sweet-corner" | "forest-grove" | "starry-camp" | "coffee-break"
const sceneByVariant: Record<ProgressVariant, string> = { "sweet-corner": sweetCornerScene, "forest-grove": forestGroveScene, "starry-camp": starryCampScene, "coffee-break": coffeeBreakScene }

/** fill 末端留出文字宽度的阈值（避免 fill 太窄时文字外溢到 track 上被白色看不清） */
const INSIDE_MIN_FILL = 18

interface ProgressGeometry {
  height: number
  border: number
  insideFontSize: number
  insidePad: number
}

const geometry: Record<ProgressSize, ProgressGeometry> = {
  small: { height: 14, border: 2, insideFontSize: 9, insidePad: 4 },
  middle: { height: 24, border: 2, insideFontSize: 11, insidePad: 8 },
  large: { height: 32, border: 2, insideFontSize: 13, insidePad: 8 },
}

const FILL_COLOR = "#19c8b9"
const TRACK_BORDER = "#e2d6bd"

export const Progress = defineComponent({
  name: "AnimalProgress",
  inheritAttrs: false,
  props: {
    /** 当前百分比，0–100 */
    percent: { type: Number, required: true },
    size: { type: String as PropType<ProgressSize>, default: "middle" },
    showInfo: { type: Boolean, default: true },
    variant: { type: String as PropType<ProgressVariant>, default: undefined },
    infoPosition: { type: String as PropType<ProgressInfoPosition>, default: "right" },
    infoFormat: { type: Function as PropType<(percent: number) => VNodeChild>, default: undefined },
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
      const info = () => typeof renderedInfo === "string" || typeof renderedInfo === "number" ? <text>{String(renderedInfo)}</text> : renderedInfo

      const isInside = props.showInfo && props.infoPosition === "inside"
      const infoInsideVisible = isInside && safePercent >= INSIDE_MIN_FILL

      // The fill needs pixels for the native tween; the track is fluid, so
      // measure it. Null until the first painted frame — no fill before that.
      const trackInnerWidth = trackWidth.value === null ? null : Math.max(0, trackWidth.value - g.border * 2)
      const trackInnerHeight = g.height - g.border * 2
      const fillWidth = trackInnerWidth === null ? 0 : Math.round((trackInnerWidth * safePercent) / 100)

      const fillStyle: StyleDesc = {
        position: "relative",
        height: "100%",
        flexShrink: 0,
        ...(props.variant ? {} : { backgroundColor: FILL_COLOR }),
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

      const fillChildren = () => <>
        {props.variant && trackInnerWidth !== null ? <img src={sceneByVariant[props.variant]} objectFit="fill" style={{ position: "absolute", top: 0, left: 0, width: trackInnerWidth, height: trackInnerWidth * 9 / 16, pointerEvents: "none" }} />
          : <ProgressFillDecoration completed={Math.round(safePercent) === 100} height={trackInnerHeight}
            testId={props.testId ? `${props.testId}-fill-decoration` : undefined} />}
        {infoInsideVisible ? <div style={{ position: "relative", pointerEvents: "none" }}>{info()}</div> : null}
      </>

      const fill =
        trackInnerWidth === null ? null : props.duration > 0 ? (
          <motion.div
            key="fill"
            initial={false}
            animate={{ width: fillWidth }}
            transition={{ duration: props.duration, ease }}
            style={fillStyle}
          >
            {fillChildren}
          </motion.div>
        ) : (
          <div key="fill" style={{ ...fillStyle, width: fillWidth }}>
            {fillChildren()}
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
          {trackInnerWidth !== null ? <ProgressTrackDecoration width={trackInnerWidth} height={trackInnerHeight}
            testId={props.testId ? `${props.testId}-track-decoration` : undefined} /> : null}
          {fill}
          {isInside && !infoInsideVisible ? (
            <>
              <div style={{ flexGrow: 1 }} />
              <div
                style={{
                  fontSize: g.insideFontSize,
                  fontWeight: 800,
                  color: colors.warmSoft,
                  whiteSpace: "nowrap",
                  marginRight: g.insidePad,
                  lineHeight: g.insideFontSize,
                }}
              >
                {info()}
              </div>
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
          aria-valuetext={typeof renderedInfo === "string" ? renderedInfo : undefined}
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
                  {info()}
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
                  {info()}
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

/** Native public props, including rich infoFormat and native StyleDesc. */
export type ProgressProps = InstanceType<typeof Progress>["$props"] & { style?: StyleDesc }
