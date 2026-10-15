/** Switch — GPUIV port of animal-island-vue's `Switch.vue`.
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - Handle slide (`left: 2px` ↔ `calc(100% - 24px)` with a CSS transition)
 *    → native `motion.div` `left` tween over computed pixels (0.25s,
 *    cubic-bezier(0.4, 0, 0.2, 1) from tokens). Track and handle colours and
 *    the track's inset shadow share the same native motion clock.
 *  - `top: 50%; transform: translateY(-50%)` on the handle → computed numeric
 *    `top` (GPUIV has no transforms).
 *  - Track inset shadow uses GPUI's existing inset-shadow paint: 0 2px 4px,
 *    warm-brown .15 when unchecked and green .2 when checked. Disabled/loading
 *    retain the same shadow with the whole control's original opacity.
 *  - Border-ring loading spinner (CSS `rotate` keyframes) → the native
 *    three-dot `Spinner` scaled down to the handle.
 *  - The original track grows with the label through CSS layout; GPUIV cannot
 *    read layout back, so `checkedChildren`/`unCheckedChildren` text widens
 *    the track through a width estimate (slot labels keep the base width).
 *  - Label `text-shadow` and `letter-spacing` are dropped (unsupported).
 */

import { computed, defineComponent, ref, type PropType, type VNodeChild } from "vue"
import { Spinner, motion, type StyleDesc } from "@gpuiv/vue"
import { colors, duration, ease, fonts, radius } from "../tokens.js"
import { activationKeys } from "../interaction.js"
import { contentLabel, renderContent } from "./content.js"
import { ColorSurface } from "./surface-motion.js"

export type SwitchSize = "small" | "default"

interface SwitchGeometry {
  width: number
  height: number
  handle: number
  inset: number
  border: number
  labelPad: number
  handleZone: number
  fontSize: number
  spinnerSize: number
}

const geometry: Record<SwitchSize, SwitchGeometry> = {
  small: { width: 38, height: 20, handle: 14, inset: 1, border: 2.5, labelPad: 6, handleZone: 20, fontSize: 9, spinnerSize: 2 },
  default: { width: 52, height: 28, handle: 21, inset: 2, border: 2.5, labelPad: 8, handleZone: 28, fontSize: 11, spinnerSize: 3 },
}

/** Bold hand-drawn faces run wide; CJK glyphs are roughly em-square. */
function estimateLabelWidth(label: string, fontSize: number): number {
  let w = 0
  for (const ch of label) w += ((ch.codePointAt(0) ?? 0) > 0x2e7f ? 1 : 0.66) * fontSize
  return Math.ceil(w) + 2
}

