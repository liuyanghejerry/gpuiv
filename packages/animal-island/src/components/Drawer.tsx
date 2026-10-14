/** Drawer — ported from animal-island-vue Drawer.vue (MIT), tracked in #164.
 * GPUI anchors the deferred mask/panel to window (0,0); no DOM Teleport is
 * needed. Original palette, per-corner radii, four placements and geometry are
 * kept. Numeric edge motion replaces CSS translation; the mask shows directly.
 * Width/height support native px/% dimensions; unsupported forms use fallback
 * animation offsets. pushBackground scale/blur is inactive. Tab trapping is a
 * native focus correction; close and unmount restore the saved focus.
 */

import { defineComponent, onBeforeUnmount, ref, watch, type PropType, type VNode } from "vue"
import {
  AnimatePresence,
  motion,
  useGpuix,
  useWindowSize,
  type BoxShadow,
  type EventPayload,
  type HostNode,
  type MotionStyle,
  type StyleDesc,
} from "@gpuiv/vue"
import { fonts, radius } from "../tokens.js"
import { activationKeys } from "../interaction.js"
import { WindowLayer } from "./window-layer.js"

export type DrawerPlacement = "left" | "right" | "top" | "bottom"

export interface DrawerProps {
  open?: boolean
  title?: string
  placement?: DrawerPlacement
  width?: number | string
  height?: number | string
  maskClosable?: boolean
  pushBackground?: boolean
  footer?: string | VNode | null
  maskStyle?: StyleDesc
  onClose?: () => void
  testId?: string
}

/* ── Palette (from the original Less block) ────── */

/** rgb(247, 243, 223) — .animal-drawer__panel background. */
const PANEL_BG = "#f7f3df"
/** rgb(128, 115, 89) — panel text. */
const PANEL_TEXT = "#807359"
/** rgba(0, 0, 0, 0.18) — .animal-drawer__mask. */
const MASK_BG = "rgba(0, 0, 0, 0.18)"
/** rgba(61, 52, 40, 0.18) — one-directional panel shadows. */
const PANEL_SHADOW = "rgba(61, 52, 40, 0.18)"
/** #8a7b66 — .animal-drawer__body text. */
const BODY_TEXT = "#8a7b66"

const DRAWER_EASE: [number, number, number, number] = [0.2, 0, 0.2, 1]

function panelShadow(offsetX: number, offsetY: number): BoxShadow {
  return { offsetX, offsetY, blurRadius: 32, spreadRadius: 0, color: PANEL_SHADOW }
}

/** Resolve width/height to px for the slide offset (see header). */
function resolveSize(value: number | string, viewport: number, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const text = value.trim()
    const parsed = parseFloat(text)
    if (Number.isFinite(parsed)) {
      return text.endsWith("%") ? (viewport * parsed) / 100 : parsed
    }
  }
  return fallback
}

