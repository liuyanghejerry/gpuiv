/** Radio — GPUIV port of animal-island-vue's `Radio.vue`.
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - 源码是 options 驱动的 Radio.Group：原生 `<input type="radio">` + `<label>`
 *    → 每行一个 `role="radio"` 的 div，整行可点（同原 label），容器
 *    `role="radiogroup"`；原生 name 分组由单一受控值替代。
 *  - 选中标记在源码里与 Checkbox 是同一个 ✓ svg path（圆圈内白色对勾，
 *    `viewBox 0 0 15 14` stroke-width 3），不是内实心圆点 —— 按源码保真；
 *    圆形外圈 18/22/28px、2px 描边、奶油底/primary 填充等数值取自 Less。
 *  - ✓ 描边生长动画（`stroke-dashoffset` transition）+ `animal-radio-splash`
 *    六向墨点 keyframes → 砍掉（GPUIV 无路径动画/CSS 动画/多阴影），
 *    对勾静态出现。
 *  - roving tabindex + Arrow/Home/End 漫游选择保留：GPUIV 键盘事件不冒泡，
 *    handler 放在每一行（同 Rate.tsx），选中后通过 `renderer.focusElement`
 *    把焦点移到新行；Enter/Space 经 activationKeys 激活当前行（原生 radio
 *    的空格选中）。重复选中同一项不重复触发 onChange（对齐原生 change
 *    语义，源码靠浏览器隐含保证）。
 *  - `transition: border-color / color` → 状态色即时切换；label
 *    `letter-spacing: 0.01em` 砍掉（不支持）。
 *  - `:focus-visible` 黄圈 → onFocus/onBlur + roving index 驱动的圆圈 outline
 *    （#ffcc00 = Less @focus-yellow，offset 2，同 Switch.tsx 做法）。
 */

