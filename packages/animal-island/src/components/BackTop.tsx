/** BackTop — GPUIV port of animal-island-vue's `BackTop.vue`.
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - 滚动侦测: 原版 `target()` 返回 HTMLElement/Window 并
 *    `addEventListener('scroll')` → `target()` 改为返回滚动容器的 host ref
 *    （`<div overflow: 'scroll'>` 的 host ref 或 `VirtualList` 暴露的 ref，都带
 *    数值 `id`；也直接接受元素 id 数字）。GPUI 没有滚动事件流：挂载后每 120ms
 *    轮询 `renderer.getScrollOffset(id)`（GPUI 坐标向下为负，scrollTop = -y），
 *    超过 `visibilityHeight` 才显示按钮。不传 target、或 renderer 缺少滚动 API
 *    （如纯展示环境）时按钮永不显示——感知不到滚动位置的 BackTop 没有意义，
 *    此时仅 `onClick` 回调仍会触发。
 *  - 回顶: 原版 requestAnimationFrame 手写 easeInOutQuad 平滑滚动 `duration` ms →
 *    `createScrollController().scrollTo(id, { y: 0, behavior: 'smooth', duration })`
 *    （原生三次缓出补间，可取消；同一 id 的新请求自动取代旧请求）。renderer 有
 *    `scrollTo` 但构造不了 controller 时退化为瞬移 `scrollTo(id, 0, 0)`。用户滚轮/
 *    按压打断平滑滚动需容器侧自行接 `cancel(id)`——本组件不拥有容器的事件。
 *  - 定位: 原版 `position: fixed; bottom: 48px; right: 32px; z-index: 1000` →
 *    `position: absolute`（GPUIV 无 fixed/z-index）。把 <BackTop> 挂在相对定位的
 *    应用根部、被遮内容之后，才会浮在整窗右下角。原版 ≤768px 媒体查询
 *    （bottom 24 / right 16 / 图标 44×44）→ `useWindowSize()` 轮询实现同一断点。
 *  - 显隐: 原版 opacity 0 + visibility hidden + translateY(12px)、0.3s
 *    cubic-bezier(0.4,0,0.2,1) → `AnimatePresence` + `motion.div` 补间 opacity
 *    与 bottom（rest−12 → rest），同时长同缓动（GPUIV 无 transform）。
 *  - 图标: 原版 64×64 `backtop.svg`（奶油圆 #FFF7DE + 深棕描边 #59433A + 橙箭头
 *    #F5A623）是多色图 → 原样内联为 data URL 用 <img> 渲染（GPUIV <svg> 只能
 *    单色着色）。`filter: drop-shadow(0 4px 10px rgba(91,78,30,0.22))`（hover 时
 *    0 4px 14px / 0.32）→ GPUIV 无 filter：在图标正圆底下垫一个同色同径
 *    （viewBox 120 中外径 r=52.5 → 0.875×size）的奶油圆 div，挂同参数结构化
 *    boxShadow，效果等同 drop-shadow 跟踪 alpha 形状。hover 加强 / active 压扁
 *    的阴影用鼠标状态 ref 切换；原版 hover `scale(1.08)` 与 active
 *    `translateY(2px) scale(.96)` 砍掉（无 transform）。
 *  - focus-visible: 原版 `outline: 2px solid #ffcc00; outline-offset: 4px;
 *    border-radius: 50%` → focused ref + 结构化 outline；按钮本身
 *    borderRadius pill 已是圆形。
 *  - 键盘: 原版 Enter/Space + preventDefault → `activationKeys`（GPUIV 无法
 *    preventDefault；div 按钮没有需要阻止的默认行为，等价）。
 *  - `className` prop 无 CSS 意义未移植；`style` prop 走 attrs.style 合并。
 */

import { defineComponent, onBeforeUnmount, onMounted, ref, type PropType } from "vue"
import {
  AnimatePresence,
  createScrollController,
  motion,
  useGpuix,
  useWindowSize,
  type EventPayload,
  type StyleDesc,
} from "@gpuiv/vue"
import { ease, fonts, radius } from "../tokens.js"
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

/* ── Icon (original assets/img/icons/backtop.svg, verbatim) ── */

const ICON_CREAM = "#FFF7DE"
/** Icon circle outer radius in the 120 viewBox: r 50 + stroke 5/2 = 52.5. */
const ICON_CIRCLE_RATIO = (52.5 * 2) / 120

let cachedIconUrl: string | undefined

function backtopIconUrl(): string {
  if (cachedIconUrl !== undefined) return cachedIconUrl
  const svg = `<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="60" cy="60" r="50" fill="#FFF7DE" stroke="#59433A" stroke-width="5"/><path d="M60 82V44" stroke="#F5A623" stroke-width="10" stroke-linecap="round"/><path d="M42 58L60 40L78 58" stroke="#F5A623" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  cachedIconUrl = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`
  return cachedIconUrl
}

/* ── Drop-shadow stand-ins (original filter: drop-shadow(…)) ── */

const SHADOW_REST = { offsetX: 0, offsetY: 4, blurRadius: 10, spreadRadius: 0, color: "rgba(91, 78, 30, 0.22)" }
const SHADOW_HOVER = { offsetX: 0, offsetY: 4, blurRadius: 14, spreadRadius: 0, color: "rgba(91, 78, 30, 0.32)" }
/** Pressed approximation of translateY(2px): the shadow closes up. */
const SHADOW_ACTIVE = { offsetX: 0, offsetY: 2, blurRadius: 6, spreadRadius: 0, color: "rgba(91, 78, 30, 0.22)" }

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
    const windowSize = useWindowSize()
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
      // Original media query: ≤768px switches to bottom 24 / right 16 / 44×44.
      const compact = windowSize.value.width <= 768
      const size = compact ? 44 : 64
      const restBottom = compact ? 24 : 48
      const restRight = compact ? 16 : 32
      const circle = size * ICON_CIRCLE_RATIO

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
        borderRadius: radius.pill,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        userSelect: "none",
        ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
        ...(attrs.style as StyleDesc | undefined),
        ...(focused.value ? { outline: { width: 2, color: "#ffcc00", offset: 4 } } : {}),
      }

      return (
        <AnimatePresence>
          {visible.value ? (
            <motion.div
              key="animal-backtop"
              initial={{ opacity: 0, bottom: restBottom - 12 }}
              animate={{ opacity: 1, bottom: restBottom }}
              exit={{ opacity: 0, bottom: restBottom - 12 }}
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
                {/* Cream circle matching the icon's visible disc: casts the
                    drop-shadow (see header) and stays invisible under the icon. */}
                <div
                  style={{
                    width: circle,
                    height: circle,
                    borderRadius: radius.pill,
                    backgroundColor: ICON_CREAM,
                    boxShadow: pressed.value ? SHADOW_ACTIVE : hovered.value ? SHADOW_HOVER : SHADOW_REST,
                    pointerEvents: "none",
                  }}
                />
                <img
                  src={backtopIconUrl()}
                  objectFit="contain"
                  style={{ position: "absolute", top: 0, left: 0, width: size, height: size, pointerEvents: "none" }}
                />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      )
    }
  },
})

export default BackTop
