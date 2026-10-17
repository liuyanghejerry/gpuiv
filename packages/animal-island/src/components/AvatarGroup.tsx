/** AvatarGroup — ported from animal-island-vue AvatarGroup.vue (MIT).
 * Native style objects replace deep CSS selectors: child root attrs carry the
 * cream separation border and negative margin. Group size/shape are provided
 * reactively; explicit Avatar props take priority. Overflow uses an Avatar
 * circle so the +N marker has a defined native box instead of an inline span.
 */
import { Comment, Fragment, cloneVNode, defineComponent, h, provide, type PropType, type VNode } from "vue"
import type { StyleDesc } from "@gpuiv/vue"
import { colors } from "../tokens.js"
import { Avatar, avatarGroupKey, type AvatarShape, type AvatarSize } from "./Avatar.js"

export interface AvatarGroupProps {
  maxCount?: number
  maxStyle?: StyleDesc
  size?: number | AvatarSize
  shape?: AvatarShape
  /** Positive pixels of overlap, as in the original deep margin-left rule. */
  gap?: number
  testId?: string
}
function flatten(nodes: VNode[]): VNode[] {
  return nodes.flatMap((node) => node.type === Fragment ? flatten((node.children as VNode[] | null) ?? []) : node.type === Comment ? [] : [node])
}

export const AvatarGroup = defineComponent({
  name: "AnimalAvatarGroup",
  inheritAttrs: false,
  props: {
    maxCount: { type: Number, default: undefined },
    maxStyle: { type: Object as PropType<StyleDesc>, default: undefined },
    size: { type: [Number, String] as PropType<number | AvatarSize>, default: undefined },
    shape: { type: String as PropType<AvatarShape>, default: undefined },
    gap: { type: Number, default: 8 },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    provide(avatarGroupKey, { get size() { return props.size }, get shape() { return props.shape } })
    return () => {
      const children = flatten(slots.default?.() ?? [])
      const limit = props.maxCount != null && Number.isFinite(props.maxCount) && props.maxCount > 0 ? Math.max(1, Math.floor(props.maxCount)) : children.length
      const shown = children.slice(0, limit)
      const hidden = children.length - shown.length
      const overlap = Number.isFinite(props.gap) ? props.gap : 8
      const border: StyleDesc = { borderWidth: 2, borderColor: colors.bg }
      return <div {...attrs} role="group" testId={props.testId}
        style={{ display: "flex", alignItems: "center", ...(attrs.style as StyleDesc | undefined) }}>
        {shown.map((child, index) => cloneVNode(child, { style: { ...border, ...(index > 0 ? { marginLeft: -overlap } : {}) } }))}
        {hidden > 0 ? h(Avatar, { shape: "circle", size: props.size, alt: `还有 ${hidden} 个头像`, testId: props.testId ? `${props.testId}-more` : undefined,
          "aria-label": `还有 ${hidden} 个头像`, style: { ...border, marginLeft: -overlap, fontSize: 14, ...props.maxStyle } }, { default: () => h("text", `+${hidden}`) }) : null}
      </div>
    }
  },
})
export default AvatarGroup
