/** Loading — ported from animal-island-vue Loading.vue (MIT), tracked in #164.
 * Uses a window-sized deferred layer at zIndex priority (3000 by default),
 * above dialogs. The existing 25fps snowfall clock also drives layer opacity;
 * the original radial vignette uses SVG; circular flake rotation is visually
 * inert, and text shadows remain omitted.
 * Show/delay/fade lifecycle, VNode tips and timer cleanup follow the original.
 * Every built-in decoration passes pointer hits through to the active layer;
 * fade-out disables the layer occluder, matching the original exiting state.
 */

import { computed, defineComponent, onBeforeUnmount, ref, watch, type PropType, type VNodeChild } from "vue"
import { motion, useElementBounds, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { colors, fonts, spacing } from "../tokens.js"
import { WindowLayer } from "./window-layer.js"
import { contentLabel, renderContent } from "./content.js"

/* Local tokens, mirroring the Less block inlined in the original. */
const NIGHT_SKY = "#0b101a"
const FLAKE_COLOR = "#fff"
const FLAKE_COUNT = 50
/** 25fps phase driver, same cadence as the platform Spinner. */
const TICK_MS = 40
/** Travel band: flakes start 30px above the overlay and end 30px below it. */
const FLAKE_TRAVEL_MARGIN = 30
/** Used until the overlay reports its first painted bounds. */
const FALLBACK_SIZE = { width: 800, height: 600 }

interface Flake {
  /** Diameter in px (1–6). */
  size: number
  /** Horizontal position as a 0–1 fraction of the overlay width. */
  left: number
  /** Seconds per fall (6–12). */
  duration: number
  /** Phase offset in seconds — the original's negative animation-delay, so
   *  the first paint already shows a full sky. */
  offset: number
}

export const Loading = defineComponent({
  name: "AnimalLoading",
  inheritAttrs: false,
  props: {
    /** true 开启落雪屏；false 时渐变消失。 */
    active: { type: Boolean, default: true },
    /** 中央提示文字；更复杂的内容用默认插槽。 */
    tip: { type: [String, Number, Object, Array, Boolean] as PropType<VNodeChild>, default: undefined },
    /** 延迟显示（毫秒），避免加载快速结束时闪烁；0 = 立即显示。 */
    delay: { type: Number, default: 0 },
    /** 渐变消失时长（秒）。 */
    fadeDuration: { type: Number, default: 0.6 },
    /** Deferred-layer priority, matching the original overlay stacking value. */
    zIndex: { type: Number, default: 3000 },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    // shown：落雪屏已显示（含淡出阶段）；exiting：正在渐变消失
    const shown = ref(false)
    const exiting = ref(false)

    let showTimer: ReturnType<typeof setTimeout> | undefined
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    let tickTimer: ReturnType<typeof setInterval> | undefined

    const flakes: Flake[] = Array.from({ length: FLAKE_COUNT }, () => {
      const duration = Math.random() * 6 + 6
      return {
        size: Math.random() * 5 + 1,
        left: Math.random(),
        duration,
        offset: Math.random() * duration,
      }
    })

    const elapsed = ref(0)
    const exitStarted = ref(0)
    const snowHost = ref<HostNode | null>(null)
    const { bounds } = useElementBounds(snowHost)
    const vignetteWidth = computed(() => Math.max(1, Math.ceil(bounds.value?.width ?? FALLBACK_SIZE.width)))
    const vignetteHeight = computed(() => Math.max(1, Math.ceil(bounds.value?.height ?? FALLBACK_SIZE.height)))
    const vignette = computed(() => {
      const width = vignetteWidth.value, height = vignetteHeight.value
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><radialGradient id="night" cx="50%" cy="50%" r="70.710678%"><stop offset="55%" stop-color="#050a14" stop-opacity="0"/><stop offset="100%" stop-color="#050a14" stop-opacity="0.6"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#night)"/></svg>`
      return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
    })

    watch(
      [() => props.active, () => props.delay, () => props.fadeDuration],
      ([active, delay, fadeDuration]) => {
        clearTimeout(showTimer)

        if (active) {
          // 淡出途中恢复开启：取消卸载计时，立即回到不透明
          clearTimeout(hideTimer)
          exiting.value = false
          if (delay === 0) {
            shown.value = true
          } else {
            showTimer = setTimeout(() => {
              shown.value = true
            }, delay)
          }
          return
        }

        // active=false：只有显示过才进入渐变消失
        if (shown.value) {
          clearTimeout(hideTimer)
          exiting.value = true
          exitStarted.value = Date.now()
          hideTimer = setTimeout(() => {
            shown.value = false
            exiting.value = false
          }, fadeDuration * 1000)
        }
      },
      { immediate: true }
    )

    // The snowfall phase only advances while the screen is shown; restarting
    // from zero on every show matches the original's v-if remount, which
    // replays the CSS animations from their (negative-delayed) starts.
    watch(shown, (isShown) => {
      if (isShown) {
        const start = Date.now()
        elapsed.value = 0
        tickTimer = setInterval(() => {
          elapsed.value = Date.now() - start
        }, TICK_MS)
      } else if (tickTimer !== undefined) {
        clearInterval(tickTimer)
        tickTimer = undefined
      }
    }, { immediate: true })

    onBeforeUnmount(() => {
      clearTimeout(showTimer)
      clearTimeout(hideTimer)
      if (tickTimer !== undefined) clearInterval(tickTimer)
    })

    return () => {
      if (!shown.value) return null

      const width = bounds.value?.width ?? FALLBACK_SIZE.width
      const height = bounds.value?.height ?? FALLBACK_SIZE.height
      const t = elapsed.value / 1000
      const opacity = exiting.value
        ? Math.max(0, 1 - (Date.now() - exitStarted.value) / Math.max(1, props.fadeDuration * 1000))
        : Math.min(1, elapsed.value / 200)

      // A plain outer shell carries the a11y props and positioning: motion.div
      // forwards attrs but only types its own props, so role/testId live here.
      const shellStyle: StyleDesc = {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: "hidden",
        pointerEvents: exiting.value ? "none" : "auto",
        ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
        ...(attrs.style as StyleDesc | undefined),
      }
      if (exiting.value) shellStyle.pointerEvents = "none"

      const fadeStyle: StyleDesc = {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: NIGHT_SKY,
        pointerEvents: "none",
      }

      return (
        <WindowLayer backgroundColor={NIGHT_SKY} priority={props.zIndex} style={{ opacity, pointerEvents: exiting.value ? "none" : "auto" }}>
        <div {...attrs} role="status" aria-label={contentLabel(props.tip) ?? "加载中"} testId={props.testId} style={shellStyle}>
          <motion.div
            initial={false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0 }}
            style={fadeStyle}
          >
            {{ default: () => <>
            <div ref={snowHost} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "none" }}>
              {flakes.map((flake, ix) => {
                const cycle = ((t + flake.offset) % flake.duration) / flake.duration
                const size = Math.round(flake.size * 10) / 10
                return (
                  <div
                    key={ix}
                    style={{
                      position: "absolute",
                      top: -FLAKE_TRAVEL_MARGIN + cycle * (height + FLAKE_TRAVEL_MARGIN * 2),
                      left: flake.left * width,
                      width: size,
                      height: size,
                      borderRadius: size / 2,
                      pointerEvents: "none",
                      backgroundColor: FLAKE_COLOR,
                    }}
                  />
                )
              })}
            </div>
            <img src={vignette.value} alt="" objectFit="fill" aria-hidden={true}
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                width: "100%", height: "100%",
                pointerEvents: "none",
              }}
            />
            {props.tip || slots.default ? (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingLeft: spacing.xl,
                  paddingRight: spacing.xl,
                  color: colors.cream,
                  fontWeight: 800,
                  fontSize: 18,
                  lineHeight: 27,
                  textAlign: "center",
                  pointerEvents: "none",
                }}
              >
                {slots.default ? slots.default() : renderContent(props.tip)}
              </div>
            ) : null}
            </> }}
          </motion.div>
        </div>
        </WindowLayer>
      )
    }
  },
})

export type LoadingProps = Omit<InstanceType<typeof Loading>["$props"], "style"> & { style?: StyleDesc }

export default Loading
