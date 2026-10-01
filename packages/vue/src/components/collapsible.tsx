/** Base UI's Root / Trigger / Panel split, rendered with GPUIV host elements. */
import { computed, defineComponent, h, inject, provide, ref, watch, type ComponentPublicInstance, type InjectionKey, type PropType } from "vue"
import type { EventPayload } from "@gpuiv/native"
import type { HostNode, MotionTransition } from "../types.js"
import { useGpuix } from "../hooks/use-gpuix.js"
import { AnimateHeight } from "./animate-height.js"
import { cloneAsChild, resolveStyle, useControllableState, type StateStyle } from "./floating.js"

export interface CollapsibleState { open: boolean; disabled: boolean }
export interface CollapsibleProps {
  open?: boolean
  defaultOpen?: boolean
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
  style?: StateStyle<CollapsibleState>
}
export interface CollapsibleTriggerProps {
  disabled?: boolean
  asChild?: boolean
  tabIndex?: number
  style?: StateStyle<CollapsibleState>
}
export interface CollapsiblePanelProps {
  keepMounted?: boolean
  /** Height transition in seconds. Set zero for immediate layout changes. */
  duration?: number
  ease?: MotionTransition["ease"]
  style?: StateStyle<CollapsibleState>
}

interface Context {
  state: Readonly<{ value: CollapsibleState }>
  trigger: HostNode | null
  toggle(): void
}
const key: InjectionKey<Context> = Symbol("gpuiv-collapsible")
function contextFor(name: string): Context {
  const context = inject(key)
  if (!context) throw new Error(`${name} must be used inside Collapsible`)
  return context
}
function callHandler(handler: unknown, event: EventPayload): void {
  for (const fn of Array.isArray(handler) ? handler : [handler]) if (typeof fn === "function") fn(event)
}
function contains(node: HostNode | null, id: number): boolean {
  return !!node && (node.id === id || node.children.some((child) => contains(child, id)))
}

export const Collapsible = defineComponent({
  name: "Collapsible",
  inheritAttrs: false,
  props: {
    open: { type: Boolean, default: undefined },
    defaultOpen: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    onOpenChange: { type: Function as PropType<(open: boolean) => void>, default: undefined },
  },
  emits: ["update:open"],
  setup(props, { attrs, slots, emit }) {
    const [open, setOpen] = useControllableState({
      get value() { return props.open },
      defaultValue: props.defaultOpen,
      onChange: (next) => { props.onOpenChange?.(next); emit("update:open", next) },
    })
    const state = computed(() => ({ open: open.value, disabled: props.disabled }))
    const context: Context = { state, trigger: null, toggle: () => { if (!props.disabled) setOpen(!open.value) } }
    provide(key, context)
    return () => h("div", { ...attrs,
      style: { display: "flex", flexDirection: "column", ...resolveStyle(attrs.style as StateStyle<CollapsibleState>, state.value) },
    }, slots.default?.(state.value))
  },
})

export const CollapsibleTrigger = defineComponent({
  name: "CollapsibleTrigger",
  inheritAttrs: false,
  props: {
    disabled: { type: Boolean, default: false },
    asChild: { type: Boolean, default: false },
    tabIndex: { type: Number, default: 0 },
  },
  setup(props, { attrs, slots }) {
    const context = contextFor("CollapsibleTrigger")
    return () => {
      const state = { ...context.state.value, disabled: props.disabled || context.state.value.disabled }
      const triggerProps = { ...attrs, role: "button", "aria-expanded": state.open,
        tabIndex: state.disabled ? -1 : props.tabIndex,
        style: resolveStyle(attrs.style as StateStyle<CollapsibleState>, state),
        ref: (node: HostNode | ComponentPublicInstance | null) => {
          context.trigger = node && "$el" in node ? node.$el as HostNode : node
        },
        onClick: (event: EventPayload) => { if (state.disabled) return; callHandler(attrs.onClick, event); context.toggle() },
        onKeyDown: (event: EventPayload) => {
          if (state.disabled) return
          callHandler(attrs.onKeyDown, event)
          if (!event.isHeld && !event.modifiers?.alt && !event.modifiers?.ctrl && !event.modifiers?.cmd &&
            (event.key === "enter" || event.key === "space")) context.toggle()
        },
      }
      const children = slots.default?.(state)
      return props.asChild ? cloneAsChild("CollapsibleTrigger", children, triggerProps) : h("div", triggerProps, children)
    }
  },
})

export const CollapsiblePanel = defineComponent({
  name: "CollapsiblePanel",
  inheritAttrs: false,
  props: {
    keepMounted: { type: Boolean, default: false },
    duration: { type: Number, default: 0.2 },
    ease: { type: [String, Array] as PropType<NonNullable<MotionTransition["ease"]>>, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const context = contextFor("CollapsiblePanel")
    const { renderer } = useGpuix()
    const content = ref<HostNode | null>(null)
    const present = ref(context.state.value.open)
    let initialHeight = context.state.value.open ? undefined : 0
    watch(() => context.state.value.open, (open) => {
      if (open) { initialHeight = 0; present.value = true }
      else {
        const focused = renderer?.getFocusedElementId?.()
        const trigger = context.trigger?.id
        if (focused != null && contains(content.value, focused) && trigger != null) renderer?.focusElement?.(trigger)
        if (props.duration === 0) present.value = false
      }
    }, { flush: "sync" })
    return () => {
      if (!Number.isFinite(props.duration) || props.duration < 0) throw new Error("CollapsiblePanel duration must be finite and non-negative")
      const state = context.state.value
      if (!state.open && !present.value && !props.keepMounted) return null
      const complete = (event: EventPayload) => {
        if (!context.state.value.open) present.value = false
        callHandler(attrs.onMotionComplete, event)
      }
      const { style: _style, onMotionComplete: _complete, ...panelAttrs } = attrs
      const body = () => h("div", { ref: content,
        // Keep the body painted while its height closes. Once the transition
        // ends, GPUI invisible suppresses retained content and its Tab stops.
        style: { visibility: state.open || present.value ? "visible" : "hidden" },
      }, state.open || present.value || props.keepMounted ? slots.default?.(state) : undefined)
      if (props.duration === 0) return h("div", { ...panelAttrs,
        style: { flexShrink: 0, ...resolveStyle(attrs.style as StateStyle<CollapsibleState>, state),
          ...(!state.open ? { height: 0, overflow: "hidden" } : {}) },
      }, body())
      return h(AnimateHeight, { ...panelAttrs, height: state.open ? "auto" : 0, initialHeight,
        duration: props.duration, ease: props.ease,
        style: resolveStyle(attrs.style as StateStyle<CollapsibleState>, state), onMotionComplete: complete,
      }, { default: body })
    }
  },
})
