/** Select — ported from animal-island-vue Select.vue (MIT), tracked in #164.
 * Platform headless Select owns the mounted-item registry, dismissal and focus.
 * Original white trigger, yellow 28px popup, amber selection bar and hover
 * arrow are retained. The arrow changes direction without CSS rotation.
 * Home/End follow the platform's enabled mounted items; fade applies to popup children.
 * Native layout fills a row by default; pass a width to shrink the trigger.
 */

import { computed, defineComponent, ref, type PropType } from "vue"
import {
  motion,
  Select as PlatformSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  type SelectItemState,
  type SelectTriggerState,
  type StyleDesc,
} from "@gpuiv/vue"
import { borderWidth, colors, ease, fontSize, fonts, height, radius, shadows, spacing } from "../tokens.js"

export interface SelectOption {
  key: string
  label: string
}

export type SelectSize = "small" | "middle" | "large"

export interface SelectProps {
  value?: string
  modelValue?: string
  defaultValue?: string
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  size?: SelectSize
  ariaLabel?: string
  ariaLabelledBy?: string
  onChange?: (value: string) => void
  testId?: string
}

/* 组件局部色（取自原版 Less，tokens 无对应 token） */
const TRIGGER_BORDER = "#e8dcc8"
const TRIGGER_BORDER_HOVER = "#d4c4a8"
const PLACEHOLDER_COLOR = "#a09080"
const OPEN_BG = "#fffdf7"
const DISABLED_BG = "#f5f5f0"

/** 原版内联的是 stroke=currentColor 的 chevron；GPUIV <svg> 是单色着色
 *  渲染器，笔画烘焙为 #000，墨色由 style.color 提供（同 Icon.tsx）。 */
