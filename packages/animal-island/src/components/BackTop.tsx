/** BackTop — aligned with animal-island-ui's React BackTop (MIT).
 * Uses the original RocketIcon, bottom 32 / right 24 placement, 10px entrance,
 * silhouette shadows and hover/press scaling through native numeric motion.
 * Native apps have no implicit browser window scroller: target returns a
 * scrollable host id/ref. Shared scroll commands animate the return; the
 * visibility poll and controller are released on unmount.
 */

import { defineComponent, onBeforeUnmount, onMounted, ref, type PropType } from "vue"
import {
  AnimatePresence,
  createScrollController,
  motion,
  useGpuix,
  type EventPayload,
  type StyleDesc,
} from "@gpuiv/vue"
import { ease, fonts } from "../tokens.js"
import { getIconDataUrl } from "./Icon.js"
import { activationKeys } from "../interaction.js"

/** 滚动容器目标：元素 id 数字，或带数值 `id` 的 host ref / VirtualList ref。 */
export type BackTopTarget = number | { id?: number | null } | null | undefined

export interface BackTopProps {
  target?: () => BackTopTarget
  visibilityHeight?: number
  duration?: number
  onClick?: (e: EventPayload) => void
  testId?: string
}

/** React uses naive-icons RocketIcon. SVG filters keep the shadow on the
 * coloured silhouette rather than an unrelated rectangular/circular backing. */
const rocketUrls = new Map<boolean, string>()
function rocketIconUrl(hovered: boolean): string {
  const cached = rocketUrls.get(hovered)
  if (cached) return cached
  const original = Buffer.from(getIconDataUrl("Rocket").split(",")[1], "base64").toString()
  const inner = original.slice(original.indexOf(">") + 1, original.lastIndexOf("</svg>"))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="-21 -21 90 90" fill="none" stroke="#2A2A2A" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><defs><filter id="shadow" x="-100%" y="-100%" width="300%" height="300%"><feDropShadow dx="0" dy="3" stdDeviation="${hovered ? 5.25 : 3.75}" flood-color="#5b4e1e" flood-opacity="${hovered ? 0.32 : 0.22}"/></filter></defs><g filter="url(#shadow)">${inner}</g></svg>`
  const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
  rocketUrls.set(hovered, url)
  return url
}

function resolveTargetId(target: (() => BackTopTarget) | undefined): number | null {
  const value = target?.()
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value
  if (value !== null && typeof value === "object") {
    const id = value.id
    if (typeof id === "number" && Number.isSafeInteger(id) && id >= 0) return id
  }
  return null
}

export const BackTop = defineComponent({
  name: "AnimalBackTop",
  inheritAttrs: false,
  props: {
    /** 滚动容器：返回 host ref（带数值 id）或元素 id；不传则按钮永不显示（见文件头） */
    target: { type: Function as PropType<() => BackTopTarget>, default: undefined },
    /** 滚动多少 px 后显示 */
    visibilityHeight: { type: Number, default: 400 },
    /** 回顶动画时长 (ms) */
    duration: { type: Number, default: 300 },
    /** 点击回到顶部后的回调 */
    onClick: { type: Function as PropType<(e: EventPayload) => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    const { renderer } = useGpuix()
    const visible = ref(false)
    const hovered = ref(false)
    const pressed = ref(false)
    const focused = ref(false)

    const scrolling = renderer ? createScrollController(renderer) : null

    let timer: ReturnType<typeof setInterval> | null = null
    onMounted(() => {
      timer = setInterval(() => {
        const id = resolveTargetId(props.target)
        if (id === null || !renderer?.getScrollOffset) {
          if (visible.value) visible.value = false
          return
        }
        try {
          const offset = renderer.getScrollOffset(id)
          const scrollTop = offset && offset.length >= 2 ? -offset[1] : 0
          const next = scrollTop > props.visibilityHeight
          if (next !== visible.value) visible.value = next
        } catch {
          // Container destroyed or not painted yet.
          if (visible.value) visible.value = false
        }
      }, 120)
    })

    onBeforeUnmount(() => {
      if (timer !== null) clearInterval(timer)
      scrolling?.dispose()
    })

    function scrollToTop(e: EventPayload) {
      const id = resolveTargetId(props.target)
      if (id !== null) {
        if (scrolling) {
          try {
            void scrolling
              .scrollTo(id, { y: 0, behavior: "smooth", duration: Math.max(0, props.duration) })
              .catch(() => {})
          } catch {
            // Invalid values are guarded above; a mid-teardown renderer throws here.
          }
        } else if (renderer?.scrollTo) {
          try {
            renderer.scrollTo(id, 0, 0)
          } catch {
            // Container gone between poll and click.
          }
        }
      }
      props.onClick?.(e)
    }

    return () => {
      const size = 64, restBottom = 32, restRight = 24
      const scale = pressed.value ? 0.96 : hovered.value ? 1.08 : 1
      const artSize = 120 * scale

      const motionStyle: StyleDesc = {
        position: "absolute",
        right: restRight,
        bottom: restBottom,
        width: size,
        height: size,
      }
      // The motion.div owns position + the enter/exit tween (its TSX surface
      // accepts only motion props); the inner plain div is the button.
      const style: StyleDesc = {
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        userSelect: "none",
        ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
        ...(attrs.style as StyleDesc | undefined),
        ...(focused.value ? { outline: { width: 2, color: "#19c8b9", offset: 2 } } : {}),
      }

      return (
        <AnimatePresence>
          {visible.value ? (
            <motion.div
              key="animal-backtop"
              initial={{ opacity: 0, bottom: restBottom - 10 }}
              animate={{ opacity: 1, bottom: restBottom }}
              exit={{ opacity: 0, bottom: restBottom - 10 }}
              transition={{ duration: 0.3, ease }}
              style={motionStyle}
            >
              <div
                {...attrs}
                role="button"
                tabIndex={0}
                aria-label="返回顶部"
                testId={props.testId}
                onClick={scrollToTop}
                onKeyDown={activationKeys(scrollToTop)}
                onFocus={() => (focused.value = true)}
                onBlur={() => (focused.value = false)}
                onMouseEnter={() => (hovered.value = true)}
                onMouseLeave={() => {
                  hovered.value = false
                  pressed.value = false
                }}
                onMouseDown={() => (pressed.value = true)}
                onMouseUp={() => (pressed.value = false)}
                style={style}
              >
                <img src={rocketIconUrl(hovered.value)} alt="" objectFit="fill"
                  testId={props.testId ? `${props.testId}-icon` : undefined}
                  motion={{ initial: false, animate: { width: artSize, height: artSize, left: (size - artSize) / 2, top: (size - artSize) / 2 + (pressed.value ? 2 : 0) }, transition: { duration: 0.3, ease } }}
                  style={{ position: "absolute", width: 120, height: 120, left: -28, top: -28, pointerEvents: "none" }} />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      )
    }
  },
})

export default BackTop
