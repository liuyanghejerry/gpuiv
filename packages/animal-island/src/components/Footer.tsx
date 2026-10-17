/** Footer — GPUIV port of animal-island-vue's `Footer.vue`.
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - 结构: 原版 `<footer>` 块级元素 + `text-align: center` → GPUIV `<div>` 上
 *    `textAlign: 'center'`（文本样式沿子树继承），文案落在 `<text>` 里；
 *    footer 语义用 `role="contentinfo"`（GPUIV 无 footer 元素，ARIA token
 *    映射到 AccessKit Role::ContentInfo）。
 *  - 样式: 原版 Less 精确值照搬 — color #807d75、font-size 12px、
 *    padding 16px 0（上下 16、左右 0）。footer 是页面级块，`width: '100%'`
 *    让居中生效（原版块级元素天然撑满父宽）。
 *  - `year` 缺省取当前年份（每次渲染动态求值，与原版 computed 一致）。
 */

import { defineComponent } from "vue"
import type { StyleDesc } from "@gpuiv/vue"
import { fontSize, fonts } from "../tokens.js"

export interface FooterProps {
  /** 版权文案，默认 `All Rights Reserved.` */
  text?: string
  /** 年份，默认取当前年份（动态获取） */
  year?: number
  testId?: string
}

/** 原版 Less 的 #807d75（tokens.ts 无此色，按原值保留为字面量）。 */
const FOOTER_COLOR = "#807d75"

export const Footer = defineComponent({
  name: "AnimalFooter",
  inheritAttrs: false,
  props: {
    text: { type: String, default: "All Rights Reserved." },
    year: { type: Number, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    return () => {
      const displayYear = props.year ?? new Date().getFullYear()
      return (
        <div
          {...attrs}
          role="contentinfo"
          testId={props.testId}
          style={{
            width: "100%",
            paddingTop: 16,
            paddingBottom: 16,
            textAlign: "center",
            color: FOOTER_COLOR,
            fontSize: fontSize.sm,
            ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
            ...(attrs.style as StyleDesc | undefined),
          }}
        >
          <text>{`© ${displayYear} ${props.text}`}</text>
        </div>
      )
    }
  },
})

export default Footer
