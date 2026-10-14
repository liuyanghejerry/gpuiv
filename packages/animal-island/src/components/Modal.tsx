/** Modal — ported from animal-island-vue Modal.vue (MIT), tracked in #164.
 * Retains palette, variant padding, footer and Typewriter; the game clip-path
 * becomes a 22px rounded rectangle. Scale entry becomes opacity animation.
 * A window-sized deferred anchored layer replaces DOM Teleport. The mask
 * shows directly. Native Tab runs before JS focus correction, so trapping
 * is approximate. Width supports native numeric/percentage/auto dimensions.
 */

import { defineComponent, onBeforeUnmount, ref, watch, type PropType, type VNode } from "vue"
import {
  AnimatePresence,
  motion,
  useGpuix,
  useWindowSize,
  type EventPayload,
  type HostNode,
  type StyleDesc,
} from "@gpuiv/vue"
import { colors, ease, fonts } from "../tokens.js"
import { Button } from "./Button.js"
import { Typewriter } from "./Typewriter.js"
import { WindowLayer } from "./window-layer.js"

export type ModalVariant = "default" | "game"

/** 面板底色 rgb(247, 243, 223)（与原版 Less 一致）。 */
const PANEL_BG = "#f7f3df"
/** 原版 body 文字色 rgb(128, 115, 89)。 */
const PANEL_TEXT = "#807359"
/** 原版内容区文字色 #8a7b66。 */
const CONTENT_TEXT = "#8a7b66"
/** 任务指定的暖棕遮罩（原版为 rgba(0, 0, 0, 0.35)）。 */
const MASK_BG = "rgba(0, 0, 0, 0.35)"

