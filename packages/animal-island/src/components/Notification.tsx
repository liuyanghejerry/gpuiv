/** Notification — aligned with animal-island-ui's React Notification (MIT).
 * Six placements, same-key updates and node-valued content use a root-mounted
 * native container in place of a browser Portal. User close / duration expiry
 * retain the card through its 0.25s opacity/top exit; onClose runs after the
 * current native motion completion. destroy removes immediately and calls
 * onClose synchronously. Native motion generation filtering and weak view
 * instance IDs keep stale events from closing a same-key replacement.
 * Clickable hover uses a native 1px lift; color/shadow changes are immediate.
 * Native flat hit-testing separates close/action controls from card clicks.
 */

import {
  defineComponent,
  onUnmounted,
  reactive,
  ref,
  toRaw,
  watch,
  type PropType,
  type VNodeChild,
} from "vue"
import { motion, useWindowSize, type BoxShadow, type StyleDesc } from "@gpuiv/vue"
import { borderWidth, colors, ease, fonts, radius, spacing } from "../tokens.js"
import { renderContent } from "./content.js"
import { activationKeys } from "../interaction.js"

/* ── Types (ported from types.ts) ─────────────── */

export type NotificationType = "success" | "info" | "warning" | "error"
export type NotificationPosition = "top" | "topLeft" | "topRight" | "bottom" | "bottomLeft" | "bottomRight"
export type NotificationPlacement = "top" | "bottom"

export interface NotificationConfig {
  /** 通知标题（必填），支持字符串或 VNode（对齐 React 的 ReactNode） */
  message: VNodeChild
  /** 通知描述/正文，支持字符串或 VNode */
  description?: VNodeChild
  /** 自动关闭延时（秒），默认 4.5；传 0 不自动关闭 */
  duration?: number
  /** 出现位置，默认 'top'（顶部居中） */
  position?: NotificationPosition
  /** 类型（open/直接调用时 fallback 为 'info'） */
  type?: NotificationType
  /** 自定义图标（优先级高于 type 默认图标） */
  icon?: VNodeChild
  /** 自定义操作按钮，渲染在关闭按钮左侧 */
  btn?: VNodeChild
  /** 唯一 key，显式指定后再次调用 open 同 key 会更新现有通知而不是新增 */
  key?: string
  /** 关闭回调 */
  onClose?: () => void
  /** 点击通知本体回调 */
  onClick?: () => void
  /** 自定义关闭图标 */
  closeIcon?: VNodeChild
  /** Inert：GPUIV 无 CSS 类，仅为 API 对齐保留 */
  className?: string
  /** 卡片自定义样式（原版为 CSSProperties，此处为 GPUIV 的 StyleDesc） */
  style?: StyleDesc
}

export interface NotificationItem extends NotificationConfig {
  /** 运行时唯一 key */
  key: string
  /** 实际类型（已 fallback） */
  type: NotificationType
  /** 实际 position（已 fallback） */
  position: NotificationPosition
  /** placement 由 position 推导（用于出场动画方向） */
  placement: NotificationPlacement
  /** 创建时间戳 */
  createdAt: number
}

export interface NotificationViewProps {
  item: NotificationItem
  onRemove: (key: string) => void
}

export interface NotificationStatic {
  (config: NotificationConfig | string): void
  open: (config: NotificationConfig | string) => void
  success: (config: NotificationConfig | string) => void
  info: (config: NotificationConfig | string) => void
  warning: (config: NotificationConfig | string) => void
  error: (config: NotificationConfig | string) => void
  destroy: (key?: string) => void
}

/* ── Store + 命令式 API (ported from Notification.ts) ── */

const DEFAULT_DURATION = 4.5

const POSITION_PLACEMENT: Record<NotificationPosition, NotificationPlacement> = {
  top: "top",
  topLeft: "top",
  topRight: "top",
  bottom: "bottom",
  bottomLeft: "bottom",
  bottomRight: "bottom",
}

const POSITION_GROUPS: NotificationPosition[] = ["top", "topLeft", "topRight", "bottom", "bottomLeft", "bottomRight"]

// 模块级 reactive store
// Annotate after construction: Vue's DeepUnwrap on recursive VNodeChild lists
// exceeds TypeScript's instantiation depth. Runtime reactivity stays unchanged.
export const notificationStore = reactive({ items: [] }) as { items: NotificationItem[] }

let counter = 0
// Same-key updates reuse a view instance. Destroy followed by re-open creates
// a new one, even in the same Vue flush; stale completion events cannot remove
// the replacement. Weak keys avoid a growing global key/tombstone ledger.
const viewInstances = new WeakMap<object, number>()
let viewCounter = 0
function viewInstance(item: NotificationItem): number {
  const raw = toRaw(item)
  let instance = viewInstances.get(raw)
  if (instance === undefined) { instance = ++viewCounter; viewInstances.set(raw, instance) }
  return instance
}

