/** Simplified menu primitive for Phase A.
 *
 * beautiful-ui's GlideMenu animates a highlight layer sliding to the
 * hovered row via getBoundingClientRect — requires element-bounds
 * query GPUIV does not expose yet (see gpuiv issue #110).
 * This replacement uses GPUUI's native hover pseudo-class style.
 */
import { defineComponent, h, type PropType } from "vue"
import type { StyleDesc } from "@gpuiv/vue"

export interface MenuRow { id: string; label: string }
export interface MenuProps {
  items: MenuRow[]
  activeId?: string
  onSelect?: (id: string) => void
  itemStyle?: StyleDesc
  activeItemStyle?: StyleDesc
}

export const Menu = defineComponent({
  name: "Menu",
  props: {
    items: { type: Array as PropType<MenuRow[]>, required: true },
    activeId: { type: String, default: undefined },
    onSelect: { type: Function as PropType<(id: string) => void>, default: undefined },
    itemStyle: { type: Object as PropType<StyleDesc>, default: undefined },
    activeItemStyle: { type: Object as PropType<StyleDesc>, default: undefined },
  },
  setup(props, { attrs, slots }) {
    return () => {
      const children = props.items.map((item) => {
        const active = props.activeId === item.id
        return h("div", {
          role: "button", tabIndex: 0, "aria-selected": active,
          onClick: () => props.onSelect?.(item.id),
          style: {
            position: "relative",
            ...(active ? (props.activeItemStyle ?? {}) : {}),
            ...(props.itemStyle ?? {}),
            hover: active ? props.activeItemStyle : { backgroundColor: "var(--hover)" },
          } as Record<string, unknown>,
        }, [item.label])
      })
      return h("div", { ...attrs, style: { display: "flex", flexDirection: "column", gap: 0 } as Record<string, unknown> }, children)
    }
  },
})
