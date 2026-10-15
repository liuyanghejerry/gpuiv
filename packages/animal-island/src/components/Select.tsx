/** Select — ported from animal-island-vue Select.vue (MIT), tracked in #164.
 * Platform headless Select owns the mounted-item registry, dismissal and focus.
 * Original white trigger, yellow 28px popup, amber selection bar and hover
 * arrow are retained. The arrow changes direction without CSS rotation.
 * Popup defaults to above/start with an 8px gap; side/align remain configurable.
 * Home/End follow the platform's enabled mounted items; fade applies to popup children.
 * React's search/filter/clear APIs are retained. Search uses a native input and
 * FloatingLayer, keeps input focus, and handles native lowercase keys locally
 * because native key events do not bubble. Escape clears the query before closing.
 * Native layout fills a row by default; pass a width to shrink the trigger.
 */

import { computed, defineComponent, nextTick, ref, watch, type PropType, type VNodeChild } from "vue"
import {
  FloatingLayer,
  motion,
  Select as PlatformSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  type FloatingAlign,
  type FloatingSide,
  type SelectItemState,
  type SelectTriggerState,
  type StyleDesc,
  type EventPayload,
  type HostNode,
  useGpuix,
} from "@gpuiv/vue"
import { activationKeys } from "../interaction.js"
import { renderContent } from "./content.js"
import { ColorSurface, surfaceMotion } from "./surface-motion.js"
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
  allowClear?: boolean
  clearAriaLabel?: string
  showSearch?: boolean
  filterOption?: boolean | ((inputValue: string, option: SelectOption) => boolean)
  optionFilterProp?: "key" | "label"
  notFoundContent?: VNodeChild
  onSearch?: (value: string) => void
  onClear?: () => void
  size?: SelectSize
  side?: FloatingSide
  align?: FloatingAlign
  sideOffset?: number
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
    allowClear: { type: Boolean, default: false },
    clearAriaLabel: { type: String, default: "清除" },
    showSearch: { type: Boolean, default: false },
    filterOption: { type: [Boolean, Function] as PropType<SelectProps["filterOption"]>, default: true },
    optionFilterProp: { type: String as PropType<"key" | "label">, default: "label" },
    notFoundContent: { type: [String, Number, Object, Array, Boolean] as PropType<VNodeChild>, default: "暂无数据" },
    onSearch: { type: Function as PropType<(value: string) => void>, default: undefined },
    onClear: { type: Function as PropType<() => void>, default: undefined },
    size: { type: String as PropType<SelectSize>, default: "middle" },
    /** 弹层相对触发器的位置；默认上方弹出，与触发器左边缘对齐。 */
    side: { type: String as PropType<FloatingSide>, default: "top" },
    align: { type: String as PropType<FloatingAlign>, default: "start" },
    sideOffset: { type: Number, default: 8 },
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
    const hovered = ref(false)
    const clearHovered = ref(false)
    const clearFocused = ref(false)
    const searchValue = ref<string | null>(null)
    const activeKey = ref<string | null>(null)
    const searchInput = ref<HostNode | null>(null)
    const clearButton = ref<HostNode | null>(null)
    const searchRevision = ref(0)
    const { renderer } = useGpuix()

    // 受控判断：`value` 与 `modelValue` 均可作为受控值，value 优先
    const isControlled = computed(() => props.value !== undefined || props.modelValue !== undefined)
    const controlledValue = computed(() => {
      const raw = props.value !== undefined ? props.value : props.modelValue
      return raw === "" || raw === undefined ? undefined : raw
    })
    const currentValue = computed(() => (isControlled.value ? controlledValue.value : innerValue.value))
    watch([currentValue, () => props.disabled], ([value, disabled]) => {
      if (value === undefined || disabled) {
        clearHovered.value = false
        clearFocused.value = false
      }
    })
    const currentLabel = computed(() => {
      const v = currentValue.value
      if (v === undefined) return props.placeholder
      return props.options.find((o) => o.key === v)?.label ?? props.placeholder
    })
    const filteredOptions = computed(() => {
      const query = searchValue.value
      if (!props.showSearch || !props.filterOption || !query) return props.options
      const matcher = props.filterOption
      return props.options.filter(option => typeof matcher === "function" ? matcher(query, option) : option[props.optionFilterProp].toLowerCase().includes(query.toLowerCase()))
    })
    watch([openState, currentValue, filteredOptions], () => {
      if (!props.showSearch || !openState.value) { activeKey.value = null; return }
      if (filteredOptions.value.some(option => option.key === activeKey.value)) return
      activeKey.value = filteredOptions.value.find(option => option.key === currentValue.value)?.key ?? filteredOptions.value[0]?.key ?? null
    }, { flush: "sync" })

    function handleValueChange(next: string) {
      if (!isControlled.value) innerValue.value = next || undefined
      props.onChange?.(next)
      ;(attrs["onUpdate:modelValue"] as ((value: string) => void) | undefined)?.(next)
    }

    function setSearchOpen(open: boolean) {
      if (props.disabled && open) return
      if (openState.value === open) return
      openState.value = open
      if (!open) {
        if (searchValue.value) props.onSearch?.("")
        searchValue.value = null
      }
      ;(attrs.onOpenChange as ((open: boolean) => void) | undefined)?.(open)
      void nextTick(() => { if (searchInput.value?.id != null) renderer?.focusElement?.(searchInput.value.id) })
    }
    function handleSearchChange(event: EventPayload) {
      if (props.disabled) return
      const next = event.value ?? ""
      const label = currentValue.value === undefined ? "" : currentLabel.value
      // As in React, typing after an echoed label starts a new query.
      const query = searchValue.value === null && label && next.startsWith(label) ? next.slice(label.length) : next
      searchValue.value = query
      if (query !== next) searchRevision.value++
      props.onSearch?.(query)
      setSearchOpen(true)
    }
    function selectSearchOption(key: string) {
      if (props.disabled || !filteredOptions.value.some(option => option.key === key)) return
      handleValueChange(key)
      setSearchOpen(false)
    }
    function searchKeyDown(event: EventPayload) {
      if (props.disabled) return
      const key = event.key === " " ? "space" : event.key?.toLowerCase().replace(/^arrow/, "")
      if (!openState.value) {
        if (["enter", "space", "down", "up"].includes(key ?? "")) setSearchOpen(true)
        return
      }
      if (key === "escape") {
        if (searchValue.value) { searchValue.value = null; props.onSearch?.(""); searchRevision.value++ }
        else setSearchOpen(false)
      } else if (key === "enter") {
        if (activeKey.value !== null) selectSearchOption(activeKey.value)
      } else if (key === "home" || key === "end") {
        activeKey.value = (key === "home" ? filteredOptions.value[0] : filteredOptions.value.at(-1))?.key ?? null
      } else if (key === "down" || key === "up") {
        const options = filteredOptions.value
        if (!options.length) return
        const index = options.findIndex(option => option.key === activeKey.value)
        activeKey.value = options[(index + (key === "down" ? 1 : -1) + options.length) % options.length].key
      }
    }
    function clear() {
      if (props.disabled) return
      const focusTarget = props.showSearch ? searchInput.value?.id : clearButton.value?.parent?.id
      handleValueChange("")
      props.onClear?.()
      if (focusTarget != null) renderer?.focusElement?.(focusTarget)
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
        // The rounded panel owns the fill. Square row fills would cover its
        // corners; click/hover listeners still create whole-row hitboxes.
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
        "aria-label": props.ariaLabel ?? attrs["aria-label"],
        "aria-labelledby": props.ariaLabelledBy,
        "aria-disabled": props.disabled || undefined,
        testId: props.testId,
        onFocus: () => (focused.value = true),
        onBlur: () => (focused.value = false),
        onMouseEnter: () => (hovered.value = true),
        onMouseLeave: () => (hovered.value = false),
      }

      // A painted child has its own GPUI hover/focus hitbox. Keep the clear
      // control mounted while the pointer or keyboard focus moves onto it;
      // the input's blur must not destroy the target between down and up.
      const clearControl = () => props.allowClear && hasValue && !props.disabled && (hovered.value || focused.value || clearHovered.value || clearFocused.value) ? <ColorSurface
        hostRef={clearButton} role="button" aria-label={props.clearAriaLabel} tabIndex={0}
        testId={props.testId ? `${props.testId}-clear` : undefined} onClick={clear} onKeyDown={activationKeys(clear)}
        onMouseEnter={() => { clearHovered.value = true }} onMouseLeave={() => { clearHovered.value = false }}
        onFocus={() => { clearFocused.value = true }} onBlur={() => { clearFocused.value = false }}
        transition={{ duration: 0.15, ease }}
        style={{ width: 18, height: 18, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 999, color: PLACEHOLDER_COLOR, cursor: "pointer", pointerEvents: "auto", hover: { color: c.warmSoft, backgroundColor: "rgba(114, 93, 66, 0.1)" } }}
      >{() => <text>×</text>}</ColorSurface> : null
      const arrow = () => <svg aria-hidden={true} src={openState.value ? chevronUpUrl : chevronDownUrl} style={{ width: 12, height: 12, flexShrink: 0, color: openState.value && !props.disabled ? c.primary : PLACEHOLDER_COLOR, pointerEvents: "none" }} />
      const notFound = () => <div role="option" aria-disabled={true} aria-selected={false} testId={props.testId ? `${props.testId}-empty` : undefined} style={{ padding: 16, color: PLACEHOLDER_COLOR, fontSize: g.optionFontSize, textAlign: "center" }}>{renderContent(props.notFoundContent)}</div>
      const optionContent = (option: SelectOption, state: SelectItemState) => <div style={{ display: "flex", alignItems: "center", pointerEvents: "none" }}>
        {state.selected ? <div style={{ position: "absolute", left: 20, right: 20, top: (g.optionPadY * 2 + g.optionFontSize * 1.5) * 0.56 - 7, height: 14, borderRadius: 7, backgroundColor: "rgba(255, 204, 0, 0.3)", pointerEvents: "none" }} /> : null}
        <div style={{ width: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {state.highlighted ? <svg src={hoverArrowUrl} style={{ position: "absolute", left: -14, top: g.optionPadY + (g.optionFontSize * 1.5 - 14) / 2, width: 10, height: 14, color: "#f5a623", pointerEvents: "none" }} /> : null}
        </div><text>{option.label}</text>
      </div>

      if (props.showSearch) {
        const displayQuery = openState.value && searchValue.value !== null ? searchValue.value : hasValue ? currentLabel.value : ""
        return <div {...forwardAttrs} style={{ position: "relative", minWidth: 140, ...userStyle as StyleDesc }}>
          <div style={{ position: "relative", width: "100%", minWidth: 140, height: g.height }}>
            <ColorSurface onMouseEnter={() => { hovered.value = true }} onMouseLeave={() => { hovered.value = false }} transition={{ duration: 0.2, ease: "ease" }}
              onClick={() => setSearchOpen(!openState.value)} style={triggerStyle({ open: openState.value, disabled: props.disabled, placeholder: !hasValue })}>{() => <>
              <input ref={searchInput} testId={props.testId} value={displayQuery} valueRevision={searchRevision.value}
                readOnly={props.disabled} tabIndex={props.disabled ? -1 : 0} placeholder={props.placeholder} placeholderColor={PLACEHOLDER_COLOR}
                role="combobox" aria-label={props.ariaLabel ?? attrs["aria-label"]} aria-expanded={openState.value} aria-disabled={props.disabled || undefined}
                onFocus={() => { focused.value = true }} onBlur={() => { focused.value = false }}
                onClick={() => setSearchOpen(true)} onChange={handleSearchChange}
                onKeyDown={(event: EventPayload) => { if (event.key?.toLowerCase() !== "enter") searchKeyDown(event) }}
                onSubmit={(event: EventPayload) => searchKeyDown({ ...event, key: "enter" })}
                style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, color: hasValue ? c.warmSoft : PLACEHOLDER_COLOR, fontSize: g.fontSize, fontWeight: hasValue ? 600 : 400, ...(props.disabled ? { pointerEvents: "none" as const } : {}) }} />
              {clearControl()}{arrow()}
            </>}</ColorSurface>
            {openState.value ? <FloatingLayer side={props.side} align={props.align} sideOffset={props.sideOffset}
              {...{ role: "listbox", testId: props.testId ? `${props.testId}-popup` : undefined, onMouseDownOutside: () => setSearchOpen(false), style: panelStyle }}>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease }}>
                {filteredOptions.value.length === 0 ? notFound() : filteredOptions.value.map(option => {
                  const state = { selected: currentValue.value === option.key, highlighted: activeKey.value === option.key, disabled: false }
                  return <div key={option.key} role="option" aria-selected={state.selected} testId={props.testId ? `${props.testId}-option-${option.key}` : undefined}
                    onClick={() => selectSearchOption(option.key)} onMouseEnter={() => { activeKey.value = option.key }} style={itemStyle(state)}>{optionContent(option, state)}</div>
                })}
              </motion.div>
            </FloatingLayer> : null}
          </div>
        </div>
      }

      // The platform trigger must keep its own native ref, keyboard handling
      // and registered host identity. Supply translated targets directly
      // rather than wrapping it in an extra interactive component.
      const triggerSurface = surfaceMotion(triggerStyle({ open: openState.value, disabled: props.disabled, placeholder: !hasValue }), { hovered: hovered.value && !props.disabled })
      triggerAttrs.motion = { initial: false, animate: triggerSurface.animate, transition: { duration: 0.2, ease: "ease" } }
      return (
        <PlatformSelect
          {...forwardAttrs}
          value={currentValue.value ?? ""}
          defaultValue={props.defaultValue === "" ? undefined : props.defaultValue}
          disabled={props.disabled}
          onValueChange={handleValueChange}
          onOpenChange={(open: boolean) => {
            openState.value = open
            ;(userOpenChange as ((open: boolean) => void) | undefined)?.(open)
          }}
          style={userStyle as StyleDesc | undefined}
        >
          {/* Keep the positioning box outside the trigger's border. Absolute
              children inside the trigger anchor to its inner border edge. */}
          <div style={{ position: "relative", width: "100%", minWidth: 140, height: g.height }}>
            <SelectTrigger {...triggerAttrs} style={triggerSurface.style}>
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
              {clearControl()}
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
            </SelectTrigger>
            <SelectContent {...{ role: "listbox", testId: props.testId ? `${props.testId}-popup` : undefined }} side={props.side} align={props.align} sideOffset={props.sideOffset} style={panelStyle}>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease }}>
                {props.options.length === 0 ? notFound() : null}
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
          </div>
        </PlatformSelect>
      )
    }
  },
})

export default Select
