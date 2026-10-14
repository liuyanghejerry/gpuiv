/** Checkbox — GPUIV port of animal-island-vue's `Checkbox.vue`.
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - 源码是 options 驱动的 Checkbox.Group：原生 `<input type="checkbox">` +
 *    `<label>` → 每行一个 `role="checkbox"` 的 div，整行可点（同原 label），
 *    容器 `role="group"`。
 *  - 勾选框在源码 Less 里是圆形（`border-radius: 50%`），不是圆角方块 ——
 *    按源码保真为圆形；18/22/28px、2px 描边、奶油底 rgb(247,243,223)、
 *    选中填 @primary-color + @primary-color-active 描边等数值全部取自 Less。
 *  - ✓ 描边生长动画（`stroke-dasharray`/`stroke-dashoffset` 0.3s transition
 *    + 0.2s delay）→ 砍掉（GPUIV 无路径动画/transition）：同一 path 烘焙成
 *    data URL `<img>` 静态出现（白 / 禁用灰 #c4b89e 两份）。
 *  - `animal-cbx-splash` 六向墨点 keyframes（多层 box-shadow 扩散）→ 砍掉
 *    （GPUIV 无 CSS 动画，boxShadow 只支持单个结构化阴影）。
 *  - `indeterminate` 是移植扩展（源码没有）：option 级布尔，展示 primary
 *    填充 + 白色横杠，`aria-checked="mixed"`；纯展示态，由调用方经 options
 *    控制，不参与值逻辑。
 *  - `transition: border-color / color` → 状态色即时切换；label
 *    `letter-spacing: 0.01em` 砍掉（GPUIV 不支持）。
 *  - `:focus-visible` 黄圈 → onFocus/onBlur 驱动的勾选框 outline
 *    （#ffcc00 = Less @focus-yellow，offset 2，同 Switch.tsx 做法）。
 *  - 键盘激活：原生 input 靠浏览器空格切换 → 每行 tabIndex + activationKeys
 *    （Enter/Space）。
 */

import { computed, defineComponent, ref, type PropType } from "vue"
import type { StyleDesc } from "@gpuiv/vue"
import { borderWidth, colors, fontSize, fonts, spacing } from "../tokens.js"
import { activationKeys } from "../interaction.js"

export type CheckboxSize = "small" | "middle" | "large"
export type CheckboxValue = string | number

export interface CheckboxOption {
  /** 选项标签 */
  label: string | number
  /** 选项值 */
  value: CheckboxValue
  /** 是否禁用该选项 */
  disabled?: boolean
  /** 半选态（移植扩展，源码没有）：展示填充 + 横杠，纯展示 */
  indeterminate?: boolean
}

const geometry: Record<CheckboxSize, { box: number; checkW: number; checkH: number; fontSize: number }> = {
  small: { box: 18, checkW: 10, checkH: 9, fontSize: fontSize.sm },
  middle: { box: 22, checkW: 12, checkH: 11, fontSize: fontSize.base },
  large: { box: 28, checkW: 15, checkH: 14, fontSize: fontSize.lg },
}

