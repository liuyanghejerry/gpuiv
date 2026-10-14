/** Tabs — aligned with animal-island-ui's React Tabs (MIT).
 * Supports node-valued labels and panels, native panel fade/lift, controlled
 * keys, roving tab focus and Arrow/Home/End navigation. React's deprecated
 * leafAnimation is accepted without rendering the removed leaf decoration.
 * Colours change immediately. Native ARIA keeps roles/selected/orientation;
 * browser DOM-id relationships remain outside the current native API.
 */

import { computed, defineComponent, ref, watch, type PropType, type VNodeChild } from "vue"
import { useGpuix, type EventPayload, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { renderContent } from "./content.js"
import { borderWidth, colors, fontSize, fonts, lineHeightBase, radius, spacing } from "../tokens.js"

export interface TabItem {
  /** 唯一 key */
  key: string
  /** 标签标题 */
  label: VNodeChild
  /** 面板内容（对应原库的 children）；不传时由与 key 同名的具名插槽渲染 */
  children?: VNodeChild
}

export interface TabsProps {
  /** 标签页配置列表 */
  items: TabItem[]
  /** 当前激活标签 (v-model) — 受控 */
  modelValue?: string
  /** 当前激活标签 — 受控，优先级高于 modelValue */
  activeKey?: string
  /** 默认激活标签（非受控） */
  defaultActiveKey?: string
  /** 原库的叶子摆动动画；GPUIV 无 CSS 动画，此参数仅为对齐 API 保留 */
  leafAnimation?: boolean
  /** 是否显示选中状态阴影 */
  shadow?: boolean
  /** 无可见标题时给 tablist 一个无障碍标签 */
  ariaLabel?: string
}

export const Tabs = defineComponent({
  name: "AnimalTabs",
  inheritAttrs: false,
  props: {
    items: { type: Array as PropType<TabItem[]>, required: true },
    modelValue: { type: String as PropType<string | undefined>, default: undefined },
    activeKey: { type: String as PropType<string | undefined>, default: undefined },
    defaultActiveKey: { type: String, default: undefined },
    leafAnimation: { type: Boolean, default: true },
    shadow: { type: Boolean, default: true },
    ariaLabel: { type: String, default: undefined },
    onChange: { type: Function as PropType<(key: string) => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const gpuix = useGpuix()
    // 内部 state，仅在非受控（未传 activeKey/modelValue）时使用
    const internalKey = ref(props.defaultActiveKey ?? props.items[0]?.key ?? "")
    const focusedKey = ref<string | null>(null)
    const tabIds = new Map<string, number>()

    const activeKey = computed(() =>
      props.activeKey !== undefined
        ? props.activeKey
        : props.modelValue !== undefined
          ? props.modelValue
          : internalKey.value
    )
    const activeItem = computed(() => props.items.find((i) => i.key === activeKey.value))

    // 非受控时 items 变化导致内部 key 失效则回落到第一项（与原库一致）
    watch(
      () => props.items,
      (list) => {
        if (props.activeKey !== undefined || props.modelValue !== undefined) return
        if (!list.find((i) => i.key === internalKey.value)) internalKey.value = list[0]?.key ?? ""
      }
    )

    function select(key: string) {
      if (props.activeKey === undefined && props.modelValue === undefined) internalKey.value = key
      ;(attrs["onUpdate:modelValue"] as ((key: string) => void) | undefined)?.(key)
      props.onChange?.(key)
    }

    // 左右方向键/Home/End 切换激活标签并移动焦点（roving tabindex）
    function handleArrowKeys(e: EventPayload) {
      const items = props.items
      const idx = items.findIndex((i) => i.key === activeKey.value)
      if (idx < 0) return
      let nextIdx = idx
      switch (e.key) {
        case "right":
          nextIdx = (idx + 1) % items.length
          break
        case "left":
          nextIdx = (idx - 1 + items.length) % items.length
          break
        case "home":
          nextIdx = 0
          break
        case "end":
          nextIdx = items.length - 1
          break
        default:
          return
      }
      const nextKey = items[nextIdx].key
      select(nextKey)
      const id = tabIds.get(nextKey)
      if (id != null) gpuix.renderer?.focusElement?.(id)
    }

    return () => {
      const c = colors
      const current = activeItem.value
      // A v-model listener must not leak onto the host div as an event prop.
      const { "onUpdate:modelValue": _vModelListener, ...forwardAttrs } = attrs

      const containerStyle: StyleDesc = {
        backgroundColor: c.bg,
        borderRadius: radius.lg,
        borderWidth,
        borderColor: c.borderLight,
        overflow: "hidden",
        ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
        ...(attrs.style as StyleDesc | undefined),
      }

      return (
        <div {...forwardAttrs} testId={props.testId} style={containerStyle}>
          <div
            role="tablist"
            aria-label={props.ariaLabel}
            aria-orientation="horizontal"
            style={{
              display: "flex",
              gap: spacing.xs,
              padding: spacing.lg,
              backgroundColor: "rgba(255, 255, 255, 0.6)",
              borderBottomWidth: borderWidth,
              borderBottomColor: c.borderLight,
            }}
          >
            {props.items.map((item) => {
              const isActive = item.key === activeKey.value
              const itemStyle: StyleDesc = {
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: spacing.sm,
                paddingTop: spacing.sm,
                paddingBottom: spacing.sm,
                paddingLeft: spacing.lg,
                paddingRight: spacing.lg,
                borderRadius: radius.lg,
                cursor: "pointer",
                fontSize: fontSize.base,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "#fff9e3" : c.text,
                userSelect: "none",
                ...(isActive
                  ? {
                      backgroundColor: "#0cc0b5",
                      // `box-shadow: 0 3px 0 0 @shadow-color-light`
                      ...(props.shadow
                        ? {
                            boxShadow: {
                              offsetX: 0,
                              offsetY: 3,
                              blurRadius: 0,
                              spreadRadius: 0,
                              color: "rgba(61, 52, 40, 0.08)",
                            },
                          }
                        : {}),
                    }
                  : { hover: { backgroundColor: "rgba(25, 200, 185, 0.1)" } }),
                ...(focusedKey.value === item.key
                  ? { outline: { width: 2, color: c.warning, offset: 2 } }
                  : {}),
              }
              return (
                <div
                  key={item.key}
                  ref={(el: HostNode | null) => {
                    if (el?.id != null) tabIds.set(item.key, el.id)
                    else tabIds.delete(item.key)
                  }}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => select(item.key)}
                  onKeyDown={(e: EventPayload) => {
                    if (e.key === "enter" || e.key === "space" || e.key === " ") select(item.key)
                    else handleArrowKeys(e)
                  }}
                  onFocus={() => (focusedKey.value = item.key)}
                  onBlur={() => (focusedKey.value = null)}
                  style={itemStyle}
                >
                  <text style={{ fontSize: isActive ? 12 : 10, color: c.text, lineHeight: isActive ? 12 : 10 }}>
                    {isActive ? "●" : "○"}
                  </text>
                  {renderContent(item.label)}

                </div>
              )
            })}
          </div>
          <div key={activeKey.value} role="tabpanel" tabIndex={0}
            motion={{ initial: { opacity: 0, top: 4 }, animate: { opacity: 1, top: 0 }, transition: { duration: 0.25, ease: "ease" } }}
            style={{ position: "relative", minHeight: 60, padding: spacing.xl }}>
            <div
              style={{ minHeight: 40, color: c.textSecondary, fontSize: fontSize.base, lineHeight: fontSize.base * lineHeightBase }}
            >
              {current?.children !== undefined ? renderContent(current.children) : current ? slots[current.key]?.({ item: current }) : null}
            </div>
          </div>
        </div>
      )
    }
  },
})

export default Tabs