function buildItem(config: NotificationConfig | string, type: NotificationType): NotificationItem {
  const normalized: NotificationConfig = typeof config === "string" ? { message: config } : { ...config }
  const position: NotificationPosition = normalized.position ?? "top"
  counter += 1
  return {
    ...normalized,
    type,
    key: normalized.key ?? `animal-notification-${Date.now()}-${counter}`,
    position,
    placement: POSITION_PLACEMENT[position],
    duration: normalized.duration ?? DEFAULT_DURATION,
    createdAt: Date.now(),
  }
}

function open(config: NotificationConfig | string, type: NotificationType = "info"): void {
  const item = buildItem(config, type)

  // 显式 key 时，先尝试更新现有通知
  if (item.key) {
    const idx = notificationStore.items.findIndex((it) => it.key === item.key)
    if (idx !== -1) {
      viewInstances.set(toRaw(item), viewInstance(notificationStore.items[idx]))
      notificationStore.items[idx] = item
      return
    }
  }

  notificationStore.items.push(item)
}

export function removeNotification(key: string): void {
  const idx = notificationStore.items.findIndex((it) => it.key === key)
  if (idx === -1) return
  notificationStore.items.splice(idx, 1)
}

function destroy(key?: string): void {
  if (key) {
    const removed: NotificationItem[] = []
    const idx = notificationStore.items.findIndex((it) => it.key === key)
    if (idx !== -1) {
      removed.push(notificationStore.items[idx])
      notificationStore.items.splice(idx, 1)
    }
    removed.forEach((it) => it.onClose?.())
  } else {
    const removed = notificationStore.items.slice()
    notificationStore.items.splice(0, notificationStore.items.length)
    removed.forEach((it) => it.onClose?.())
  }
}

// 构建 Notification 命令式 API
const notificationApi = ((config: NotificationConfig | string) => open(config, "info")) as NotificationStatic
notificationApi.open = (config) => open(config, "info")
notificationApi.success = (config) => open(config, "success")
notificationApi.info = (config) => open(config, "info")
notificationApi.warning = (config) => open(config, "warning")
notificationApi.error = (config) => open(config, "error")
notificationApi.destroy = destroy

export { notificationApi as Notification }
export const NOTIFICATION_DEFAULT_DURATION = DEFAULT_DURATION
// 与 React 一致，暴露底层命令式 API（open 用于同 key 更新，destroy 用于关闭）
export { open as notificationOpen, destroy as notificationDestroy }

/* ── Type 配色与图标（数值逐字取自原版 Less/模板） ── */

interface TypeAccent {
  /** 卡片底色 */
  bg: string
  /** 卡片 2px 描边色 */
  border: string
  /** 卡片投影（原版 `0 6px 18px` 的 type 着色版） */
  shadow: BoxShadow
  /** 图标圆片底色 */
  iconBg: string
  /** 图标墨色 */
  iconColor: string
}

function shadow(offsetY: number, blurRadius: number, color: string): BoxShadow {
  return { offsetX: 0, offsetY, blurRadius, spreadRadius: 0, color }
}

const TYPE_ACCENT: Record<NotificationType, TypeAccent> = {
  success: {
    bg: "#f5fae9",
    border: colors.success,
    shadow: shadow(6, 18, "rgba(111, 186, 44, 0.18)"),
    iconBg: "#d8efc1",
    iconColor: colors.successActive,
  },
  info: {
    bg: "#ecf9f6",
    border: colors.primary,
    shadow: shadow(6, 18, "rgba(25, 200, 185, 0.18)"),
    iconBg: "#c2ece6",
    iconColor: "#11a89b",
  },
  warning: {
    bg: "#fdf6d9",
    border: colors.warning,
    shadow: shadow(6, 18, "rgba(245, 195, 28, 0.2)"),
    iconBg: "#fbeaa1",
    iconColor: "#b88a06",
  },
  error: {
    bg: "#fde8e8",
    border: colors.error,
    shadow: shadow(6, 18, "rgba(224, 90, 90, 0.18)"),
    iconBg: "#f7c8c8",
    iconColor: colors.errorActive,
  },
}

/** clickable:hover 的加深阴影（原版 `.animal-notification--clickable:hover`
 *  覆盖所有 type 的投影；translateY(-1px) 已砍，见文件头）。 */
const CLICKABLE_HOVER_SHADOW = shadow(10, 26, "rgba(61, 52, 40, 0.18)")

/** 原版 focus-visible 的描边色。 */
const FOCUS_OUTLINE = { width: 2, color: "#ffcc00", offset: 2 } as const

/** 原版内联 SVG 逐字搬运，currentColor → #000（GPUIV `<svg>` 是单色着色
 *  渲染器，实际墨色由 style.color 提供）。 */