/** The original check svg (`viewBox 0 0 15 14`, stroke-width 3, round caps). */
function checkDataUrl(stroke: string): string {
  const svg =
    `<svg viewBox="0 0 15 14" xmlns="http://www.w3.org/2000/svg" fill="none"` +
    ` stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M2 8.36364L6.23077 12L13 2"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const checkUrl = { active: checkDataUrl("#ffffff"), disabled: checkDataUrl(colors.textDisabled) }

export const Checkbox = defineComponent({
  name: "AnimalCheckbox",
  inheritAttrs: false,
  props: {
    /** 选中的值列表（受控，对应 v-model） */
    modelValue: { type: Array as PropType<CheckboxValue[] | undefined>, default: undefined },
    /** 选中的值列表（受控，优先于 modelValue） */
    value: { type: Array as PropType<CheckboxValue[] | undefined>, default: undefined },
    /** 默认选中的值列表（非受控初始值） */
    defaultValue: { type: Array as PropType<CheckboxValue[]>, default: () => [] },
    /** 选项列表 */
    options: { type: Array as PropType<CheckboxOption[]>, required: true },
    size: { type: String as PropType<CheckboxSize>, default: "middle" },
    disabled: { type: Boolean, default: false },
    /** 布局方向 */
    direction: { type: String as PropType<"horizontal" | "vertical">, default: "horizontal" },
    onChange: { type: Function as PropType<(value: CheckboxValue[]) => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    const innerValue = ref<CheckboxValue[]>([...props.defaultValue])
    const focusedValue = ref<CheckboxValue | null>(null)

    // 受控判断：`value` 与 `modelValue` 均可作为受控值，value 优先
    const isControlled = computed(() => props.value !== undefined || props.modelValue !== undefined)
    const checkedValues = computed<CheckboxValue[]>(() => {
      if (props.value !== undefined) return props.value
      if (props.modelValue !== undefined) return props.modelValue
      return innerValue.value
    })

    function isChecked(value: CheckboxValue) {
      return checkedValues.value.includes(value)
    }

    function toggle(option: CheckboxOption) {
      if (props.disabled || option.disabled) return
      const next = isChecked(option.value)
        ? checkedValues.value.filter((v) => v !== option.value)
        : [...checkedValues.value, option.value]
      if (!isControlled.value) innerValue.value = next
      ;(attrs["onUpdate:modelValue"] as ((value: CheckboxValue[]) => void) | undefined)?.(next)
      props.onChange?.(next)
    }

    return () => {
      const c = colors
      const g = geometry[props.size]
      // A v-model listener must not leak onto the host div as an event prop.
      const { "onUpdate:modelValue": _vModelListener, ...forwardAttrs } = attrs

      return (
        <div
          {...forwardAttrs}
          role="group"
          testId={props.testId}
          style={{
            ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
            display: "flex",
            flexWrap: "wrap",
            flexDirection: props.direction === "vertical" ? "column" : "row",
            gap: props.direction === "vertical" ? spacing.md : spacing.lg,
            ...(attrs.style as StyleDesc | undefined),
          }}
        >
          {props.options.map((opt) => {
            const checked = isChecked(opt.value)
            const indeterminate = opt.indeterminate === true
            const filled = checked || indeterminate
            const rowDisabled = props.disabled || opt.disabled === true
            const focused = focusedValue.value === opt.value && !rowDisabled

            const rowStyle: StyleDesc = {
              display: "flex",
              alignItems: "center",
              gap: spacing.sm,
              fontSize: g.fontSize,
              fontWeight: 500,
              // Label ink: warmSoft → text when checked → textDisabled when
              // disabled (the Less disabled block is last, so it wins).
              color: rowDisabled ? c.textDisabled : checked ? c.text : c.warmSoft,
              cursor: rowDisabled ? "not-allowed" : "pointer",
              userSelect: "none",
              ...(rowDisabled ? { opacity: 0.55, pointerEvents: "none" } : {}),
            }

            const boxStyle: StyleDesc = {
              // This painted circle is decoration; the row owns click/focus.
              // Filled descendants otherwise cover that row in GPUI's flat hit list.
              pointerEvents: "none",
              width: g.box,
              height: g.box,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderWidth,
              borderRadius: g.box / 2,
              backgroundColor: rowDisabled ? c.bgDisabled : filled ? c.primary : "#f7f3df",
              borderColor: rowDisabled ? c.shadowSoft : filled ? c.primaryActive : c.textDisabled,
              ...(focused ? { outline: { width: 2, color: "#ffcc00", offset: 2 } } : {}),
            }

            return (
              <div
                key={String(opt.value)}
                role="checkbox"
                aria-checked={indeterminate ? "mixed" : checked}
                aria-disabled={rowDisabled || undefined}
                aria-label={String(opt.label)}
                tabIndex={rowDisabled ? -1 : 0}
                onClick={rowDisabled ? undefined : () => toggle(opt)}
                onKeyDown={rowDisabled ? undefined : activationKeys(() => toggle(opt))}
                onFocus={() => (focusedValue.value = opt.value)}
                onBlur={() => (focusedValue.value = null)}
                style={rowStyle}
              >
                <div style={boxStyle}>
                  {indeterminate ? (
                    <div
                      style={{
                        width: g.checkW,
                        height: 3,
                        borderRadius: 2,
                        backgroundColor: rowDisabled ? c.textDisabled : "#ffffff",
                        pointerEvents: "none",
                      }}
                    />
                  ) : checked ? (
                    <img
                      src={rowDisabled ? checkUrl.disabled : checkUrl.active}
                      style={{ width: g.checkW, height: g.checkH, pointerEvents: "none" }}
                    />
                  ) : null}
                </div>
                <text>{String(opt.label)}</text>
              </div>
            )
          })}
        </div>
      )
    }
  },
})

export default Checkbox
