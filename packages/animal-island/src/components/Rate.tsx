/** Rate — GPUIV port of animal-island-vue's `Rate.vue`.
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - The star keeps the original 48×48 StarIcon artwork (same path, stroke
 *    and two-eye "face") inlined as a data-URL `<img>` per state: unchecked
 *    shows the `#c4b89e` outline only (`fill-opacity: 0`); checked fills
 *    `#f5c31c` with a `#dba90e` stroke and visible eyes — the exact Less
 *    overrides on the icon.
 *  - React commit animations retain 60ms stagger, 0.55→1.15→1 pop geometry
 *    and a six-dot splash using native width/height/position/opacity targets.
 *    Two native motion stages replace CSS scale keyframes; state colours
 *    change immediately. No JS frame timer is used.
 *  - Hover lift keeps the original -1px offset via native `top` motion;
 *    the hover fill preview (`hoverValue`) is kept.
 *  - Native radio inputs → each star is a `role="radio"` div with the same
 *    roving tabindex and Arrow/Home/End keyboard model; focus moves through
 *    `renderer.focusElement` (GPUIV key events do not bubble, so the handler
 *    lives on each star instead of the group).
 *  - Half stars / custom characters / custom colours are not in the Vue
 *    source (values round to whole stars), so the port has neither.
 */