export const Modal = defineComponent({
  name: "AnimalModal",
  inheritAttrs: false,
  props: {
    /** 是否可见（受控；配合 v-model:open / onUpdate:open 使用） */
    open: { type: Boolean, default: false },
    /** 弹窗类型: default 常规圆角矩形, game 异形自然外框（GPUIV 统一圆角矩形，见文件头） */
    variant: { type: String as PropType<ModalVariant>, default: "game" },
    /** 标题 */
    title: { type: String, default: undefined },
    /** 宽度（数字 px；字符串限 GPUIV 的 px/%/auto 形式） */
    width: { type: [Number, String] as PropType<number | string>, default: 520 },
    /** 点击遮罩关闭 */
    maskClosable: { type: Boolean, default: true },
    /** 底部区域：string 渲染为文本，VNode 直接渲染，null 不渲染；省略时按 showFooter */
    footer: { type: [String, Object] as PropType<string | VNode | null>, default: undefined },
    /** 是否展示默认底部按钮（footer 未提供时的便捷开关） */
    showFooter: { type: Boolean, default: true },
    /** 按原版默认开启逐字打出 */
    typewriter: { type: Boolean, default: true },
    /** 打字机每字间隔 (ms) */
    typeSpeed: { type: Number, default: 80 },
    /** 遮罩层自定义样式 */
    maskStyle: { type: Object as PropType<StyleDesc>, default: undefined },
    onClose: { type: Function as PropType<() => void>, default: undefined },
    onOk: { type: Function as PropType<() => void>, default: undefined },
    /** 取消按钮 / 遮罩点击 / Esc 触发（随后还会触发 onClose 与 onUpdate:open） */
    onCancel: { type: Function as PropType<() => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const { renderer } = useGpuix()
    const windowSize = useWindowSize()
    const panel = ref<HostNode | null>(null)
    const playKey = ref(0)
    let previouslyFocused: number | null = null
    const restoreFocus = () => {
      if (previouslyFocused != null) renderer?.focusElement?.(previouslyFocused)
      previouslyFocused = null
    }
    onBeforeUnmount(restoreFocus)

    // 对齐原版：footer===null 不渲染；#footer 插槽或 footer prop 优先；
    // 否则按 showFooter 决定默认 取消/确定。
    const footerVisible = () => {
      if (props.footer === null) return false
      if (slots.footer) return true
      if (props.footer) return true
      return props.showFooter
    }

    function emitUpdateOpen(value: boolean) {
      ;(attrs["onUpdate:open"] as ((value: boolean) => void) | undefined)?.(value)
    }

    function requestClose() {
      emitUpdateOpen(false)
      props.onClose?.()
    }

    function cancel() {
      props.onCancel?.()
      requestClose()
    }

    function handleMask() {
      if (props.maskClosable) cancel()
    }

    function onPanelKeyDown(e: EventPayload) {
      if (e.key === "escape") {
        cancel()
        return
      }
      // Focus trap approximation (see header): the native Tab walk cannot be
      // cancelled from JS, so focus may step out of the dialog first; this
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
        if (v) {
          previouslyFocused = renderer?.getFocusedElementId?.() ?? null
          playKey.value++
        }
        else restoreFocus()
      },
      { immediate: true },
    )

    return () => {
      // A v-model:open listener must not leak onto the host div as an event prop.
      const { "onUpdate:open": _updateOpenListener, ...forwardAttrs } = attrs

      const shellStyle: StyleDesc = {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
        ...(attrs.style as StyleDesc | undefined),
      }

      const maskStyle: StyleDesc = {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        ...props.maskStyle,
        backgroundColor: "transparent",
      }

      const panelStyle: StyleDesc = {
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: props.width,
        // calc(100vw - 32px) / calc(100vh - 64px) via the polled window size.
        maxWidth: windowSize.value.width - 32,
        maxHeight: windowSize.value.height - 64,
        paddingTop: props.variant === "game" ? 48 : 40,
        paddingLeft: props.variant === "game" ? 48 : 35,
        paddingRight: props.variant === "game" ? 48 : 35,
        paddingBottom: props.variant === "game" ? 32 : 25,
        backgroundColor: PANEL_BG,
        borderRadius: 22,
        boxShadow: props.variant === "game" ? undefined : {
          offsetX: 0, offsetY: 18, blurRadius: 50, spreadRadius: -12, color: "rgba(0, 0, 0, 0.25)",
        },
        color: PANEL_TEXT,
      }

      const defaultFooter = [
        <Button key="cancel" type="primary" onClick={() => cancel()}>
          <text>取消</text>
        </Button>,
        <Button key="ok" type="primary" onClick={() => props.onOk?.()}>
          <text>确定</text>
        </Button>,
      ]

      const footerContent = slots.footer ? (
        slots.footer()
      ) : typeof props.footer === "string" ? (
        <text>{props.footer}</text>
      ) : props.footer ? (
        (props.footer as VNode)
      ) : (
        defaultFooter
      )

      return (
        <AnimatePresence>
          {props.open ? (
            <WindowLayer key="animal-modal" backgroundColor={MASK_BG} style={props.maskStyle}>
            <div {...forwardAttrs} testId={props.testId} style={shellStyle}>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease }}
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={maskStyle} onClick={handleMask} />
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
                        paddingBottom: 15,
                      }}
                    >
                      <div style={{ fontSize: 28, fontWeight: 700, color: colors.warmSoft }}>
                        {slots.title ? slots.title() : <text>{props.title}</text>}
                      </div>
                    </div>
                  ) : null}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      paddingBottom: 20,
                      flexGrow: 1,
                      minHeight: 0,
                      overflow: "scroll",
                      fontSize: 20,
                      fontWeight: 600,
                      lineHeight: 32,
                      color: CONTENT_TEXT,
                    }}
                  >
                  {props.typewriter ? <Typewriter speed={props.typeSpeed} trigger={playKey.value}>{slots.default?.()}</Typewriter> : slots.default?.()}
                  </div>
                  {footerVisible() ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 12,
                      }}
                    >
                      {footerContent}
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

export default Modal
