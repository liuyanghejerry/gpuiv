/** Input — GPUIV port of animal-island-vue's `Input.vue`.
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - 容器保持原版外形：无描边胶囊（圆角 small 40 / middle 50 / large 50px）、
 *    奶油输入底 #fffbe7，深度全靠硬阴影。阴影优先级照抄 CSS 特异性：
 *    `shadow && !disabled` 的尺寸阴影（2/3/4px @shadow-soft）> `status`
 *    阴影（3px error/warning-active）> 无；`disabled` 一律无阴影。
 *  - `transition: all 0.25s` → 砍掉（GPUIV 无样式过渡），阴影/颜色即时切换。
 *  - placeholder 颜色使用原生 placeholderColor，默认 @text-color-disabled；
 *    caret 设为 warmSoft 贴近文本色。
 *  - `type="password"` 使用原生编辑器的遮罩，真实值、IME、光标及选区仍由
 *    native 保管；其余浏览器输入类型仍以普通文本编辑。
 *  - `maxLength` → 原生无硬上限：按 UTF-16 上限截断，边界不会拆开代理对；
 *    负数/非有限值视作无上限。截断时 bump 原生 `valueRevision` 强制回写，
 *    IME 中间态保留原值；提交的完整 change 或仅解除标记的 End 时才限制。
 *  - `disabled` → 原生 input 无 disabled：readOnly + input 自身
 *    pointerEvents:'none' + 容器视觉（#ece8dc、opacity 0.6、not-allowed
 *    光标）。disabled 设置 tabIndex=-1，从键盘 Tab 顺序排除。
 *  - `aria-invalid`（status error 时）→ GPUIV 无该 aria 映射，省略。
 *  - 焦点可见性：原版 inner `outline: none` 且无焦点环 → 按 GPUIV 组件惯例
 *    聚焦时容器加 outline {2, primary, offset 2}，便于键盘导航辨识。
 *  - 清除按钮 `<button type="button">×` → div role="button" + activationKeys
 *    （Enter/Space 激活）；原版的原生 input 事件重派发 → 直接派发
 *    onClear → onChange('')。
 */

import { computed, defineComponent, ref, type PropType, type VNodeChild } from "vue"
import { type BoxShadow, type EventPayload, type StyleDesc } from "@gpuiv/vue"
import { colors, fontSize, fonts, height, radius } from "../tokens.js"
import { activationKeys } from "../interaction.js"
import { renderContent } from "./content.js"

export type InputSize = "small" | "middle" | "large"
export type InputStatus = "error" | "warning"

function hardShadow(offsetY: number, color: string): BoxShadow {
  return { offsetX: 0, offsetY, blurRadius: 0, spreadRadius: 0, color }
}

interface InputGeometry {
  height: number
  paddingX: number
  fontSize: number
  radius: number
  shadow: BoxShadow
}

const geometry: Record<InputSize, InputGeometry> = {
  small: { height: height.sm, paddingX: 14, fontSize: fontSize.sm, radius: 40, shadow: hardShadow(2, colors.shadowSoft) },
  middle: { height: height.base, paddingX: 18, fontSize: fontSize.base, radius: 50, shadow: hardShadow(3, colors.shadowSoft) },
  large: { height: height.lg, paddingX: 22, fontSize: fontSize.lg, radius: 50, shadow: hardShadow(4, colors.shadowSoft) },
}

const statusShadow: Record<InputStatus, BoxShadow> = {
  error: hardShadow(3, colors.errorActive),
  warning: hardShadow(3, colors.warningActive),
}

/** A native input only reads `caret` from its theme prop. */
const inputTheme = { caret: colors.warmSoft }

/** Keep HTML's UTF-16 limit without creating a lone surrogate at the cut. */
function limitText(value: string, maxLength: number | undefined): string {
  if (maxLength === undefined || !Number.isFinite(maxLength) || maxLength < 0) return value
  let end = Math.trunc(maxLength)
  if (value.length <= end) return value
  const before = value.charCodeAt(end - 1), after = value.charCodeAt(end)
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end--
  return value.slice(0, end)
}