import { computed, defineComponent, ref, type PropType } from "vue"
import { useGpuix, type EventPayload, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { colors, fonts } from "../tokens.js"
import { RatingStarMotion, SelectionSplash } from "./selection-motion.js"

export type RateSize = "small" | "middle" | "large"

const geometry: Record<RateSize, { star: number; gap: number }> = {
  small: { star: 20, gap: 4 },
  middle: { star: 26, gap: 6 },
  large: { star: 34, gap: 8 },
}

/** StarIcon's path from the original `_svg-data.ts` (viewBox 0 0 48 48). */
const STAR_PATH = "M24 6 L29 18 L42 19 L32 28 L35 41 L24 34 L13 41 L16 28 L6 19 L19 18 Z"

function starDataUrl(active: boolean): string {
  const stroke = active ? colors.warningActive : colors.textDisabled
  const eyes = active
    ? `<circle cx="20" cy="22" r="1.3" fill="${colors.text}"/><circle cx="28" cy="22" r="1.3" fill="${colors.text}"/>`
    : ""
  const svg =
    `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" fill="none"` +
    ` stroke="${stroke}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${STAR_PATH}" fill="${colors.warning}" fill-opacity="${active ? 1 : 0}"/>${eyes}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const starUrl = { active: starDataUrl(true), inactive: starDataUrl(false) }

export const Rate = defineComponent({
  name: "AnimalRate",
  inheritAttrs: false,
  props: {
    /** 当前评分（受控，对应 v-model） */
    modelValue: { type: Number as PropType<number | undefined>, default: undefined },
    /** 当前评分（受控，优先于 modelValue） */
    value: { type: Number as PropType<number | undefined>, default: undefined },
    /** 默认评分（非受控初始值） */
    defaultValue: { type: Number, default: 0 },
    /** 星星总数 */
    count: { type: Number, default: 5 },
    size: { type: String as PropType<RateSize>, default: "middle" },
    /** 只读，仅展示不可交互 */
    readonly: { type: Boolean, default: false },
    /** 再次点击同一颗星时清空评分 */
    allowClear: { type: Boolean, default: true },
    onChange: { type: Function as PropType<(value: number) => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    const gpuix = useGpuix()
    const innerValue = ref(props.defaultValue)
    const hoverValue = ref(0)
    const focusedIndex = ref(0)
    const itemIds: Array<number | null> = []
    const burst = ref({ from: 0, to: 0, sequence: 0 })

    // 受控判断：`value` 与 `modelValue` 均可作为受控值，value 优先
    const isControlled = computed(() => props.value !== undefined || props.modelValue !== undefined)
    const rateValue = computed(() => {
      if (props.value !== undefined) return props.value
      if (props.modelValue !== undefined) return props.modelValue
      return innerValue.value
    })
    /** 把任意评分夹取成 [0, count] 的整数：小数就近取整，超出范围直接夹取 */
    const toStarCount = (value: number) => Math.min(props.count, Math.max(0, Math.round(value)))
    // 悬停预览：只读时始终展示真实评分
    const displayValue = computed(() => (!props.readonly && hoverValue.value > 0 ? hoverValue.value : rateValue.value))
    const filledCount = computed(() => toStarCount(displayValue.value))
    const checkedValue = computed(() => toStarCount(rateValue.value))

    function commit(next: number) {
      if (props.readonly || next === rateValue.value) return
      burst.value = { from: checkedValue.value, to: next, sequence: burst.value.sequence + 1 }
      if (!isControlled.value) innerValue.value = next
      // 清空后鼠标仍停在原处，重置预览才能立刻看到「已清空」
      if (next === 0) hoverValue.value = 0
      ;(attrs["onUpdate:modelValue"] as ((value: number) => void) | undefined)?.(next)
      props.onChange?.(next)
    }

    function handleStarClick(index: number) {
      if (props.allowClear && checkedValue.value === index) {
        commit(0)
        return
      }
      commit(index)
    }

    function handleKeyDown(e: EventPayload, index: number) {
      if (props.readonly) return

      // Native div radios have no browser-provided Space click.
      if (e.key === "enter" || e.key === "space" || e.key === " ") {
        handleStarClick(index)
        return
      }

      let next = 0
      switch (e.key) {
        case "right":
        case "up":
          next = Math.min(props.count, checkedValue.value + 1)
          break
        case "left":
        case "down":
          next = Math.max(1, checkedValue.value - 1)
          break
        case "home":
          next = 1
          break
        case "end":
          next = props.count
          break
        default:
          return
      }

      // 键盘选择同样要收起悬停预览，否则停在旧星星上的鼠标会盖住新评分
      hoverValue.value = 0
      const id = itemIds[next - 1]
      if (id != null) gpuix.renderer?.focusElement?.(id)
      commit(next)
    }

    return () => {
      const g = geometry[props.size]
      // 受控值可能是小数或超出范围，夹取后保证永远有一颗星可 Tab 到达
      const tabbable = checkedValue.value > 0 ? checkedValue.value : 1
      // A v-model listener must not leak onto the host div as an event prop.
      const { "onUpdate:modelValue": _vModelListener, ...forwardAttrs } = attrs

      return (
        <div
          {...forwardAttrs}
          role="radiogroup"
          aria-label="评分"
          aria-readonly={props.readonly || undefined}
          testId={props.testId}
          onMouseLeave={() => (hoverValue.value = 0)}
          style={{
            ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
            display: "flex",
            alignItems: "center",
            gap: g.gap,
            width: props.count * g.star + (props.count - 1) * g.gap,
            lineHeight: 1,
            userSelect: "none",
            ...(attrs.style as StyleDesc | undefined),
          }}
        >
          {Array.from({ length: props.count }, (_, i) => i + 1).map((index) => {
            const active = index <= filledCount.value
            const bursting = burst.value.to > burst.value.from && index > burst.value.from && index <= burst.value.to
            const splash = burst.value.to > burst.value.from && index === burst.value.to
            const itemStyle: StyleDesc = {
              position: "relative",
              width: g.star,
              height: g.star,
              flexShrink: 0,
              cursor: props.readonly ? "default" : "pointer",
              borderRadius: g.star / 2,
              ...(focusedIndex.value === index && !props.readonly
                ? { outline: { width: 2, color: colors.warning, offset: 1 } }
                : {}),
            }
            return (
              <div
                key={index}
                ref={(el: HostNode | null) => {
                  itemIds[index - 1] = el?.id ?? null
                }}
                role="radio"
                aria-checked={index === checkedValue.value}
                aria-label={`${index} 星`}
                tabIndex={!props.readonly && index === tabbable ? 0 : -1}
                onMouseEnter={props.readonly ? undefined : () => (hoverValue.value = index)}
                onClick={props.readonly ? undefined : () => handleStarClick(index)}
                onKeyDown={props.readonly ? undefined : (event: EventPayload) => handleKeyDown(event, index)}
                onFocus={() => (focusedIndex.value = index)}
                onBlur={() => (focusedIndex.value = 0)}
                style={itemStyle}
              >
                {splash && !props.readonly ? <SelectionSplash key={`splash-${burst.value.sequence}`} size={g.star} color={colors.warning} testId={props.testId ? `${props.testId}-splash-${index}` : undefined} /> : null}
                <RatingStarMotion key={bursting ? `star-${burst.value.sequence}` : "star"} size={g.star}
                  src={active ? starUrl.active : starUrl.inactive} burst={bursting && !props.readonly}
                  hovered={!props.readonly && hoverValue.value === index} delay={(index - 1 - burst.value.from) * 0.06}
                  testId={props.testId ? `${props.testId}-star-${index}` : undefined} />
              </div>
            )
          })}
        </div>
      )
    }
  },
})

export default Rate

/** Public native props inferred from the rating component. */
export type RateProps = Omit<InstanceType<typeof Rate>["$props"], "style"> & { style?: StyleDesc }