export const Drawer = defineComponent({
  name: "AnimalDrawer",
  inheritAttrs: false,
  props: {
    /** 是否可见（受控；配合 v-model:open / onUpdate:open 使用） */
    open: { type: Boolean, default: false },
    /** 标题 */
    title: { type: String, default: undefined },
    /** 弹出位置 */
    placement: { type: String as PropType<DrawerPlacement>, default: "right" },
    /** 宽度（left / right 时生效；数字 px，字符串限 px/% 形式，见文件头） */
    width: { type: [Number, String] as PropType<number | string>, default: 378 },
    /** 高度（top / bottom 时生效；同 width） */
    height: { type: [Number, String] as PropType<number | string>, default: 300 },
    /** 点击遮罩关闭 */
    maskClosable: { type: Boolean, default: true },
    /** Inert：背景下沉景深效果无法移植（GPUIV 无 transform/filter，见文件头） */
    pushBackground: { type: Boolean, default: true },
    /** 底部区域：string 渲染为文本，VNode 直接渲染，null/undefined 不渲染 */
    footer: { type: [String, Object] as PropType<string | VNode | null>, default: undefined },
    /** 遮罩层自定义样式 */
    maskStyle: { type: Object as PropType<StyleDesc>, default: undefined },
    /** 遮罩点击 / Esc / 关闭按钮触发（随后还会触发 onUpdate:open） */
    onClose: { type: Function as PropType<() => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const { renderer } = useGpuix()
    const windowSize = useWindowSize()
    const panel = ref<HostNode | null>(null)
    let previouslyFocused: number | null = null
    const restoreFocus = () => {
      if (previouslyFocused != null) renderer?.focusElement?.(previouslyFocused)
      previouslyFocused = null
    }
    onBeforeUnmount(restoreFocus)

    function emitUpdateOpen(value: boolean) {
      ;(attrs["onUpdate:open"] as ((value: boolean) => void) | undefined)?.(value)
    }

    function requestClose() {
      emitUpdateOpen(false)
      props.onClose?.()
    }

    function handleMask() {
      if (props.maskClosable) requestClose()
    }

    function onPanelKeyDown(e: EventPayload) {
      if (e.key === "escape") {
        requestClose()
        return
      }
      // Focus trap approximation (same as Modal): the native Tab walk cannot
      // be cancelled from JS, so focus may step out of the drawer first; this
      // immediately re-pins it inside the panel subtree.
      if (e.key === "tab") {
        const id = panel.value?.id
        if (id == null) return
        if (e.modifiers?.shift) renderer?.focusPreviousWithin?.(id)
        else renderer?.focusNextWithin?.(id)
      }
    }

    watch(
      () => props.open,
      (v) => {
        if (v) previouslyFocused = renderer?.getFocusedElementId?.() ?? null
        else restoreFocus()
      },
      { immediate: true },
    )

    return () => {
      // A v-model:open listener must not leak onto the host div as an event prop.
      const { "onUpdate:open": _updateOpenListener, ...forwardAttrs } = attrs

      const horizontal = props.placement === "left" || props.placement === "right"
      const viewport = horizontal ? windowSize.value.width : windowSize.value.height
      const cap = Math.max(0, viewport - 32) // calc(100vw/vh − 32px)
      const size = Math.min(
        resolveSize(horizontal ? props.width : props.height, viewport, horizontal ? 378 : 300),
        cap
      )

      const shellStyle: StyleDesc = {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
        ...(attrs.style as StyleDesc | undefined),
      }

      // The motion.div fades; the inner plain div owns the fill + click
      // (motion.div's TSX surface accepts only motion props).
      const maskFrameStyle: StyleDesc = {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      }
      const maskStyle: StyleDesc = {
        width: "100%",
        height: "100%",
        ...props.maskStyle,
        backgroundColor: "transparent",
      }

      // The motion.div owns position + the slide tween; the inner plain div
      // carries the dialog visuals (and the host ref — a ref on motion.div
      // would resolve to the component instance, not a HostNode).
      const frameStyle: StyleDesc = { position: "absolute" }
      const panelStyle: StyleDesc = {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: PANEL_BG,
        color: PANEL_TEXT,
        overflow: "hidden",
      }
      // Edge tweened by motion (off-screen −size → 0), per placement.
      let slide: { initial: MotionStyle; animate: MotionStyle; exit: MotionStyle }
      switch (props.placement) {
        case "left":
          Object.assign(frameStyle, { top: 0, bottom: 0, left: 0, width: props.width, maxWidth: cap })
          Object.assign(panelStyle, {
            borderTopRightRadius: radius.card,
            borderBottomRightRadius: radius.card,
            boxShadow: panelShadow(12, 0),
          })
          slide = { initial: { left: -size }, animate: { left: 0 }, exit: { left: -size } }
          break
        case "top":
          Object.assign(frameStyle, { top: 0, left: 0, right: 0, height: props.height, maxHeight: cap })
          Object.assign(panelStyle, {
            borderBottomLeftRadius: radius.card,
            borderBottomRightRadius: radius.card,
            boxShadow: panelShadow(0, 12),
          })
          slide = { initial: { top: -size }, animate: { top: 0 }, exit: { top: -size } }
          break
        case "bottom":
          Object.assign(frameStyle, { bottom: 0, left: 0, right: 0, height: props.height, maxHeight: cap })
          Object.assign(panelStyle, {
            borderTopLeftRadius: radius.card,
            borderTopRightRadius: radius.card,
            boxShadow: panelShadow(0, -12),
          })
          slide = { initial: { bottom: -size }, animate: { bottom: 0 }, exit: { bottom: -size } }
          break
        case "right":
        default:
          Object.assign(frameStyle, { top: 0, bottom: 0, right: 0, width: props.width, maxWidth: cap })
          Object.assign(panelStyle, {
            borderTopLeftRadius: radius.card,
            borderBottomLeftRadius: radius.card,
            boxShadow: panelShadow(-12, 0),
          })
          slide = { initial: { right: -size }, animate: { right: 0 }, exit: { right: -size } }
          break
      }

      return (
        <AnimatePresence>
          {props.open ? (
            <WindowLayer key="animal-drawer" backgroundColor={MASK_BG} style={props.maskStyle}>
            <div {...forwardAttrs} testId={props.testId} style={shellStyle}>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.36, ease: "ease" }}
                style={maskFrameStyle}
              >
                <div style={maskStyle} onClick={handleMask} />
              </motion.div>
              <motion.div
                initial={slide.initial}
                animate={slide.animate}
                exit={slide.exit}
                transition={{ duration: 0.36, ease: DRAWER_EASE }}
                style={frameStyle}
              >
                <div
                  ref={panel}
                  role="dialog"
                  aria-label={props.title}
                  tabIndex={0}
                  autoFocus
                  onKeyDown={onPanelKeyDown}
                  style={panelStyle}
                >
                  {slots.title || props.title ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingTop: 24,
                        paddingRight: 24,
                        paddingBottom: 15,
                        paddingLeft: 24,
                        flexShrink: 0,
                      }}
                    >
                      <div style={{ fontSize: 28, fontWeight: 700, color: "rgba(114, 93, 66, 1)" }}>
                        {slots.title ? slots.title() : <text>{props.title}</text>}
                      </div>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label="关闭"
                        onClick={() => requestClose()}
                        onKeyDown={activationKeys(() => requestClose())}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 32,
                          height: 32,
                          fontSize: 22,
                          color: "rgba(114, 93, 66, 0.6)",
                          borderRadius: radius.pill,
                          cursor: "pointer",
                          hover: { backgroundColor: "rgba(114, 93, 66, 0.1)", color: "rgba(114, 93, 66, 1)" },
                        }}
                      >
                        <text style={{ pointerEvents: "none" }}>×</text>
                      </div>
                    </div>
                  ) : null}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      flexGrow: 1,
                      minHeight: 0,
                      overflow: "scroll",
                      paddingRight: 24,
                      paddingBottom: 24,
                      paddingLeft: 24,
                      fontSize: 20,
                      fontWeight: 600,
                      lineHeight: 32,
                      color: BODY_TEXT,
                    }}
                  >
                    {slots.default?.()}
                  </div>
                  {slots.footer || props.footer ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 12,
                        paddingRight: 24,
                        paddingBottom: 24,
                        paddingLeft: 24,
                        flexShrink: 0,
                      }}
                    >
                      {slots.footer ? (
                        slots.footer()
                      ) : typeof props.footer === "string" ? (
                        <text>{props.footer}</text>
                      ) : (
                        (props.footer as VNode)
                      )}
                    </div>
                  ) : null}
                </div>
              </motion.div>
            </div>
            </WindowLayer>
          ) : null}
        </AnimatePresence>
      )
    }
  },
})

export default Drawer