export const Input = defineComponent({
  name: "AnimalInput",
  inheritAttrs: false,
  props: {
    /** React-compatible controlled value; takes precedence over modelValue. */
    value: { type: [String, Number] as PropType<string | number | undefined>, default: undefined },
    /** 输入值（受控，对应 v-model） */
    modelValue: { type: String as PropType<string | undefined>, default: undefined },
    /** 默认输入值（非受控初始值） */
    defaultValue: { type: [String, Number], default: "" },
    /** 输入框尺寸 */
    size: { type: String as PropType<InputSize>, default: "middle" },
    /** 前缀内容（同名 slot 优先） */
    prefix: { type: [String, Number, Object, Array, Boolean] as PropType<VNodeChild>, default: undefined },
    /** 后缀内容（同名 slot 优先） */
    suffix: { type: [String, Number, Object, Array, Boolean] as PropType<VNodeChild>, default: undefined },
    /** 允许清除 */
    allowClear: { type: Boolean, default: false },
    /** 校验状态 */
    status: { type: String as PropType<InputStatus | undefined>, default: undefined },
    /** 是否显示阴影 */
    shadow: { type: Boolean, default: false },
    /** 禁用 */
    disabled: { type: Boolean, default: false },
    /** 占位符 */
    placeholder: { type: String, default: undefined },
    /** password 使用原生遮罩；其余浏览器类型当前仍是普通文本编辑 */
    type: { type: String, default: "text" },
    placeholderColor: { type: String, default: colors.textDisabled },
    /** 只读 */
    readonly: { type: Boolean, default: false },
    readOnly: { type: Boolean, default: false },
    autoFocus: { type: Boolean, default: false },
    tabIndex: { type: Number, default: 0 },
    /** 最大长度（JS 截断近似，见文件头注释） */
    maxLength: { type: Number, default: undefined },
    /** 清除按钮的无障碍标签 */
    clearAriaLabel: { type: String, default: "清除" },
    onChange: { type: Function as PropType<(value: string, event?: EventPayload) => void>, default: undefined },
    onClear: { type: Function as PropType<() => void>, default: undefined },
    onFocus: { type: Function as PropType<(e: EventPayload) => void>, default: undefined },
    onBlur: { type: Function as PropType<(e: EventPayload) => void>, default: undefined },
    onKeyDown: { type: Function as PropType<(e: EventPayload) => void>, default: undefined },
    onKeyUp: { type: Function as PropType<(e: EventPayload) => void>, default: undefined },
    onSubmit: { type: Function as PropType<(e: EventPayload) => void>, default: undefined },
    onCompositionStart: { type: Function as PropType<(e: EventPayload) => void>, default: undefined },
    onCompositionUpdate: { type: Function as PropType<(e: EventPayload) => void>, default: undefined },
    onCompositionEnd: { type: Function as PropType<(e: EventPayload) => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const innerValue = ref(String(props.defaultValue))
    const focused = ref(false)
    /** Bumped whenever maxLength truncates, so the native editor takes the
     *  truncated value even when it equals the previous prop value. */
    const revision = ref(0)
    // React value takes priority; modelValue keeps the existing Vue binding.
    const isControlled = computed(() => props.value !== undefined || props.modelValue !== undefined)
    const currentValue = computed(() => props.value !== undefined ? String(props.value) : props.modelValue ?? innerValue.value)
    let composing = false
    let markedText = ""
    let latestFullValue = currentValue.value
    let endCorrection: { raw: string, limited: string } | undefined

    function emitValue(value: string, event?: EventPayload) {
      if (!isControlled.value) innerValue.value = value
      ;(attrs["onUpdate:modelValue"] as ((value: string) => void) | undefined)?.(value)
      props.onChange?.(value, event)
    }

    function handleChange(e: EventPayload) {
      const raw = e.value ?? ""
      latestFullValue = raw
      if (composing) {
        emitValue(raw, e)
        return
      }
      const limited = limitText(raw, props.maxLength)
      // A commit of the unchanged marked segment can follow the End-only
      // correction with the same full value. Still enforce the native value,
      // but do not emit that correction twice.
      const alreadyEmitted = endCorrection?.raw === raw && endCorrection.limited === limited
      endCorrection = undefined
      latestFullValue = limited
      if (!alreadyEmitted) emitValue(limited, e)
      if (limited !== raw) revision.value++
    }

    function handleCompositionStart(e: EventPayload) {
      composing = true
      markedText = ""
      latestFullValue = currentValue.value
      endCorrection = undefined
      props.onCompositionStart?.(e)
    }

    function handleCompositionUpdate(e: EventPayload) {
      markedText = e.value ?? ""
      props.onCompositionUpdate?.(e)
    }

    function handleCompositionEnd(e: EventPayload) {
      composing = false
      props.onCompositionEnd?.(e)
      // Native End carries only the marked segment, never the entire input.
      // Unmarking keeps that segment and emits no final change. A different
      // commit/cancel segment is followed by a full change, so wait for it;
      // a JS microtask cannot reliably span separate native TSF callbacks.
      const unchangedSegment = (e.value ?? "") === markedText
      markedText = ""
      if (!unchangedSegment) return
      const raw = latestFullValue
      const limited = limitText(raw, props.maxLength)
      if (limited !== raw) {
        endCorrection = { raw, limited }
        latestFullValue = limited
        emitValue(limited, e)
        revision.value++
      }
    }

    // 原版 clear 后派发真实 input 事件以触发 change；这里直接按同序派发。
    function handleClear() {
      composing = false
      markedText = ""
      endCorrection = undefined
      latestFullValue = ""
      props.onClear?.()
      emitValue("")
    }

    function handleFocus(e: EventPayload) {
      focused.value = true
      props.onFocus?.(e)
    }
    function handleBlur(e: EventPayload) {
      focused.value = false
      props.onBlur?.(e)
    }

    return () => {
      const c = colors
      const g = geometry[props.size]
      const value = currentValue.value
      const showClear = props.allowClear && !!value && !props.disabled
      // A v-model listener must not leak onto the host div as an event prop.
      const { "onUpdate:modelValue": _vModelListener, ...forwardAttrs } = attrs

      let boxShadow: BoxShadow | undefined
      if (!props.disabled) {
        if (props.shadow) boxShadow = g.shadow
        else if (props.status !== undefined) boxShadow = statusShadow[props.status]
      }

      const style: StyleDesc = {
        display: "flex",
        alignItems: "center",
        width: "100%",
        height: g.height,
        paddingLeft: g.paddingX,
        paddingRight: g.paddingX,
        backgroundColor: c.bgInput,
        borderRadius: g.radius,
        fontSize: g.fontSize,
        fontWeight: 500,
        color: c.warmSoft,
        boxShadow,
        ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
        ...(attrs.style as StyleDesc | undefined),
        ...(focused.value && !props.disabled
          ? { outline: { width: 2, color: c.primary, offset: 2 } }
          : {}),
      }
      if (props.disabled) {
        style.backgroundColor = "#ece8dc"
        style.opacity = 0.6
        style.cursor = "not-allowed"
      }

      const inputStyle: StyleDesc = {
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        fontSize: g.fontSize,
        fontWeight: 500,
        color: props.disabled ? c.textDisabled : c.warmSoft,
        ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
      }
      if (props.disabled) inputStyle.pointerEvents = "none"

      const affixStyle: StyleDesc = {
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        color: "#a0936e",
      }

      return (
        <div {...forwardAttrs} testId={props.testId} style={style}>
          {props.prefix || slots.prefix ? (
            <div style={{ ...affixStyle, marginRight: 6 }}>
              {slots.prefix ? slots.prefix() : renderContent(props.prefix)}
            </div>
          ) : null}
          <input
            type={props.type === "password" ? "password" : "text"}
            value={value}
            placeholder={props.placeholder}
            placeholderColor={props.placeholderColor}
            readOnly={props.readOnly || props.readonly || props.disabled}
            tabIndex={props.disabled ? -1 : props.tabIndex}
            autoFocus={props.autoFocus && !props.disabled}
            theme={inputTheme}
            valueRevision={revision.value}
            onChange={handleChange}
            onCompositionStart={handleCompositionStart}
            onCompositionUpdate={handleCompositionUpdate}
            onCompositionEnd={handleCompositionEnd}
            onSubmit={props.disabled ? undefined : props.onSubmit}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={props.onKeyDown}
            onKeyUp={props.onKeyUp}
            style={inputStyle}
          />
          {showClear ? (
            <div
              role="button"
              aria-label={props.clearAriaLabel}
              tabIndex={0}
              onClick={handleClear}
              onKeyDown={activationKeys(handleClear)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                marginLeft: 4,
                flexShrink: 0,
                borderRadius: radius.pill,
                color: c.textDisabled,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                userSelect: "none",
                hover: { color: c.warmSoft, backgroundColor: "rgba(114, 93, 66, 0.1)" },
              }}
            >
              <text>×</text>
            </div>
          ) : null}
          {props.suffix || slots.suffix ? (
            <div style={{ ...affixStyle, marginLeft: 6 }}>
              {slots.suffix ? slots.suffix() : renderContent(props.suffix)}
            </div>
          ) : null}
        </div>
      )
    }
  },
})

export default Input

/** Native public props inferred from the component. Rich children use Vue
 * slots; event callbacks carry native values/payloads, not browser events. */
export type InputProps = Omit<InstanceType<typeof Input>["$props"], "style"> & { style?: StyleDesc }
