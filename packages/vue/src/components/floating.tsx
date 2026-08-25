/** Shared state and positioning helpers for headless floating controls. */

import { computed, defineComponent, h, ref, type Ref } from "vue"
import type { StyleDesc } from "../types.js"

export type FloatingSide = "top" | "right" | "bottom" | "left"
export type FloatingAlign = "start" | "center" | "end"
export type StateStyle<State> = StyleDesc | ((state: State) => StyleDesc)

export function resolveStyle<State>(
  style: StateStyle<State> | undefined,
  state: State
): StyleDesc | undefined {
  return typeof style === "function" ? style(state) : style
}

export function mergeStyles(
  base: StyleDesc | undefined,
  override: StyleDesc | undefined
): StyleDesc | undefined {
  if (!base) return override
  if (!override) return base
  return { ...base, ...override }
}

export function floatingRootStyle(style?: StyleDesc): StyleDesc {
  return {
    display: "flex",
    position: "relative",
    alignItems: "start",
    ...style,
  }
}

export interface ControllableStateOptions<Value> {
  value: Value | undefined
  defaultValue: Value
  onChange?: (value: Value) => void
}

/** Vue version of React's useControllableState — a ref plus a setter. */
export function useControllableState<Value>(
  options: ControllableStateOptions<Value>
): [Ref<Value>, (value: Value) => void] {
  const internal = ref(options.defaultValue) as Ref<Value>
  const controlled = computed(() => options.value !== undefined)
  const current = computed(() =>
    controlled.value ? (options.value as Value) : internal.value
  )
  const setValue = (nextValue: Value): void => {
    if (!controlled.value) internal.value = nextValue
    if (!Object.is(current.value, nextValue)) options.onChange?.(nextValue)
  }
  return [current, setValue]
}

export interface FloatingContentProps {
  side?: FloatingSide
  sideOffset?: number
  align?: FloatingAlign
  alignOffset?: number
  collisionPadding?: number
  style?: StyleDesc
}

/**
 * An `<anchored deferred>` element wrapping a solid panel div. Menus and
 * tooltips must render inside the composer's positioning context — never
 * overflow a `position: "absolute"` card into a `<virtual-list>` (see
 * AGENTS.md).
 */
export const FloatingLayer = defineComponent({
  props: {
    side: { type: String, default: "bottom" },
    sideOffset: { type: Number, default: 0 },
    align: { type: String, default: "start" },
    alignOffset: { type: Number, default: 0 },
    collisionPadding: { type: Number, default: 8 },
  },
  setup(props, { attrs, slots }) {
    return () => {
      const offset =
        props.side === "top" || props.side === "bottom"
          ? { x: props.alignOffset, y: 0 }
          : { x: 0, y: props.alignOffset }

      const style = mergeStyles(
        { backgroundColor: "#1A1A1A" },
        attrs.style as StyleDesc | undefined
      )

      return h(
        "anchored",
        {
          side: props.side,
          align: props.align,
          gap: props.sideOffset,
          offset,
          fit: "snap",
          snapMargin: props.collisionPadding,
          deferred: true,
          priority: 1,
          occlude: true,
        },
        [h("div", { ...attrs, style }, slots.default?.())],
      )
    }
  },
})