function chevronDataUrl(path: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="${path}" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`
}

const chevronDownUrl = chevronDataUrl("M3 4.5L6 7.5L9 4.5")
const chevronUpUrl = chevronDataUrl("M3 7.5L6 4.5L9 7.5")
const hoverArrowUrl = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 14"><path d="M0 0L10 7L0 14Z"/></svg>').toString("base64")}`

interface SelectSizeGeometry {
  height: number
  fontSize: number
  paddingX: number
  optionFontSize: number
  optionPadY: number
}

const sizeGeometry: Record<SelectSize, SelectSizeGeometry> = {
  small: { height: height.sm, fontSize: fontSize.sm, paddingX: spacing.md, optionFontSize: fontSize.sm, optionPadY: spacing.sm },
  // middle 档即原版：padding 8px 13px、font-size 14、选项 10px 竖向内边距
  middle: { height: height.base, fontSize: fontSize.base, paddingX: 13, optionFontSize: fontSize.base, optionPadY: 10 },
  large: { height: height.lg, fontSize: fontSize.lg, paddingX: spacing.lg, optionFontSize: fontSize.lg, optionPadY: spacing.md },
}

export const Select = defineComponent({
  name: "AnimalSelect",
  inheritAttrs: false,
  props: {
    /** 选中项 key（受控，优先于 modelValue） */
    value: { type: String as PropType<string | undefined>, default: undefined },
    /** 选中项 key（受控，对应 v-model） */
    modelValue: { type: String as PropType<string | undefined>, default: undefined },
    /** 默认选中项 key（非受控初始值） */
    defaultValue: { type: String, default: undefined },
    options: { type: Array as PropType<SelectOption[]>, required: true },
    placeholder: { type: String, default: "请选择" },
    disabled: { type: Boolean, default: false },
    size: { type: String as PropType<SelectSize>, default: "middle" },
    /** 对外暴露的无障碍标签（无可见 label 时使用） */
    ariaLabel: { type: String, default: undefined },
    /** 关联外部可见 label 的 id */
    ariaLabelledBy: { type: String, default: undefined },
    onChange: { type: Function as PropType<(value: string) => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    const innerValue = ref<string | undefined>(props.defaultValue === "" ? undefined : props.defaultValue)
    const openState = ref(false)
    const focused = ref(false)

    // 受控判断：`value` 与 `modelValue` 均可作为受控值，value 优先
    const isControlled = computed(() => props.value !== undefined || props.modelValue !== undefined)
    const controlledValue = computed(() => {
      const raw = props.value !== undefined ? props.value : props.modelValue
      return raw === "" || raw === undefined ? undefined : raw
    })
    const currentValue = computed(() => (isControlled.value ? controlledValue.value : innerValue.value))
    const currentLabel = computed(() => {
      const v = currentValue.value
      if (v === undefined) return props.placeholder
      return props.options.find((o) => o.key === v)?.label ?? props.placeholder
    })

    function handleValueChange(next: string) {
      if (!isControlled.value) innerValue.value = next
      props.onChange?.(next)
      ;(attrs["onUpdate:modelValue"] as ((value: string) => void) | undefined)?.(next)
    }

    return () => {
      const c = colors
      const g = sizeGeometry[props.size]
      const hasValue = currentValue.value !== undefined
      // A v-model listener must not leak onto the Root wrapper as an event prop.
      const {
        "onUpdate:modelValue": _vModelListener,
        style: userStyle,
        onOpenChange: userOpenChange,
        ...forwardAttrs
      } = attrs

      const triggerStyle = (state: SelectTriggerState): StyleDesc => {
        const style: StyleDesc = {
          // position:relative 让内嵌的 SelectContent 锚定到触发器本身
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.sm,
          width: "100%",
          minWidth: 140,
          height: g.height,
          paddingLeft: g.paddingX,
          paddingRight: g.paddingX,
          backgroundColor: "#ffffff",
          borderWidth,
          borderColor: TRIGGER_BORDER,
          borderRadius: 12,
          fontSize: g.fontSize,
          whiteSpace: "nowrap",
          userSelect: "none",
          cursor: state.disabled ? "not-allowed" : "pointer",
          ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
        }
        if (state.disabled) {
          style.backgroundColor = DISABLED_BG
          style.opacity = 0.5
        } else if (state.open) {
          // 原版展开期间锁定 hover 底色，避免底色闪动
          style.backgroundColor = "#ffffff"
          style.borderColor = TRIGGER_BORDER_HOVER
        } else {
          style.hover = { backgroundColor: OPEN_BG, borderColor: TRIGGER_BORDER_HOVER }
        }
        if (focused.value && !state.disabled) style.outline = { width: 2, color: c.primary, offset: 2 }
        return style
      }

      const panelStyle: StyleDesc = {
        paddingTop: spacing.md,
        paddingBottom: spacing.md,
        backgroundColor: "#ffeea0",
        borderRadius: 28,
        userSelect: "none",
        ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
      }

      const itemStyle = (state: SelectItemState): StyleDesc => ({
        display: "flex",
        position: "relative",
        alignItems: "center",
        justifyContent: "center",
        paddingTop: g.optionPadY,
        paddingBottom: g.optionPadY,
        paddingLeft: 14,
        paddingRight: 30,
        fontSize: g.optionFontSize,
        fontWeight: state.highlighted || state.selected ? 700 : 500,
        color: "#725d42",
        // 行填充必须在 item 自己身上（扁平命中列表，子元素填充会盖住点击）
        backgroundColor: "#ffeea0",
        whiteSpace: "nowrap",
        userSelect: "none",
        cursor: "pointer",
      })

      // SelectTrigger 的声明 props 只有 disabled/tabIndex；role/aria/testId/
      // onFocus 等 fallthrough attrs 经展开对象传入（字面量属性会被 TSX 严格
      // 检查拒绝），运行时由平台组件原样合并到宿主 div 上。
      const triggerAttrs: Record<string, unknown> = {
        role: "combobox",
        "aria-haspopup": "listbox",
        "aria-expanded": openState.value || undefined,
        "aria-label": props.ariaLabel,
        "aria-labelledby": props.ariaLabelledBy,
        "aria-disabled": props.disabled || undefined,
        testId: props.testId,
        onFocus: () => (focused.value = true),
        onBlur: () => (focused.value = false),
      }

      return (
        <PlatformSelect
          {...forwardAttrs}
          value={props.value !== undefined ? props.value : props.modelValue}
          defaultValue={props.defaultValue === "" ? undefined : props.defaultValue}
          disabled={props.disabled}
          onValueChange={handleValueChange}
          onOpenChange={(open: boolean) => {
            openState.value = open
            ;(userOpenChange as ((open: boolean) => void) | undefined)?.(open)
          }}
          style={userStyle as StyleDesc | undefined}
        >
          <SelectTrigger {...triggerAttrs} style={triggerStyle}>
            <text
              style={{
                color: hasValue ? c.warmSoft : PLACEHOLDER_COLOR,
                fontWeight: hasValue ? 600 : 400,
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {currentLabel.value}
            </text>
            <svg
              aria-hidden={true}
              src={openState.value ? chevronUpUrl : chevronDownUrl}
              style={{
                width: 12,
                height: 12,
                flexShrink: 0,
                color: openState.value && !props.disabled ? c.primary : PLACEHOLDER_COLOR,
                pointerEvents: "none",
              }}
            />
            <SelectContent {...{ role: "listbox", testId: props.testId ? `${props.testId}-popup` : undefined }} side="right" align="center" sideOffset={6} style={panelStyle}>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease }}>
                {props.options.map((option) => (
                  <SelectItem key={option.key} {...{ role: "option", "aria-selected": currentValue.value === option.key, testId: props.testId ? `${props.testId}-option-${option.key}` : undefined }} value={option.key} style={itemStyle}>
                    {(state: SelectItemState) => (
                      <div style={{ display: "flex", alignItems: "center", pointerEvents: "none" }}>
                        {state.selected ? <div style={{ position: "absolute", left: 20, right: 20, top: (g.optionPadY * 2 + g.optionFontSize * 1.5) * 0.56 - 7, height: 14, borderRadius: 7, backgroundColor: "rgba(255, 204, 0, 0.3)", pointerEvents: "none" }} /> : null}
                        <div
                          style={{
                            width: 16,
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {state.highlighted ? <svg src={hoverArrowUrl} style={{ position: "absolute", left: -14, top: g.optionPadY + (g.optionFontSize * 1.5 - 14) / 2, width: 10, height: 14, color: "#f5a623", pointerEvents: "none" }} /> : null}
                        </div>
                        <text>{option.label}</text>
                      </div>
                    )}
                  </SelectItem>
                ))}
              </motion.div>
            </SelectContent>
          </SelectTrigger>
        </PlatformSelect>
      )
    }
  },
})

export default Select