export const Switch = defineComponent({
  name: "AnimalSwitch",
  inheritAttrs: false,
  props: {
    /** 是否选中（受控，对应 v-model） */
    modelValue: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    /** 是否选中（受控，优先于 modelValue） */
    checked: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    /** 默认是否选中（非受控初始值） */
    defaultChecked: { type: Boolean, default: false },
    size: { type: String as PropType<SwitchSize>, default: "default" },
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    checkedChildren: { type: [String, Number, Object, Array, Boolean] as PropType<VNodeChild>, default: undefined },
    unCheckedChildren: { type: [String, Number, Object, Array, Boolean] as PropType<VNodeChild>, default: undefined },
    onChange: { type: Function as PropType<(value: boolean) => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const innerChecked = ref(props.defaultChecked)
    const focused = ref(false)
    // 受控判断：`checked` 与 `modelValue` 均可作为受控值，checked 优先
    const isControlled = computed(() => props.checked !== undefined || props.modelValue !== undefined)
    const isChecked = computed(() => {
      if (props.checked !== undefined) return props.checked
      if (props.modelValue !== undefined) return props.modelValue
      return innerChecked.value
    })

    function toggle() {
      if (props.disabled || props.loading) return
      const next = !isChecked.value
      if (!isControlled.value) innerChecked.value = next
      ;(attrs["onUpdate:modelValue"] as ((value: boolean) => void) | undefined)?.(next)
      props.onChange?.(next)
    }

    return () => {
      const c = colors
      const g = geometry[props.size]
      const checked = isChecked.value
      const inactive = props.disabled || props.loading
      // A v-model listener must not leak onto the host div as an event prop.
      const { "onUpdate:modelValue": _vModelListener, ...forwardAttrs } = attrs

      const label = checked ? props.checkedChildren : props.unCheckedChildren
      const labelText = contentLabel(label)
      const trackWidth =
        labelText === undefined
          ? g.width
          : Math.max(g.width, g.border * 2 + g.handleZone + g.labelPad + estimateLabelWidth(labelText, g.fontSize))

      const style: StyleDesc = {
        position: "relative",
        display: "flex",
        alignItems: "center",
        width: trackWidth,
        height: g.height,
        paddingLeft: checked ? g.labelPad : g.handleZone,
        paddingRight: checked ? g.handleZone : g.labelPad,
        backgroundColor: checked ? "#86d67a" : c.shadowSoft,
        boxShadow: { offsetX: 0, offsetY: 2, blurRadius: 4, spreadRadius: 0, color: checked ? "rgba(90, 158, 30, 0.2)" : "rgba(114, 93, 66, 0.15)", inset: true },
        borderWidth: g.border,
        borderColor: checked ? c.success : c.shadowSoftHover,
        borderRadius: radius.pill,
        fontSize: g.fontSize,
        fontWeight: 700,
        color: "#ffffff",
        whiteSpace: "nowrap",
        lineHeight: g.fontSize,
        userSelect: "none",
        cursor: props.disabled ? "not-allowed" : inactive ? "default" : "pointer",
        hover: checked
          ? { backgroundColor: "#7ccc70", borderColor: c.successActive }
          : { borderColor: c.shadowSoftStrong },
        ...(attrs.style as StyleDesc | undefined),
        ...(focused.value && !props.disabled
          ? { outline: { width: 2, color: "#ffcc00", offset: 2 } }
          : {}),
      }
      if (props.disabled) style.opacity = 0.5
      else if (props.loading) style.opacity = 0.7
      if (inactive) style.pointerEvents = "none"

      return (
        <ColorSurface
          {...forwardAttrs}
          role="switch"
          aria-checked={checked}
          aria-busy={props.loading || undefined}
          aria-disabled={props.disabled || undefined}
          tabIndex={props.disabled ? -1 : ((attrs.tabIndex as number | undefined) ?? 0)}
          testId={props.testId}
          onFocus={() => (focused.value = true)}
          onBlur={() => (focused.value = false)}
          onClick={inactive ? undefined : () => toggle()}
          onKeyDown={inactive ? undefined : activationKeys(() => toggle())}
          style={{ ...(fonts.sans ? { fontFamily: fonts.sans } : {}), ...style }}
        >{() => <>
          {label !== undefined ? renderContent(label) : checked ? (
            slots.checked?.()
          ) : (
            slots.unchecked?.()
          )}
          <motion.div
            initial={false}
            animate={{ left: checked ? trackWidth - g.border * 2 - g.handle - g.inset : g.inset, backgroundColor: "#f7f3df", borderColor: checked ? c.success : c.shadowSoftHover }}
            transition={{ duration: duration.base, ease }}
            style={{
              // The animated handle is decorative; the track owns the press.
              pointerEvents: "none",
              position: "absolute",
              top: (g.height - g.border * 2 - g.handle) / 2,
              width: g.handle,
              height: g.handle,
              backgroundColor: "#f7f3df",
              borderWidth: g.border,
              borderColor: checked ? c.success : c.shadowSoftHover,
              borderRadius: radius.pill,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {props.loading ? (
              <Spinner size={g.spinnerSize} color={checked ? c.success : c.shadowSoftStrong} label="Loading" />
            ) : null}
          </motion.div>
        </>}</ColorSurface>
      )
    }
  },
})

export default Switch

/** Public native props; rich state content can also be supplied through slots. */
export type SwitchProps = Omit<InstanceType<typeof Switch>["$props"], "style"> & { style?: StyleDesc }
