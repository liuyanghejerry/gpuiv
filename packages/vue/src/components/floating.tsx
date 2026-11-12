/** Shared state and positioning helpers for headless floating controls. */

import {
  computed,
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  type InjectionKey,
  type Ref,
} from "vue"
import { cloneVNode, isVNode, Comment, Text } from "vue"
import type { PropType, VNode, VNodeChild } from "vue"
import type { StyleDesc, KeyEvent } from "../types.js"
import { useGpuix } from "../hooks/use-gpuix.js"
import { pushDismissLayer, type DismissLayer } from "../reconciler/event-registry.js"

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
  if (style.backgroundColor !== undefined) surface.backgroundColor = style.backgroundColor
  if (style.background !== undefined) surface.background = style.background
  if (style.boxShadow !== undefined) surface.boxShadow = style.boxShadow
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
 * The outer `anchored` surface owns the fill, shadows, visibility, opacity and corner
 * radii. Painting the fill once preserves alpha and lets the complete surface
 * animate together, including explicit transparent SVG silhouettes.
 */
function floatingSurfaceStyle(style: StyleDesc | undefined): StyleDesc {
  const surface: StyleDesc = floatingSurfaceStateStyle(style) ?? {}
  if (surface.backgroundColor === undefined && surface.background === undefined) {
    surface.backgroundColor = "#1A1A1A"
  }
  const hover = floatingSurfaceStateStyle(style?.hover)
  const active = floatingSurfaceStateStyle(style?.active)
  if (hover) surface.hover = hover
  if (active) surface.active = active
  return surface
}

function withoutSurfacePaint(
  style: InteractiveStyle | undefined
): InteractiveStyle | undefined {
  if (!style) return undefined
  const { opacity: _opacity, backgroundColor: _color, background: _background, boxShadow: _shadow, ...rest } = style
  return rest
}

/** Content owns layout and borders; surface fill and opacity must not repeat. */
function floatingContentStyle(
  style: StyleDesc | undefined
): StyleDesc | undefined {
  if (!style) return undefined
  const { opacity: _opacity, backgroundColor: _color, background: _background, boxShadow: _shadow, hover, active, ...rest } = style
  return {
    ...rest,
    hover: withoutSurfacePaint(hover),
    active: withoutSurfacePaint(active),
  }
}

export interface ControllableStateOptions<Value> {
  value: Value | undefined
  defaultValue: Value
  onChange?: (value: Value) => void
}

/** Vue version of React's useControllableState — a ref plus a setter. */export function useControllableState<Value>(
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

/** Anything a framework hands out for a mounted host element. */
export interface FocusableNode {
  readonly id: number
}

/**
 * Where an overlay moves focus when it opens or closes, like Base UI's
 * `initialFocus` / `finalFocus`:
 *
 * - `true` or unset: the overlay's default target
 * - `false`: focus does not move
 * - an element or a ref to one: that element
 * - a function: returns one of the above; `null` means the default
 */
type FocusTargetValue<Node extends FocusableNode> =
  | boolean
  | Node
  | { readonly current: Node | null }
  | { readonly value: Node | null }

export type FocusTarget<Node extends FocusableNode = FocusableNode> =
  | FocusTargetValue<Node>
  | (() => FocusTargetValue<Node> | null | undefined)

/** Resolve a `FocusTarget` to an element id, or null when focus must stay. */
export function resolveFocusTarget<Node extends FocusableNode>(
  target: FocusTarget<Node> | undefined,
  fallback: () => number | null
): number | null {
  const value = typeof target === "function" ? target() : target
  if (value === undefined && typeof target === "function") return null
  if (value === undefined || value === null || value === true) return fallback()
  if (value === false) return null
  if ("current" in value) return value.current?.id ?? fallback()
  if ("value" in value) return value.value?.id ?? fallback()
  return value.id
}

const DismissLayerContextKey: InjectionKey<DismissLayer> = Symbol("gpuiv-dismiss-layer")

export interface DismissableLayerProps {
  /** Escape reached the window, this layer is on top, and nothing prevented it. */
  onEscapeKeyDown: (event: KeyEvent) => void
  /** Element id to focus when the layer opens; null leaves focus alone. */
  initialFocus?: () => number | null
  /** Element id to focus when the layer closes; null leaves focus alone. */
  finalFocus?: (previous: number | null) => number | null
}

/**
 * Registers its subtree as a dismiss layer on the renderer's stack. When
 * Escape reaches the window unprevented, only the top layer's
 * `onEscapeKeyDown` runs — one Escape closes one overlay, the innermost one.
 * Nesting decides stacking, not mount order: a Dialog and a Select that open
 * in one commit still put the Select above the Dialog.
 */
export const DismissableLayer = defineComponent({
  name: "DismissableLayer",
  props: {
    onEscapeKeyDown: {
      type: Function as PropType<(event: KeyEvent) => void>,
      required: true,
    },
    initialFocus: {
      type: Function as PropType<() => number | null>,
      default: undefined,
    },
    finalFocus: {
      type: Function as PropType<(previous: number | null) => number | null>,
      default: undefined,
    },
  },
  setup(props, { slots }) {
    const { renderer } = useGpuix()
    const parent = inject(DismissLayerContextKey, undefined)
    // Read during setup, before this layer's elements are committed. After
    // the commit an autoFocus inside the layer may already have taken focus.
    const previousFocus = renderer?.getFocusedElementId?.() ?? null
    const layer: DismissLayer = {
      parent,
      onEscapeKeyDown: (event) => props.onEscapeKeyDown(event),
      initialFocus: () => props.initialFocus?.() ?? null,
      finalFocus: (previous) => props.finalFocus?.(previous) ?? null,
    }
    let remove: (() => void) | undefined
    onMounted(() => {
      if (!renderer) return
      remove = pushDismissLayer(renderer, layer, { previousFocus })
    })
    onBeforeUnmount(() => remove?.())
    provide(DismissLayerContextKey, layer)
    return () => slots.default?.()
  },
})

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

      const { motion, ...contentAttrs } = attrs
      const surfaceStyle = floatingSurfaceStyle(attrs.style as StyleDesc | undefined)
      if (motion) surfaceStyle.position = "relative"

      return h(
        "anchored",
        {
          style: surfaceStyle,
          ...(motion === undefined ? {} : { motion }),
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
        [h("div", { ...contentAttrs, style: floatingContentStyle(attrs.style as StyleDesc | undefined) }, slots.default?.())],
      )
    }
  },
})
