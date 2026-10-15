/** Color/shadow transitions share the existing native clock. Resolve pseudo
 * targets in Vue once per interaction; GPUI must not overwrite a sampled
 * motion color with the final hover/active color during paint. */
import { defineComponent, h, ref, watch, type DefineComponent, type PropType, type VNodeRef } from "vue"
import type { EventPayload, MotionStyle, MotionTransition, StyleDesc } from "@gpuiv/vue"
import { duration, ease } from "../tokens.js"

type SurfaceState = { hovered?: boolean; pressed?: boolean }
type SurfaceGeometry = "opacity" | "borderRadius" | "width" | "height"
const colorKeys = ["backgroundColor", "color", "borderColor", "boxShadow"] as const

function background(style: StyleDesc | undefined) {
  return style?.backgroundColor ?? (typeof style?.background === "string" ? style.background : undefined)
}

export function surfaceMotion(style: StyleDesc, state: SurfaceState = {}, geometry: readonly SurfaceGeometry[] = []) {
  const hover = state.hovered ? style.hover : undefined
  const active = state.pressed ? style.active : undefined
  const target: MotionStyle = {}
  const clean: StyleDesc = { ...style }
  const cleanPseudo = (pseudo: StyleDesc | undefined): StyleDesc | undefined => pseudo && { ...pseudo }
  clean.hover = cleanPseudo(style.hover)
  clean.active = cleanPseudo(style.active)

  for (const key of colorKeys) {
    // A CSS gradient is not a solid color, and inherited ink has no local
    // starting color. Preserve native resolution for those cases.
    const gradient = key === "backgroundColor" && [style, style.hover, style.active].some(s => s?.backgroundColor === undefined && typeof s?.background === "object" && s.background != null)
    const base = key === "backgroundColor" ? background(style) : style[key]
    const over = key === "backgroundColor" ? background(hover) : hover?.[key]
    const down = key === "backgroundColor" ? background(active) : active?.[key]
    const futureHover = key === "backgroundColor" ? background(style.hover) : style.hover?.[key]
    const futureActive = key === "backgroundColor" ? background(style.active) : style.active?.[key]
    if (gradient || base === undefined && (futureHover === undefined && futureActive === undefined || key === "color")) {
      Object.assign(target, { [key]: key === "boxShadow" ? [] : null })
      continue
    }
    const value = down ?? over ?? base ?? (key === "boxShadow" ? [] : "transparent")
    Object.assign(target, { [key]: value })
    if (key === "backgroundColor" && typeof clean.background === "string") {
      clean.backgroundColor ??= clean.background
      delete clean.background
    }
    for (const pseudo of [clean.hover, clean.active]) {
      if (!pseudo) continue
      delete pseudo[key]
      if (key === "backgroundColor" && typeof pseudo.background === "string") delete pseudo.background
    }
  }
  for (const key of geometry) {
    const base = style[key] ?? (key === "opacity" ? 1 : key === "borderRadius" ? 0 : undefined)
    const value = active?.[key] ?? hover?.[key] ?? base
    if (typeof base !== "number" || typeof value !== "number") continue
    Object.assign(target, { [key]: value })
    if (clean.hover) delete clean.hover[key]
    if (clean.active) delete clean.active[key]
  }
  return { style: clean, animate: target }
}

function forward(callback: unknown, event: EventPayload) {
  if (Array.isArray(callback)) callback.forEach(fn => forward(fn, event))
  else if (typeof callback === "function") callback(event)
}

/** Internal native div with the same host identity/layout. hostRef explicitly
 * forwards refs to the native node rather than this Vue component instance. */
interface ColorSurfaceProps {
  hostRef?: VNodeRef
  transition?: MotionTransition
  geometry?: SurfaceGeometry[]
  style?: StyleDesc
  [attribute: string]: unknown
}
export const ColorSurface = defineComponent({
  name: "AnimalColorSurface",
  inheritAttrs: false,
  props: {
    hostRef: { type: [Object, Function, String] as PropType<VNodeRef>, default: undefined },
    transition: { type: Object as PropType<MotionTransition>, default: undefined },
    geometry: { type: Array as PropType<SurfaceGeometry[]>, default: () => [] },
  },
  setup(props, { attrs, slots }) {
    const hovered = ref(false), pressed = ref(false)
    const inactive = () => attrs["aria-disabled"] === true || attrs["aria-disabled"] === "true" || (attrs.style as StyleDesc | undefined)?.pointerEvents === "none"
    watch(inactive, value => { if (value) { hovered.value = false; pressed.value = false } })
    return () => {
      const original = attrs.style as StyleDesc | undefined ?? {}
      const surface = surfaceMotion(original, { hovered: hovered.value && !inactive(), pressed: pressed.value && !inactive() }, props.geometry)
      const prior = attrs.motion as { initial?: MotionStyle | false; animate?: MotionStyle; transition?: MotionTransition } | undefined
      const pseudo = !inactive() && (original.hover !== undefined || original.active !== undefined)
      const keyboard = pseudo && ["button", "switch", "checkbox", "radio", "tab", "option"].includes(String(attrs.role))
      return h("div", {
        ...attrs,
        ref: props.hostRef,
        style: surface.style,
        motion: { ...prior, initial: prior?.initial ?? false, animate: { ...surface.animate, ...prior?.animate }, transition: prior?.transition ?? props.transition ?? { duration: duration.base, ease } },
        ...(pseudo ? {
          onMouseEnter: (event: EventPayload) => { hovered.value = true; forward(attrs.onMouseEnter, event) },
          onMouseLeave: (event: EventPayload) => { hovered.value = false; pressed.value = false; forward(attrs.onMouseLeave, event) },
          onMouseDown: (event: EventPayload) => { if (event.button === undefined || event.button === 0) pressed.value = true; forward(attrs.onMouseDown, event) },
          onMouseUp: (event: EventPayload) => { pressed.value = false; forward(attrs.onMouseUp, event) },
        } : {}),
        ...(keyboard ? {
          onKeyDown: (event: EventPayload) => { if (event.key === "enter" || event.key === "space") pressed.value = true; forward(attrs.onKeyDown, event) },
          onKeyUp: (event: EventPayload) => { if (event.key === "enter" || event.key === "space") pressed.value = false; forward(attrs.onKeyUp, event) },
          onBlur: (event: EventPayload) => { pressed.value = false; forward(attrs.onBlur, event) },
        } : {}),
      }, slots.default?.())
    }
  },
}) as DefineComponent<ColorSurfaceProps>