function typeIconUrl(inner: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${inner}</svg>`,
  )}`
}

const TYPE_ICON_URL: Record<NotificationType, string> = {
  success: typeIconUrl(
    `<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  info: typeIconUrl(
    `<circle cx="12" cy="7" r="1.6" fill="#000"/><path d="M12 11v7" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round"/>`,
  ),
  warning: typeIconUrl(
    `<path d="M12 4l9.5 16.5h-19z" fill="none" stroke="#000" stroke-width="2.5" stroke-linejoin="round"/>` +
      `<path d="M12 10v4M12 16.5v.01" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round"/>`,
  ),
  error: typeIconUrl(
    `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round"/>`,
  ),
}

/** 原版 6 个 `.animal-notification__position--*` 分组样式（fixed → absolute，
 *  居中组的 translateX(-50%) → 全宽 + alignItems: center，见文件头）。 */
function groupStyle(position: NotificationPosition, windowWidth: number): StyleDesc {
  const base: StyleDesc = {
    position: "absolute",
    display: "flex",
    flexDirection: "column",
    gap: spacing.md, // 12
    pointerEvents: "none",
    maxWidth: windowWidth - 32,
  }
  switch (position) {
    case "top":
      return { ...base, top: 24, left: 16, right: 16, alignItems: "center" }
    case "topLeft":
      return { ...base, top: 24, left: 24, alignItems: "flex-start" }
    case "topRight":
      return { ...base, top: 24, right: 24, alignItems: "flex-end" }
    case "bottom":
      return { ...base, bottom: 24, left: 16, right: 16, alignItems: "center" }
    case "bottomLeft":
      return { ...base, bottom: 24, left: 24, alignItems: "flex-start" }
    case "bottomRight":
      return { ...base, bottom: 24, right: 24, alignItems: "flex-end" }
  }
}

/* ── 单条通知卡片（NotificationView.vue 的模板部分） ── */

const NotificationCard = defineComponent({
  name: "AnimalNotificationCard",
  props: {
    item: { type: Object as PropType<NotificationItem>, required: true },
    onCloseClick: { type: Function as PropType<() => void>, required: true },
  },
  setup(props) {
    const windowSize = useWindowSize()
    const cardFocused = ref(false)
    const closeFocused = ref(false)
    const hovered = ref(false)

    return () => {
      const item = props.item
      const accent = TYPE_ACCENT[item.type]
      const clickable = item.onClick !== undefined

      const cardStyle: StyleDesc = {
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: spacing.md, // 12
        width: 384,
        maxWidth: windowSize.value.width - 48,
        paddingTop: 14,
        paddingBottom: 14,
        paddingLeft: spacing.lg, // 16
        paddingRight: spacing.lg,
        backgroundColor: accent.bg,
        borderWidth, // 2
        borderColor: accent.border,
        borderRadius: radius.base, // 18
        boxShadow: accent.shadow,
        color: colors.warmSoft,
        cursor: clickable ? "pointer" : "default",
        ...(clickable ? { hover: { boxShadow: CLICKABLE_HOVER_SHADOW } } : {}),
        ...(cardFocused.value && clickable ? { outline: FOCUS_OUTLINE } : {}),
        ...item.style,
      }

      return (
        <div
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          onClick={clickable ? () => item.onClick?.() : undefined}
          onKeyDown={clickable ? activationKeys(() => item.onClick?.()) : undefined}
          onMouseEnter={() => { hovered.value = true }}
          onMouseLeave={() => { hovered.value = false }}
          motion={clickable ? { initial: false, animate: { top: hovered.value ? -1 : 0 }, transition: { duration: 0.2, ease: "ease" } } : undefined}
          onFocus={clickable ? () => (cardFocused.value = true) : undefined}
          onBlur={clickable ? () => (cardFocused.value = false) : undefined}
          style={cardStyle}
        >
          <div
            aria-hidden={true}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              flexShrink: 0,
              borderRadius: radius.pill,
              backgroundColor: accent.iconBg,
              color: accent.iconColor,
              fontSize: 18,
              lineHeight: 18,
              userSelect: "none",
              // 填充装饰：挡住父级点击区（见文件头）。
              pointerEvents: "none",
            }}
          >
            {item.icon !== undefined && item.icon !== null ? (
              renderContent(item.icon)
            ) : (
              <svg
                src={TYPE_ICON_URL[item.type]}
                style={{ width: 18, height: 18, color: accent.iconColor, pointerEvents: "none" }}
              />
            )}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: spacing.xs, // 4
              flexGrow: 1,
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 21, color: colors.text }}>
              {renderContent(item.message)}
            </div>
            {item.description != null ? (
              <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 20.15, color: "#8a7b66" }}>
                {renderContent(item.description)}
              </div>
            ) : null}
          </div>
          {item.btn ? (
            <div style={{ display: "flex", alignItems: "center", flexShrink: 0, marginLeft: spacing.xs }}>
              {renderContent(item.btn)}
            </div>
          ) : null}
          <div
            role="button"
            tabIndex={0}
            aria-label="close"
            onClick={() => props.onCloseClick()}
            onKeyDown={activationKeys(() => props.onCloseClick())}
            onFocus={() => (closeFocused.value = true)}
            onBlur={() => (closeFocused.value = false)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              flexShrink: 0,
              marginLeft: spacing.xs,
              borderRadius: radius.pill,
              color: "rgba(114, 93, 66, 0.55)",
              fontSize: 18,
              lineHeight: 18,
              cursor: "pointer",
              hover: { backgroundColor: "rgba(114, 93, 66, 0.12)", color: "rgba(114, 93, 66, 1)" },
              ...(closeFocused.value ? { outline: FOCUS_OUTLINE } : {}),
            }}
          >
            {item.closeIcon !== undefined && item.closeIcon !== null ? renderContent(item.closeIcon) : <text>×</text>}
          </div>
        </div>
      )
    }
  },
})

