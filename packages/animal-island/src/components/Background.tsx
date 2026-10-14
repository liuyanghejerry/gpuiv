/** Background — ported from animal-island-vue Background.vue (MIT), #164.
 * Original dot, grid and three-layer sprinkle tiles are translated to SVG
 * patterns; scene SVGs use cover images. Texture dimensions follow painted
 * bounds, so the first texture appears after measurement. Child content paints
 * after decoration; decoration has no pointer or scroll hitbox.
 */

import { defineComponent, type PropType } from "vue"
import type { StyleDesc } from "@gpuiv/vue"
import { coffeeBreakScene, sweetCornerScene } from "../scene.js"
import { PatternSurface } from "../patterns.js"

/** 与原版 types.ts 的 BackgroundType 对齐。 */
export type BackgroundType =
  | "default"
  | "grid"
  | "dots-dark-green"
  | "sprinkles"
  | "sweet-corner"
  | "coffee-break"
  | "dots-pink"
  | "dots-purple"
  | "dots-blue"
  | "dots-yellow"
  | "dots-orange"
  | "dots-teal"
  | "dots-green"
  | "dots-red"
  | "dots-lime-green"
  | "dots-yellow-green"
  | "dots-brown"
  | "dots-warm-peach-pink"

/** 与原版 types.ts 的 BackgroundProps 对齐（children 经默认插槽传入）。 */
export interface BackgroundProps {
  type?: BackgroundType
}

/** 各类型底色（原版 Less 第三层 background 的实色）。 */
const BASE_BG: Record<BackgroundType, string> = {
  default: "rgb(247, 243, 223)",
  grid: "rgb(247, 243, 223)",
  "dots-dark-green": "#bfe3bf",
  sprinkles: "#fdf3e3",
  "sweet-corner": "#fdf3e3",
  "coffee-break": "#fdf3e3",
  "dots-pink": "#fde4e8",
  "dots-purple": "#f0e8ff",
  "dots-blue": "#e8edff",
  "dots-yellow": "#fff8e0",
  "dots-orange": "#fff0e8",
  "dots-teal": "#e8faf5",
  "dots-green": "#e8f5e8",
  "dots-red": "#ffe8e8",
  "dots-lime-green": "#f5f8e0",
  "dots-yellow-green": "#fffde8",
  "dots-brown": "#f5f0e0",
  "dots-warm-peach-pink": "#fff0e8",
}

/** 场景类型 → 场景图 fs 路径（原版 backgroundImage 由 JS 注入，对齐 React 版）。 */
const SCENE_SRC: Partial<Record<BackgroundType, string>> = {
  "sweet-corner": sweetCornerScene,
  "coffee-break": coffeeBreakScene,
}

export const Background = defineComponent({
  name: "AnimalBackground",
  inheritAttrs: false,
  props: {
    /** 背景图案类型（dots-* 底色与 Card pattern-* 系列一致），默认奶油色 */
    type: { type: String as PropType<BackgroundType>, default: "default" },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    return () => {
      const sceneSrc = SCENE_SRC[props.type]

      const style: StyleDesc = {
        position: "relative",
        width: "100%",
        minHeight: "100%",
        backgroundColor: BASE_BG[props.type],
        ...(attrs.style as StyleDesc | undefined),
      }

      return (
        <div {...attrs} testId={props.testId} style={style}>
          {sceneSrc ? (
            <img
              src={sceneSrc}
              alt=""
              objectFit="cover"
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            />
          ) : <PatternSurface pattern={props.type} />}
          {slots.default?.()}
        </div>
      )
    }
  },
})

export default Background
