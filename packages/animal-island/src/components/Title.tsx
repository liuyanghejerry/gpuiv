/** Title — GPUIV port of animal-island-vue's Title.vue (MIT).
 * SVG decoration preserves ribbon tails/folds, front perspective/inset shade,
 * offset layer papers and the tab's real transparent diagonal cut. Text stays
 * in the native selectable text pipeline, independently of the decoration.
 *
 * Native adaptations: reserve space for overhanging tails/back paper; emit 2x
 * image pixels; project ribbon corner curves with cubic approximations. Native
 * text does not support letter spacing/text-shadow, and layer/tab hover scaling
 * is omitted because scaling the layout would move surrounding content.
 */
import { Comment, Fragment, Text, computed, defineComponent, isVNode, ref, type PropType, type VNodeChild } from "vue"
import { useElementBounds, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { fonts } from "../tokens.js"
import { createTitleDecoration } from "./title-decoration.js"

export type TitleSize = "small" | "middle" | "large"
export type TitleColor =
  | "default"
  | "app-pink"
  | "purple"
  | "app-blue"
  | "app-yellow"
  | "app-orange"
  | "app-teal"
  | "app-green"
  | "app-red"
  | "lime-green"
  | "yellow-green"
  | "brown"
  | "warm-peach-pink"
export type TitleVariant = "ribbon" | "layer" | "tab"

const sizeMap: Record<TitleSize, number> = { small: 14, middle: 20, large: 28 }

/** Four-role palette from Title.vue's scoped Less (`--rf` front, `--rb` back,
 *  `--rk` fold, `--rt` text). The Card palette in tokens.ts only carries
 *  bg/text pairs, so the title palette stays local to this file. */
const titleColors: Record<TitleColor, { front: string; back: string; fold: string; text: string }> = {
  default: { front: "#27d039", back: "#20992a", fold: "#115017", text: "#ffffff" },
  "app-pink": { front: "#f8a6b2", back: "#e06880", fold: "#a03060", text: "#ffffff" },
  purple: { front: "#b77dee", back: "#9050d0", fold: "#5a1a9a", text: "#ffffff" },
  "app-blue": { front: "#889df0", back: "#5068d8", fold: "#2030a0", text: "#ffffff" },
  "app-yellow": { front: "#f7cd67", back: "#d4a030", fold: "#8a6010", text: "#725d42" },
  "app-orange": { front: "#e59266", back: "#c06a30", fold: "#7a3a10", text: "#ffffff" },
  "app-teal": { front: "#82d5bb", back: "#40a880", fold: "#186048", text: "#ffffff" },
  "app-green": { front: "#8ac68a", back: "#509050", fold: "#205020", text: "#ffffff" },
  "app-red": { front: "#fc736d", back: "#d43030", fold: "#900010", text: "#ffffff" },
  "lime-green": { front: "#d1da49", back: "#90a010", fold: "#485800", text: "#3d5a1a" },
  "yellow-green": { front: "#ecdf52", back: "#c0b010", fold: "#706800", text: "#725d42" },
  brown: { front: "#9a835a", back: "#705830", fold: "#3a2810", text: "#ffffff" },
  "warm-peach-pink": { front: "#e18c6f", back: "#b85a30", fold: "#6a2a10", text: "#ffffff" },
}

/** Plain slot runs share one native text model, so copying an interpolation
 * does not insert line separators between its CJK/emoji/Latin pieces. Styled
 * text and component slots keep their VNodes and behaviour untouched.
 */
function plainSlotText(node: VNodeChild): string | null {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) {
    const parts = node.map(plainSlotText)
    return parts.some(part => part === null) ? null : parts.join("")
  }
  if (!isVNode(node)) return null
  if (node.type === Comment) return ""
  if (node.type === Text) return typeof node.children === "string" ? node.children : null
  if (node.type === Fragment || (node.type === "text" && Object.keys(node.props ?? {}).length === 0)) {
    if (typeof node.children === "string" || Array.isArray(node.children)) return plainSlotText(node.children)
  }
  return null
}

export const Title = defineComponent({
  name: "AnimalTitle",
  inheritAttrs: false,
  props: {
    size: { type: String as PropType<TitleSize>, default: "middle" },
    color: { type: String as PropType<TitleColor>, default: "default" },
    variant: { type: String as PropType<TitleVariant>, default: "ribbon" },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const surface = ref<HostNode | null>(null)
    const { bounds } = useElementBounds(surface)
    // Position samples change while scrolling. Only primitive dimensions
    // invalidate this computed SVG or the component's render/mutation path.
    const width = computed(() => bounds.value?.width ?? 0)
    const height = computed(() => bounds.value?.height ?? 0)
    const decoration = computed(() => width.value > 0 && height.value > 0
      ? createTitleDecoration(props.variant, sizeMap[props.size], width.value, height.value, titleColors[props.color])
      : null)

    return () => {
      const em = sizeMap[props.size], ribbon = props.variant === "ribbon", layer = props.variant === "layer"
      const art = decoration.value
      const children = slots.default?.()
      const text = children ? plainSlotText(children) : null
      return <div
        {...attrs}
        testId={props.testId}
        style={{
          fontFamily: fonts.sans, display: "flex", alignItems: "center", alignSelf: "flex-start", flexShrink: 0,
          paddingLeft: ribbon ? 0.6 * em : layer ? 0.26 * em : 0,
          paddingRight: ribbon ? 0.6 * em : 0,
          paddingTop: layer ? 0.3 * em : 0,
          paddingBottom: ribbon ? 0.4 * em : 0,
          fontSize: em, fontWeight: 900, lineHeight: em, color: titleColors[props.color].text,
          whiteSpace: "nowrap", userSelect: "text", ...(attrs.style as StyleDesc | undefined),
        }}
      >
        <div ref={surface} testId={props.testId ? `${props.testId}-surface` : undefined} style={{
          position: "relative", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          height: (layer ? 2.1 : 2) * em,
          paddingLeft: (ribbon ? 1.6 : layer ? 1.55 : 1.9) * em,
          paddingRight: (ribbon ? 1.6 : layer ? 1.55 : 1.5) * em,
          pointerEvents: "none",
        }}>
          {art ? <img src={art.src} objectFit="fill" aria-hidden={true}
            testId={props.testId ? `${props.testId}-decoration` : undefined}
            style={{ position: "absolute", left: art.left, top: art.top, width: art.width, height: art.height, pointerEvents: "none" }}
          /> : null}
          <text testId={props.testId ? `${props.testId}-text` : undefined}
            style={{ display: "flex", alignItems: "center", pointerEvents: "none", userSelect: "text", paddingTop: ribbon ? 0.11 * em : 0 }}
          >{text ?? children}</text>
        </div>
      </div>
    }
  },
})

export type TitleProps = Omit<InstanceType<typeof Title>["$props"], "style"> & { style?: StyleDesc }

export default Title
