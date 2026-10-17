/** Badge — GPUIV port of animal-island-vue's `Badge.vue`.
 *
 *  Ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT).
 *
 *  Fidelity notes (see issue #164):
 *  - The original centres the indicator on the anchor's top-right corner with
 *    `top: 0; right: 0; transform: translate(50%, -50%)`. GPUIV has no
 *    transforms, so the port uses fixed negative offsets (medium −10px,
 *    small −8px, dot −5px) — exact for circles, slightly tighter than the
 *    original for wide capsules (whose 50%-of-width shift it cannot measure).
 *  - The entrance uses native opacity motion; scale remains unsupported.
 *  - The native `title` tooltip is dropped (GPUIV divs have no tooltips), as
 *    is `z-index` (later children paint on top).
 *  - Colours reuse `cardSolid` from the tokens — the palette is identical to
 *    the original's `animal-badge--color-*` classes.
 */

import { computed, defineComponent, type PropType, type VNodeChild } from "vue"
import { motion, type StyleDesc } from "@gpuiv/vue"
import { cardSolid, colors, fonts, shadows } from "../tokens.js"

export type BadgeSize = "small" | "medium"
export type BadgeColor = keyof typeof cardSolid

/** 全角 / CJK 字符在正圆里会顶破圆直径：CJK 部首与汉字、兼容汉字、全角与半角形式 */
const FULLWIDTH = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/

/** 1 到 99 这类 1–2 位内容锁成正圆；「100」「99+」等 3 位以上、以及两格全角字回退为胶囊 */
const CIRCLE_MAX_LENGTH = 2

/** 纯数字或纯数字字符串才参与封顶换算，其余内容原样展示 */
const toNumeric = (value: VNodeChild): number | null => {
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value)
  return null
}

const fitsCircle = (value: VNodeChild): boolean => {
  // 数字按其显示文本量长度，这样 100 / 1000 自动落回胶囊，与字符串走同一套判定
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : null
  if (text === null || text.length === 0 || text.length > CIRCLE_MAX_LENGTH) return false
  return !(text.length === CIRCLE_MAX_LENGTH && FULLWIDTH.test(text))
}

// 字号按内腔算：2px 奶油描边吃掉 4px，medium 的 20px 圆只剩 16px 内腔，
// 因此字号比正文降档（与原版一致）。
const SIZES: Record<BadgeSize, { h: number; minW: number; padX: number; fontSize: number; offset: number }> = {
  medium: { h: 20, minW: 20, padX: 6, fontSize: 10, offset: 10 },
  small: { h: 16, minW: 16, padX: 4, fontSize: 9, offset: 8 },
}
const DOT = 10

export const Badge = defineComponent({
  name: "AnimalBadge",
  inheritAttrs: false,
  props: {
    count: { type: null as unknown as PropType<VNodeChild>, default: undefined },
    overflowCount: { type: Number, default: 99 },
    showZero: { type: Boolean, default: false },
    dot: { type: Boolean, default: false },
    size: { type: String as PropType<BadgeSize>, default: "medium" },
    color: { type: String as PropType<BadgeColor>, default: "app-red" },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const numeric = computed(() => toNumeric(props.count))
    // 封顶：仅数字参与换算，100 → "99+"
    const displayCount = computed(() =>
      numeric.value !== null && numeric.value > props.overflowCount ? `${props.overflowCount}+` : props.count,
    )
    const isZero = computed(() => displayCount.value === 0 || displayCount.value === "0")
    const showAsDot = computed(() => props.dot && !isZero.value)
    // 空字符串（含纯空白）与 null / undefined 一样视为无内容，避免渲染出空心胶囊
    const isEmpty = computed(
      () => props.count === undefined || props.count === null || (typeof props.count === "string" && props.count.trim() === ""),
    )
    // #count 插槽自带内容，不参与空值判断
    const hasCountSlot = computed(() => Boolean(slots.count))
    // 无内容，或数值为 0 且未开启 showZero，且不是小圆点时整体隐藏
    const isHidden = computed(
      () => !showAsDot.value && (hasCountSlot.value ? false : isEmpty.value || (isZero.value && !props.showZero)),
    )
    // 不传默认插槽即独立使用：角标不再相对某元素定位
    const isStandalone = computed(() => !slots.default)

    return () => {
      const spec = SIZES[props.size]
      const palette = cardSolid[props.color] ?? cardSolid["app-red"]
      const standalone = isStandalone.value

      // 内容 ≤ 2 位时锁死 width == height，999 圆角才成立；dot 尺寸固定。
      let box: StyleDesc
      if (showAsDot.value) {
        box = { width: DOT, height: DOT }
      } else if (fitsCircle(displayCount.value)) {
        box = { width: spec.h, height: spec.h }
      } else {
        box = { minWidth: spec.minW, height: spec.h, paddingLeft: spec.padX, paddingRight: spec.padX }
      }
      const offset = showAsDot.value ? DOT / 2 : spec.offset

      const indicatorStyle: StyleDesc = {
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: standalone ? "relative" : "absolute",
        ...(standalone ? {} : { top: -offset, right: -offset }),
        backgroundColor: palette.bg,
        color: palette.text,
        fontWeight: 700,
        fontSize: spec.fontSize,
        lineHeight: spec.fontSize,
        whiteSpace: "nowrap",
        borderRadius: 999,
        // 奶油色描边把角标从被覆盖的元素上分离出来；独立使用时取消。
        borderWidth: 2,
        borderColor: standalone ? "transparent" : colors.bg,
        ...(standalone ? {} : { boxShadow: shadows.sm }),
        ...box,
      }

      return (
        <div
          {...attrs}
          testId={props.testId}
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            lineHeight: spec.fontSize,
            ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
            ...(attrs.style as StyleDesc | undefined),
          }}
        >
          {slots.default?.()}
          {isHidden.value ? null : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .2, ease: "easeOut" }} style={indicatorStyle}>
              {() => showAsDot.value ? null : slots.count?.() ?? (typeof displayCount.value === "string" || typeof displayCount.value === "number" ? <text>{String(displayCount.value)}</text> : displayCount.value)}
            </motion.div>
          )}
        </div>
      )
    }
  },
})

export default Badge

/** Native public props support strings, numbers, VNodes and count slots. */
export type BadgeProps = InstanceType<typeof Badge>["$props"] & { style?: StyleDesc }
