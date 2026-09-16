/** Shared state and positioning helpers for headless floating controls. */

import { computed, defineComponent, h, ref, type Ref } from "vue"
import { cloneVNode, isVNode, Comment, Text } from "vue"
import type { VNode, VNodeChild } from "vue"
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

/**
 * The asChild render path: instead of the primitive rendering its own host
 * div, the item's props are merged onto the user's single child element, so
 * the custom row itself becomes the item — one element, one hit target.
 *
 * `cloneVNode` merging does the work: styles become an array that
 * `toGpuixStyle` flattens (item style wins on conflicts), event handlers
 * compose into arrays that both fire (child first), and every other prop
 * falls through to the child's root element. A component child must forward
 * its fallthrough attrs to a single root, the standard Vue contract.
 */
export function cloneAsChild(
  owner: string,
  rendered: VNodeChild,
  itemProps: Record<string, unknown>
): VNode {
  const list = (Array.isArray(rendered) ? rendered : [rendered]).filter(
    (child): child is VNode =>
      isVNode(child) && child.type !== Text && child.type !== Comment
  )
  if (list.length !== 1) {
    throw new Error(`${owner} asChild requires exactly one child element`)
  }
  return cloneVNode(list[0], itemProps, true)
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
    // Compare before assigning: in uncontrolled mode `current` reads the
    // internal ref, so comparing after the assignment always reports
    // "unchanged" and onChange never fires.
    const previous = current.value
    if (!controlled.value) internal.value = nextValue
    if (!Object.is(previous, nextValue)) options.onChange?.(nextValue)
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
  // Attrs are spread onto the inner content div by hand. Without this, Vue's
  // automatic fallthrough would also apply them to the `anchored` root —
  // duplicating tabIndex/autoFocus onto an element whose supported_events do
  // not include keyDown, and racing the content div for popup focus.
  inheritAttrs: false,
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
