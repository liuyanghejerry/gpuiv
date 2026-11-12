/** Headless Base UI-shaped Button: a focusable `div` that acts like `<button>`. */

import { defineComponent, h, type PropType, type VNodeChild } from "vue"
import type { EventPayload } from "@gpuiv/native"
import type { KeyEvent } from "../types.js"
import { cloneAsChild, resolveStyle, type StateStyle } from "./floating.js"
import type { StyleDesc } from "../types.js"

export interface ButtonState {
  disabled: boolean
}

export interface ButtonBehavior {
  disabled?: boolean
  /** Keep a disabled button in the Tab order, for example while it saves. */
  focusableWhenDisabled?: boolean
  onClick?: (event: EventPayload) => void
  onKeyDown?: (event: KeyEvent) => void
  onKeyUp?: (event: KeyEvent) => void
  tabIndex?: number
}

/**
 * Props that make any element act like a `<button>`: a tab stop, `role`, and
 * `onClick` from a press, Enter (on key down) or Space (on key up), like a
 * browser. Primitives such as `DialogTrigger` build on it.
 */
export function buttonProps({
  disabled = false,
  focusableWhenDisabled = false,
  onClick,
  onKeyDown,
  onKeyUp,
  tabIndex,
}: ButtonBehavior): Record<string, unknown> {
  return {
    role: "button",
    // Unset keeps an `asChild` child's own tabIndex.
    tabIndex: disabled && !focusableWhenDisabled ? -1 : tabIndex,
    onClick: (event: EventPayload) => {
      if (!disabled) onClick?.(event)
    },
    onKeyDown: (event: KeyEvent) => {
      onKeyDown?.(event)
      if (disabled || event.defaultPrevented) return
      if (event.key === "enter" && !event.isHeld) onClick?.(event)
      // Space would otherwise scroll or type; it fires on release.
      if (event.key === "space") event.preventDefault()
    },
    onKeyUp: (event: KeyEvent) => {
      onKeyUp?.(event)
      if (!disabled && !event.defaultPrevented && event.key === "space") onClick?.(event)
    },
  }
}

export interface ButtonProps extends ButtonBehavior {
  asChild?: boolean
  style?: StateStyle<ButtonState>
}

export const Button = defineComponent({
  name: "Button",
  inheritAttrs: false,
  props: {
    disabled: { type: Boolean, default: false },
    focusableWhenDisabled: { type: Boolean, default: false },
    asChild: { type: Boolean, default: false },
    tabIndex: { type: Number, default: undefined },
    onClick: { type: Function as PropType<(event: EventPayload) => void>, default: undefined },
    onKeyDown: { type: Function as PropType<(event: KeyEvent) => void>, default: undefined },
    onKeyUp: { type: Function as PropType<(event: KeyEvent) => void>, default: undefined },
  },
  setup(props, { attrs, slots }) {
    return () => {
      const state: ButtonState = { disabled: props.disabled }
      const button = buttonProps({
        disabled: props.disabled,
        focusableWhenDisabled: props.focusableWhenDisabled,
        onClick: props.onClick,
        onKeyDown: props.onKeyDown,
        onKeyUp: props.onKeyUp,
        tabIndex: props.tabIndex,
      })
      const style = resolveStyle(attrs.style as StateStyle<ButtonState>, state)
      if (props.asChild) {
        // Unset keeps the child's own tabIndex, like renderSlot's default of 0
        // only applying to the element the primitive itself renders.
        const itemProps: Record<string, unknown> = {
          ...(attrs as Record<string, unknown>),
          ...button,
          style,
        }
        if (button.tabIndex === undefined) delete itemProps.tabIndex
        return cloneAsChild("Button", slots.default?.(), itemProps)
      }
      return h(
        "div",
        {
          ...(attrs as Record<string, unknown>),
          ...button,
          tabIndex: button.tabIndex ?? 0,
          style: style as StyleDesc | undefined,
        },
        (slots.default?.() ?? []) as VNodeChild[],
      )
    }
  },
})