/* ── React NotificationView duration / native completion lifecycle ── */

const NotificationEntry = defineComponent({
  name: "AnimalNotificationEntry",
  props: {
    item: { type: Object as PropType<NotificationItem>, required: true },
    placement: { type: String as PropType<NotificationPlacement>, required: true },
    onRemove: { type: Function as PropType<(key: string) => void>, required: true },
  },
  setup(props) {
    const leaving = ref(false)
    const instance = viewInstance(props.item)
    let finished = false
    let closeTimer: ReturnType<typeof setTimeout> | null = null
    const currentItem = () => notificationStore.items.find(item => item.key === props.item.key && viewInstance(item) === instance)
    function clearCloseTimer() { if (closeTimer !== null) clearTimeout(closeTimer); closeTimer = null }
    function triggerClose() {
      if (leaving.value || finished || !currentItem()) return
      clearCloseTimer()
      leaving.value = true
    }
    function completeExit() {
      if (!leaving.value || finished) return
      const item = currentItem()
      if (!item) return // destroy already removed it and synchronously called onClose.
      finished = true
      clearCloseTimer()
      props.onRemove(item.key)
      item.onClose?.()
    }
    watch(() => [props.item, props.item.duration] as const, () => {
      clearCloseTimer()
      // A same-key progress update must not revive an already dismissed card.
      if (!leaving.value && props.item.duration && props.item.duration > 0) closeTimer = setTimeout(triggerClose, props.item.duration * 1000)
    }, { immediate: true })
    onUnmounted(clearCloseTimer)

    return () => {
      // 退场/进场方向：top 从 -16px 滑入，bottom 从 +16px 浮入（原版的
      // slide-from-top / rise-from-bottom keyframes）。
      const offset = props.placement === "top" ? -16 : 16
      return (
        <motion.div
          initial={{ opacity: 0, top: offset }}
          animate={leaving.value ? { opacity: 0, top: offset } : { opacity: 1, top: 0 }}
          onMotionComplete={completeExit}
          transition={{ duration: 0.25, ease }}
          style={{ position: "relative" }}
        >
          {{ default: () => <NotificationCard item={props.item} onCloseClick={triggerClose} /> }}
        </motion.div>
      )
    }
  },
})

/* ── Root-mounted native container (React NotificationPortal equivalent) ── */

export const NotificationContainer = defineComponent({
  name: "AnimalNotificationContainer",
  inheritAttrs: false,
  props: {
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    const windowSize = useWindowSize()

    return () => {
      const groups = POSITION_GROUPS.map((position) => ({
        position,
        items: notificationStore.items.filter((it) => it.position === position),
      }))
      // Entry owns user-close motion until completion. Store destruction removes
      // it immediately, without a cached AnimatePresence exit node.

      return (
        <div
          {...attrs}
          testId={props.testId}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            pointerEvents: "none",
            ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
            ...(attrs.style as StyleDesc | undefined),
          }}
        >
          {groups.map((group) => {
            const placement = POSITION_PLACEMENT[group.position]
            // column-reverse 近似：bottom 分组反转数组，最新一条排在分组顶部。
            const ordered = placement === "bottom" ? [...group.items].reverse() : group.items
            return (
              <div key={group.position} style={groupStyle(group.position, windowSize.value.width)}>
                {ordered.map((item) => (
                    <NotificationEntry
                      key={`${item.key}:${viewInstance(item)}`}
                      item={item}
                      placement={placement}
                      onRemove={removeNotification}
                    />
                ))}
              </div>
            )
          })}
        </div>
      )
    }
  },
})

export default NotificationContainer
