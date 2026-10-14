/** Collapse — GPUIV port of animal-island-vue's `Collapse.vue`.
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - The original is a single Q&A panel (`question`/`answer` props + slots).
 *    There is no items/accordion/CollapseItem API in the source library, so
 *    the port has neither.
 *  - `grid-template-rows: 0fr → 1fr` drawer animation → the platform
 *    `AnimateHeight` (`height={expanded ? "auto" : 0}`, 0.3s,
 *    cubic-bezier(0.4, 0, 0.2, 1)) — the original's own 0.3s @motion-ease
 *    timing. The content's parallel `padding-bottom` transition folds into
 *    the animated height (padding stays constant; the clipping wrapper hides
 *    it), and `initialHeight` avoids a flash-open on a collapsed mount.
 *  - Icon `transform: rotate(180deg)` and fish `rotate(45deg)` → dropped (no
 *    transforms). The rotate is imperceptible on + / − glyphs; the glyph
 *    swap and the icon's primary → primaryActive background carry the state.
 *  - Icon `transition: background-color 0.25s` → instant swap (GPUIV motion
 *    only tweens geometry/opacity, not colours).
 *  - The header's native `<button>` focus ring → warning-yellow outline on
 *    the outer card while the header is focused (`@focus-yellow` in the
 *    original variables); drawn on the card because the card's
 *    `overflow: hidden` would clip a ring on the full-width header.
 *  - DOM-id ARIA linkage (`aria-controls`/`aria-labelledby` on generated
 *    ids) → dropped: GPUIV elements have no DOM ids and the native layer
 *    only forwards role/aria-expanded/…; those are kept.
 *  - The filled +/− badge and fish icon inside the clickable header get
 *    `pointerEvents: "none"`: GPUI paints a flat hit list and does not
 *    bubble clicks, so filled children would cover the header's hitbox.
 *  - v-model is `expanded` in the original (`update:expanded`); kept as the
 *    `expanded` prop + `onChange`, and an `onUpdate:expanded` attr listener
 *    is honoured for v-model callers.
 */

import { computed, defineComponent, ref, watch, type PropType } from "vue"
import { AnimateHeight, type StyleDesc } from "@gpuiv/vue"
import { borderWidth, colors, ease, fontSize, fonts, radius, spacing } from "../tokens.js"
import { activationKeys } from "../interaction.js"
import { Icon } from "./Icon.js"

export interface CollapseProps {
  question?: string
  answer?: string
  defaultExpanded?: boolean
  expanded?: boolean
  disabled?: boolean
}

export const Collapse = defineComponent({
  name: "AnimalCollapse",
  inheritAttrs: false,
  props: {
    /** 标题文本（可被 question 插槽覆盖） */
    question: { type: String, default: undefined },
    /** 内容文本（可被默认插槽覆盖） */
    answer: { type: String, default: undefined },
    /** 默认是否展开（非受控初始值） */
    defaultExpanded: { type: Boolean, default: false },
    /** 是否展开（受控，对应 v-model:expanded） */
    expanded: { type: Boolean as PropType<boolean | undefined>, default: undefined },
    disabled: { type: Boolean, default: false },
    onChange: { type: Function as PropType<(value: boolean) => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const innerExpanded = ref(props.defaultExpanded)
    const focused = ref(false)
    const isControlled = computed(() => props.expanded !== undefined)
    const expandedState = computed(() => (isControlled.value ? !!props.expanded : innerExpanded.value))

    // 受控值变化时同步内部值：父组件中途取消受控时保持最后状态而不是
    // 回落到 defaultExpanded（与原库一致）
    watch(
      () => props.expanded,
      (v) => {
        if (isControlled.value) innerExpanded.value = !!v
      }
    )

    function toggle() {
      if (props.disabled) return
      const next = !expandedState.value
      if (!isControlled.value) innerExpanded.value = next
      ;(attrs["onUpdate:expanded"] as ((value: boolean) => void) | undefined)?.(next)
      props.onChange?.(next)
    }

    return () => {
      const c = colors
      const expanded = expandedState.value
      // A v-model listener must not leak onto the host div as an event prop.
      const { "onUpdate:expanded": _vModelListener, ...forwardAttrs } = attrs

      const containerStyle: StyleDesc = {
        position: "relative",
        backgroundColor: c.bg,
        borderRadius: radius.base,
        borderWidth,
        borderColor: c.border,
        overflow: "hidden",
        marginBottom: spacing.md,
        ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
        ...(props.disabled ? { opacity: 0.6, cursor: "not-allowed" } : {}),
        ...(attrs.style as StyleDesc | undefined),
        ...(focused.value && !props.disabled ? { outline: { width: 2, color: c.warning, offset: 2 } } : {}),
      }

      return (
        <div {...forwardAttrs} testId={props.testId} style={containerStyle}>
          <div
            role="button"
            aria-expanded={expanded}
            aria-disabled={props.disabled || undefined}
            tabIndex={props.disabled ? -1 : 0}
            onClick={props.disabled ? undefined : () => toggle()}
            onKeyDown={props.disabled ? undefined : activationKeys(() => toggle())}
            onFocus={() => (focused.value = true)}
            onBlur={() => (focused.value = false)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: spacing.md,
              width: "100%",
              paddingTop: spacing.lg,
              paddingBottom: spacing.lg,
              paddingLeft: spacing.xl,
              paddingRight: spacing.xl,
              cursor: props.disabled ? "not-allowed" : "pointer",
              userSelect: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                flexShrink: 0,
                backgroundColor: expanded ? c.primaryActive : c.primary,
                borderRadius: radius.pill,
                fontSize: 18,
                fontWeight: 700,
                lineHeight: 18,
                color: "#ffffff",
                boxShadow: {
                  offsetX: 0,
                  offsetY: 2,
                  blurRadius: 4,
                  spreadRadius: 0,
                  color: "rgba(25, 200, 185, 0.3)",
                },
                pointerEvents: "none",
              }}
            >
              <text>{expanded ? "−" : "+"}</text>
            </div>
            <div
              style={{
                flexGrow: 1,
                fontSize: fontSize.lg,
                fontWeight: 600,
                lineHeight: fontSize.lg * 1.35,
                color: c.text,
              }}
            >
              {slots.question ? slots.question() : props.question !== undefined ? <text>{props.question}</text> : null}
            </div>
            <Icon name="Fish" size={20} style={{ pointerEvents: "none" }} />
          </div>
          <AnimateHeight
            height={expanded ? "auto" : 0}
            initialHeight={expanded ? undefined : 0}
            duration={0.3}
            ease={ease}
          >
            <div
              style={{
                paddingLeft: spacing.xl,
                paddingRight: spacing.xl,
                paddingBottom: spacing.xl,
                color: c.textSecondary,
                fontSize: fontSize.base,
                lineHeight: fontSize.base * 1.7,
              }}
            >
              {slots.default ? slots.default() : props.answer !== undefined ? <text>{props.answer}</text> : null}
            </div>
          </AnimateHeight>
        </div>
      )
    }
  },
})

export default Collapse
