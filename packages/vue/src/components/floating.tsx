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

type InteractiveStyle = Omit<StyleDesc, "hover" | "active">

function floatingSurfaceStateStyle(
  style: InteractiveStyle | undefined
): InteractiveStyle | undefined {
  if (!style) return undefined
  const surface: InteractiveStyle = {}
  if (style.visibility !== undefined) surface.visibility = style.visibility
  if (style.opacity !== undefined) surface.opacity = style.opacity
  if (style.borderRadius !== undefined) surface.borderRadius = style.borderRadius
  if (style.borderTopLeftRadius !== undefined) {
    surface.borderTopLeftRadius = style.borderTopLeftRadius
  }
  if (style.borderTopRightRadius !== undefined) {
    surface.borderTopRightRadius = style.borderTopRightRadius
  }
  if (style.borderBottomRightRadius !== undefined) {
    surface.borderBottomRightRadius = style.borderBottomRightRadius
  }
  if (style.borderBottomLeftRadius !== undefined) {
    surface.borderBottomLeftRadius = style.borderBottomLeftRadius
  }
  return Object.keys(surface).length > 0 ? surface : undefined
}

/**
 * The outer `anchored` surface carries visibility, opacity, and the corner
 * radii (with hover/active refinements of the same keys) so the deferred
 * fallback fill never shows square corners behind rounded content and nested
 * opacity does not multiply against that fill.
 */
function floatingSurfaceStyle(style: StyleDesc | undefined): StyleDesc {
  const surface: StyleDesc = floatingSurfaceStateStyle(style) ?? {}
  const hover = floatingSurfaceStateStyle(style?.hover)
  const active = floatingSurfaceStateStyle(style?.active)
  if (hover) surface.hover = hover
  if (active) surface.active = active
  return surface
}

function withoutOpacity(
  style: InteractiveStyle | undefined
): InteractiveStyle | undefined {
  if (!style) return undefined
  const { opacity: _opacity, ...rest } = style
  return rest
}

/** Content keeps everything except opacity — the surface owns that now. */
function floatingContentStyle(
  style: StyleDesc | undefined
): StyleDesc | undefined {
  if (!style) return undefined
  const { opacity: _opacity, hover, active, ...rest } = style
  return {
    ...rest,
    hover: withoutOpacity(hover),
    active: withoutOpacity(active),
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

      const contentStyle = mergeStyles(
        { backgroundColor: "#1A1A1A" },
        floatingContentStyle(attrs.style as StyleDesc | undefined)
      )

      return h(
        "anchored",
        {
          style: floatingSurfaceStyle(attrs.style as StyleDesc | undefined),
          side: props.side,
          align: props.align,
          gap: props.sideOffset,
          offset,
          fit: "snap",
          snapMargin: props.collisionPadding,
          deferred: true,
          priority: 1,
          // A hidden or non-interactive overlay must not steal hits either.
          occlude:
            (attrs.style as StyleDesc | undefined)?.pointerEvents !== "none",
        },
        [h("div", { ...attrs, style: contentStyle }, slots.default?.())],
      )
    }
  },
})
