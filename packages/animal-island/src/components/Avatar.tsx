/** Avatar — ported from animal-island-vue Avatar.vue (MIT), tracked in #164.
 * Retains dimensions, shape, image clipping, icon prop and default User icon.
 * Natural native text bounds drive gap-based font fitting. An invisible,
 * unshrunk measurement node keeps the base font size to avoid a feedback loop.
 * Failed images switch to the icon/slot fallback unless onError returns false.
 */

import { computed, defineComponent, inject, ref, watch, type InjectionKey, type PropType, type VNode, type VNodeChild } from "vue"
import { useElementBounds, type EventPayload, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { colors, fonts } from "../tokens.js"
import { Icon } from "./Icon.js"
import { imageEventMatches } from "./image-events.js"
import { renderContent } from "./content.js"

export type AvatarShape = "circle" | "square"
export type AvatarSize = "small" | "middle" | "large"

/** AvatarGroup 通过 provide / inject 下发给子 Avatar 的上下文（防止重复注入 props） */
export interface AvatarGroupContext {
  size?: number | AvatarSize
  shape?: AvatarShape
}

export const avatarGroupKey: InjectionKey<AvatarGroupContext> = Symbol("avatarGroup")

// 各预设尺寸对应的尺寸值与文字字号（px），自定义数字尺寸按 0.4 倍换算
const PRESET_SIZE: Record<AvatarSize, number> = { small: 32, middle: 40, large: 48 }
const PRESET_FONT: Record<AvatarSize, number> = { small: 14, middle: 16, large: 20 }

export const Avatar = defineComponent({
  name: "AnimalAvatar",
  inheritAttrs: false,
  props: {
    shape: { type: String as PropType<AvatarShape>, default: undefined },
    size: { type: [Number, String] as PropType<number | AvatarSize>, default: undefined },
    src: { type: String, default: undefined },
    alt: { type: String, default: undefined },
    gap: { type: Number, default: 4 },
    icon: { type: null as unknown as PropType<VNodeChild>, default: undefined },
    onError: { type: Function as PropType<() => boolean | void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const group = inject(avatarGroupKey, null)
    const failed = ref(false)
    watch(() => props.src, () => { failed.value = false }, { flush: "sync" })
    function handleError(event: EventPayload) {
      if (!props.src || !imageEventMatches(event, props.src)) return
      if (props.onError?.() !== false) failed.value = true
    }

    // 组级（group）只在子级未显式指定时生效
    const effSize = computed<number | AvatarSize>(() => props.size ?? group?.size ?? "middle")
    const effShape = computed<AvatarShape>(() => props.shape ?? group?.shape ?? "circle")

    const px = computed<number>(() => (typeof effSize.value === "number" ? effSize.value : PRESET_SIZE[effSize.value]))
    const fontPx = computed<number>(() =>
      typeof effSize.value === "number" ? Math.max(12, Math.round(px.value * 0.4)) : PRESET_FONT[effSize.value],
    )
    const textMeasure = ref<HostNode | null>(null)
    const { bounds } = useElementBounds(textMeasure)
    // Only the width participates in fitting. Scroll position polls do not
    // subscribe the component render or send new styles across the FFI.
    const measuredWidth = computed(() => bounds.value?.width ?? 0)
    const textScale = computed(() => {
      const available = px.value - Math.max(0, props.gap) * 2
      return available > 0 && measuredWidth.value > available ? available / measuredWidth.value : 1
    })

    function textContent(nodes: unknown): string {
      if (typeof nodes === "string" || typeof nodes === "number") return String(nodes)
      if (Array.isArray(nodes)) return nodes.map(textContent).join("")
      if (nodes && typeof nodes === "object" && "children" in nodes) return textContent((nodes as VNode).children)
      return ""
    }

    return () => {
      const hasImage = !!props.src && !failed.value
      const br = effShape.value === "square" ? 8 : 999
      const children = slots.default?.()
      const label = props.icon ? "" : textContent(children)

      const style: StyleDesc = {
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        overflow: "hidden",
        userSelect: "none",
        width: px.value,
        height: px.value,
        borderRadius: br,
        backgroundColor: colors.primaryBg,
        color: colors.primary,
        fontWeight: 600,
        fontSize: fontPx.value,
        whiteSpace: "nowrap",
        // 占位（图标/文字）形态：奶油色描边增加贴纸感
        ...(!hasImage ? { borderWidth: 2, borderColor: colors.bg } : {}),
        ...(attrs.style as StyleDesc | undefined),
      }

      return (
        <div
          {...attrs}
          role={hasImage ? undefined : "img"}
          aria-label={props.alt ?? (hasImage ? undefined : "avatar")}
          testId={props.testId}
          style={{ ...(fonts.sans ? { fontFamily: fonts.sans } : {}), ...style }}
        >
          {hasImage ? (
            <img
              key={props.src}
              src={props.src}
              alt={props.alt ?? ""}
              testId={props.testId ? `${props.testId}-img` : undefined}
              onError={handleError}
              objectFit="cover"
              style={{ width: "100%", height: "100%", borderRadius: br }}
            />
          ) : (
            props.icon ? renderContent(props.icon) : (label ? <>
              <div ref={textMeasure} style={{ position: "absolute", top: 0, left: 0, width: "auto", flexShrink: 0, opacity: 0, fontSize: fontPx.value, whiteSpace: "nowrap", pointerEvents: "none" }}><text>{label}</text></div>
              <div style={{ fontSize: fontPx.value * textScale.value, whiteSpace: "nowrap", flexShrink: 0, pointerEvents: "none" }}>{children}</div>
            </> : children ?? <Icon name="User" size={Math.round(px.value * 0.5)} />)
          )}
        </div>
      )
    }
  },
})

export default Avatar

/** Native public props, derived from the component's controlled runtime API. */
export type AvatarProps = InstanceType<typeof Avatar>["$props"] & { style?: StyleDesc }