import { computed, defineComponent, ref, watch, type PropType } from "vue"
import { useGpuix, type EventPayload, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { borderWidth, colors, fontSize, fonts, spacing } from "../tokens.js"
import { activationKeys } from "../interaction.js"

export type RadioSize = "small" | "middle" | "large"
export type RadioValue = string | number

export interface RadioOption {
  /** 选项标签 */
  label: string | number
  /** 选项值 */
  value: RadioValue
  /** 是否禁用该选项 */
  disabled?: boolean
}

const geometry: Record<RadioSize, { box: number; checkW: number; checkH: number; fontSize: number }> = {
  small: { box: 18, checkW: 10, checkH: 9, fontSize: fontSize.sm },
  middle: { box: 22, checkW: 12, checkH: 11, fontSize: fontSize.base },
  large: { box: 28, checkW: 15, checkH: 14, fontSize: fontSize.lg },
}

/** Same check artwork as Checkbox.vue (`viewBox 0 0 15 14`, round caps). */
function checkDataUrl(stroke: string): string {
  const svg =
    `<svg viewBox="0 0 15 14" xmlns="http://www.w3.org/2000/svg" fill="none"` +
    ` stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M2 8.36364L6.23077 12L13 2"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const checkUrl = { active: checkDataUrl("#ffffff"), disabled: checkDataUrl(colors.textDisabled) }

export const Radio = defineComponent({
  name: "AnimalRadio",
  inheritAttrs: false,
  props: {
    /** 选中的值（受控，对应 v-model） */
    modelValue: { type: [String, Number] as PropType<RadioValue | undefined>, default: undefined },
    /** 选中的值（受控，优先于 modelValue） */
    value: { type: [String, Number] as PropType<RadioValue | undefined>, default: undefined },
    /** 默认选中的值（非受控初始值） */
    defaultValue: { type: [String, Number] as PropType<RadioValue | undefined>, default: undefined },
    /** 选项列表 */
    options: { type: Array as PropType<RadioOption[]>, required: true },
    size: { type: String as PropType<RadioSize>, default: "middle" },
    disabled: { type: Boolean, default: false },
    /** 布局方向 */
    direction: { type: String as PropType<"horizontal" | "vertical">, default: "horizontal" },
    onChange: { type: Function as PropType<(value: RadioValue) => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    const gpuix = useGpuix()
    const innerValue = ref<RadioValue | undefined>(props.defaultValue)

    // 受控判断：`value` 与 `modelValue` 均可作为受控值，value 优先
    const isControlled = computed(() => props.value !== undefined || props.modelValue !== undefined)
    const checkedValue = computed<RadioValue | undefined>(() => {
      if (props.value !== undefined) return props.value
      if (props.modelValue !== undefined) return props.modelValue
      return innerValue.value
    })

    // Roving tabindex：始终有一个选项可 Tab 到达，优先跟随选中项
    const focusedIndex = ref(Math.max(0, props.options.findIndex((o) => o.value === checkedValue.value)))
    const hasFocus = ref(false)
    const itemIds: Array<number | null> = []

    const enabledIndices = computed(() =>
      props.options
        .map((opt, idx) => ({ opt, idx }))
        .filter(({ opt }) => !props.disabled && !opt.disabled)
        .map(({ idx }) => idx),
    )

    // A disabled selected/first option must not remove every enabled tab stop.
    watch([checkedValue, enabledIndices], ([value, enabled]) => {
      const selected = props.options.findIndex((option) => option.value === value)
      if (enabled.includes(selected)) focusedIndex.value = selected
      else if (!enabled.includes(focusedIndex.value)) focusedIndex.value = enabled[0] ?? -1
    }, { immediate: true })

    function isChecked(value: RadioValue) {
      return checkedValue.value === value
    }

    function select(option: RadioOption) {
      if (props.disabled || option.disabled) return
      // 原生 radio 重复点击已选中项不触发 change
      if (checkedValue.value === option.value) return
      if (!isControlled.value) innerValue.value = option.value
      ;(attrs["onUpdate:modelValue"] as ((value: RadioValue) => void) | undefined)?.(option.value)
      props.onChange?.(option.value)
    }

    function handleKeyDown(e: EventPayload, opt: RadioOption, idx: number) {
      // Enter/Space 激活当前行（原生 radio 的空格选中）
      activationKeys(() => select(opt))(e)

      const enabled = enabledIndices.value
      if (enabled.length === 0) return
      const currentPos = enabled.indexOf(idx)
      let nextPos = -1
      switch (e.key) {
        case "right":
        case "down":
          nextPos = (currentPos + 1) % enabled.length
          break
        case "left":
        case "up":
          nextPos = (currentPos - 1 + enabled.length) % enabled.length
          break
        case "home":
          nextPos = 0
          break
        case "end":
          nextPos = enabled.length - 1
          break
        default:
          return
      }

      const nextIdx = enabled[nextPos]
      focusedIndex.value = nextIdx
      select(props.options[nextIdx])
      const id = itemIds[nextIdx]
      if (id != null) gpuix.renderer?.focusElement?.(id)
    }

    return () => {
      const c = colors
      const g = geometry[props.size]
      // A v-model listener must not leak onto the host div as an event prop.
      const { "onUpdate:modelValue": _vModelListener, ...forwardAttrs } = attrs

      return (
        <div
          {...forwardAttrs}
          role="radiogroup"
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
          {props.options.map((opt, idx) => {
            const checked = isChecked(opt.value)
            const rowDisabled = props.disabled || opt.disabled === true
            const focused = hasFocus.value && focusedIndex.value === idx && !rowDisabled

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
              // The row owns interaction; the painted circle must not cover it.
              pointerEvents: "none",
              width: g.box,
              height: g.box,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderWidth,
              borderRadius: g.box / 2,
              backgroundColor: rowDisabled ? c.bgDisabled : checked ? c.primary : "#f7f3df",
              borderColor: rowDisabled ? c.shadowSoft : checked ? c.primaryActive : c.textDisabled,
              ...(focused ? { outline: { width: 2, color: "#ffcc00", offset: 2 } } : {}),
            }

            return (
              <div
                key={String(opt.value)}
                ref={(el: HostNode | null) => {
                  itemIds[idx] = el?.id ?? null
                }}
                role="radio"
                aria-checked={checked}
                aria-disabled={rowDisabled || undefined}
                aria-label={String(opt.label)}
                tabIndex={!rowDisabled && idx === focusedIndex.value ? 0 : -1}
                onClick={rowDisabled ? undefined : () => select(opt)}
                onKeyDown={rowDisabled ? undefined : (e: EventPayload) => handleKeyDown(e, opt, idx)}
                onFocus={() => {
                  if (rowDisabled) return
                  focusedIndex.value = idx
                  hasFocus.value = true
                }}
                onBlur={() => (hasFocus.value = false)}
                style={rowStyle}
              >
                <div style={boxStyle}>
                  {checked ? (
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

export default Radio
