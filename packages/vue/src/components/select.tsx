/** Headless shadcn-shaped Select components rendered with GPUIX host elements. */

import {
  defineComponent,
  h,
  inject,
  isVNode,
  provide,
  reactive,
  Text,
  type InjectionKey,
  type PropType,
  type VNode,
  type VNodeChild,
} from "vue"
import type { EventPayload } from "@gpuiv/native"
import type { StyleDesc } from "../types.js"
import { useGpuix } from "../hooks/use-gpuix.js"
import {
  FloatingLayer,
  floatingRootStyle,
  resolveStyle,
  useControllableState,
} from "./floating.js"
import type { FloatingContentProps, StateStyle } from "./floating.js"

interface SelectItemRecord {
  value: string
  // `unknown` instead of VNodeChild — Vue's VNodeChild is a recursive conditional
  // type that triggers TS2589 on deep instantiations.
  label: unknown
  textValue: string
  disabled: boolean
}

interface SelectContextValue {
  open: boolean
  value: string | undefined
  disabled: boolean
  items: SelectItemRecord[]
  activeValue: string | null
  triggerPressedWhileOpen: boolean
  dismissedByOutsidePress: boolean
  triggerRef: { current: number | null }
  setOpen: (open: boolean) => void
  setActiveValue: (value: string | null) => void
  moveActive: (delta: number) => void
  selectValue: (value: string) => void
}

const SelectContextKey: InjectionKey<SelectContextValue> = Symbol("gpuiv-select")

function useSelectContext(name: string): SelectContextValue {
  const context = inject(SelectContextKey)
  if (!context) throw new Error(`${name} must be used inside Select`)
  return context
}

function textContent(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (!isVNode(node)) return ""
  if (node.type === Text) return String(node.children ?? "")
  const children = childList(node as VNode)
  return children.map(textContent).join("")
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function childList(vnode: VNode): any[] {
  const children = vnode.children
  if (Array.isArray(children)) return children as any[]
  if (typeof children === "function") return [children]
  if (children && typeof children === "object") {
    const slotsObj = children as Record<string, (args?: unknown) => unknown>
    if (typeof slotsObj.default === "function") {
      const out = slotsObj.default({})
      return Array.isArray(out) ? out : [out]
    }
  }
  return []
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectItems(node: any, items: SelectItemRecord[] = []): SelectItemRecord[] {
  if (Array.isArray(node)) {
    for (const child of node) collectItems(child, items)
    return items
  }
  if (!isVNode(node)) return items
  if (node.type === SelectItem) {
    const props = node.props as {
      value: string
      disabled?: boolean
      textValue?: string
      children?: unknown
    }
    const raw = childList(node)
    const hasRenderProp = typeof raw[0] === "function"
    items.push({
      value: props.value,
      label: hasRenderProp ? props.textValue : (node.children as unknown),
      textValue:
        props.textValue ??
        (hasRenderProp ? "" : textContent(node.children)),
      disabled: props.disabled ?? false,
    })
    return items
  }
  for (const child of childList(node)) collectItems(child, items)
  return items
}

export interface SelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  style?: StyleDesc
}

export const Select = defineComponent({
  props: {
    value: { type: String, default: undefined },
    defaultValue: { type: String, default: undefined },
    onValueChange: { type: Function as PropType<(value: string) => void>, default: undefined },
    open: { type: Boolean, default: undefined },
    defaultOpen: { type: Boolean, default: false },
    onOpenChange: { type: Function as PropType<(open: boolean) => void>, default: undefined },
    disabled: { type: Boolean, default: false },
  },
  setup(props, { attrs, slots }) {
    const gpuix = useGpuix()
    const [value, setValue] = useControllableState<string | undefined>({
      value: props.value,
      // `defaultValue` may be undefined — keep the ref's type safe.
      defaultValue: props.defaultValue,
      onChange: (nextValue) => {
        if (nextValue !== undefined) props.onValueChange?.(nextValue)
      },
    })
    const [open, setOpenState] = useControllableState({
      value: props.open,
      defaultValue: props.defaultOpen,
      onChange: props.onOpenChange,
    })

    const contextInitial: SelectContextValue = {
      open: false,
      value: undefined,
      disabled: props.disabled,
      items: [],
      activeValue: null,
      triggerPressedWhileOpen: false,
      dismissedByOutsidePress: false,
      triggerRef: { current: null },
      setOpen: () => {},
      setActiveValue: () => {},
      moveActive: () => {},
      selectValue: () => {},
    }
    const context = reactive(contextInitial)

    const setOpen = (nextOpen: boolean) => {
      setOpenState(nextOpen)
      if (nextOpen) {
        const selected = context.items.find(
          (item) => item.value === value.value && !item.disabled,
        )
        context.activeValue = selected?.value ?? null
      } else if (context.triggerRef.current != null) {
        gpuix.renderer?.focusElement?.(context.triggerRef.current)
      }
    }

    const moveActive = (delta: number) => {
      const enabled = context.items.filter((item) => !item.disabled)
      if (enabled.length === 0) return
      const currentIndex = enabled.findIndex((item) => item.value === context.activeValue)
      const start = currentIndex < 0 ? (delta > 0 ? -1 : 0) : currentIndex
      const nextIndex = (start + delta + enabled.length) % enabled.length
      context.activeValue = enabled[nextIndex].value
    }

    const selectValue = (nextValue: string) => {
      const item = context.items.find((candidate) => candidate.value === nextValue)
      if (!item || item.disabled) return
      setValue(nextValue)
      setOpenState(false)
    }

    context.setOpen = setOpen
    context.setActiveValue = (next: string | null) => {
      context.activeValue = next
    }
    context.moveActive = moveActive
    context.selectValue = selectValue

    // `as any` — the reactive SelectContextValue type is too deep for
    // provide's generic inference on some TS versions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provide(SelectContextKey as any, context)

    return () => {
      const children = (slots.default?.() ?? []) as unknown[]
      const collected: SelectItemRecord[] = collectItems(children);
      ;(context as unknown as { items: SelectItemRecord[] }).items = collected
      context.open = open.value
      context.value = value.value
      context.disabled = props.disabled
      return h(
        "div",
        { ...attrs, style: floatingRootStyle(attrs.style as StyleDesc | undefined) },
        children as VNodeChild[],
      )
    }
  },
})

export interface SelectTriggerState {
  open: boolean
  disabled: boolean
  placeholder: boolean
}

export interface SelectTriggerProps {
  disabled?: boolean
  style?: StateStyle<SelectTriggerState>
  tabIndex?: number
}

export const SelectTrigger = defineComponent({
  props: {
    disabled: { type: Boolean, default: undefined },
    tabIndex: { type: Number, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const context = useSelectContext("SelectTrigger")
    return () => {
      const disabled = props.disabled ?? context.disabled
      const state: SelectTriggerState = {
        open: context.open,
        disabled,
        placeholder: context.value === undefined,
      }
      const triggerProps: Record<string, unknown> = {
        ...(attrs as Record<string, unknown>),
        tabIndex: disabled ? -1 : (props.tabIndex ?? 0),
        style: resolveStyle(
          attrs.style as StateStyle<SelectTriggerState> | undefined,
          state,
        ),
        ref: (node: { id: number } | null) => {
          context.triggerRef.current = node?.id ?? null
        },
        onMouseDown: (event: EventPayload) => {
          ;(attrs.onMouseDown as ((event: EventPayload) => void) | undefined)?.(event)
          context.triggerPressedWhileOpen = context.open
        },
        onClick: (event: EventPayload) => {
          ;(attrs.onClick as ((event: EventPayload) => void) | undefined)?.(event)
          if (disabled) return
          if (context.dismissedByOutsidePress) {
            context.dismissedByOutsidePress = false
            return
          }
          if (context.triggerPressedWhileOpen) {
            context.triggerPressedWhileOpen = false
            context.setOpen(false)
            return
          }
          context.setOpen(!context.open)
        },
        onKeyDown: (event: EventPayload) => {
          ;(attrs.onKeyDown as ((event: EventPayload) => void) | undefined)?.(event)
          if (disabled) return
          if (event.key === "escape") {
            context.setOpen(false)
          } else if (
            event.key === "down" ||
            (event.key === "n" && event.modifiers?.ctrl)
          ) {
            if (!context.open) context.setOpen(true)
            context.moveActive(1)
          } else if (
            event.key === "up" ||
            (event.key === "p" && event.modifiers?.ctrl)
          ) {
            if (!context.open) context.setOpen(true)
            context.moveActive(-1)
          } else if (event.key === "enter" || event.key === "space") {
            context.setOpen(!context.open)
          }
        },
      }
      return h("div", triggerProps, slots.default?.())
    }
  },
})

export interface SelectValueProps {
  placeholder?: unknown
  style?: StyleDesc
}

export const SelectValue = defineComponent({
  setup(_, { attrs, slots }) {
    const context = useSelectContext("SelectValue")
    return () => {
      const item = context.items.find((candidate) => candidate.value === context.value)
      const content = slots.default?.() ?? item?.label ?? (attrs.placeholder ?? null)
      return h("div", attrs as Record<string, unknown>, [content as VNodeChild])
    }
  },
})

export interface SelectContentProps extends FloatingContentProps {
  onEscapeKeyDown?: (event: EventPayload) => void
}

export const SelectContent = defineComponent({
  props: {
    side: { type: String, default: undefined },
    sideOffset: { type: Number, default: undefined },
    align: { type: String, default: undefined },
    alignOffset: { type: Number, default: undefined },
    collisionPadding: { type: Number, default: undefined },
    tabIndex: { type: Number, default: 0 },
  },
  setup(props, { attrs, slots }) {
    const context = useSelectContext("SelectContent")
    return () => {
      if (!context.open) return null
      const layerProps: Record<string, unknown> = {
        side: props.side ?? "bottom",
        sideOffset: props.sideOffset ?? 0,
        align: props.align ?? "start",
        alignOffset: props.alignOffset ?? 0,
        collisionPadding: props.collisionPadding ?? 8,
        ...attrs,
        tabIndex: props.tabIndex,
        autoFocus: true,
        style: attrs.style as StyleDesc | undefined,
        onMouseDownOutside: (event: EventPayload) => {
          ;(attrs.onMouseDownOutside as ((event: EventPayload) => void) | undefined)?.(event)
          context.dismissedByOutsidePress = true
          queueMicrotask(() => {
            context.dismissedByOutsidePress = false
          })
          context.setOpen(false)
        },
        onKeyDown: (event: EventPayload) => {
          ;(attrs.onKeyDown as ((event: EventPayload) => void) | undefined)?.(event)
          if (event.key === "escape") {
            ;(attrs.onEscapeKeyDown as ((event: EventPayload) => void) | undefined)?.(event)
            context.setOpen(false)
          } else if (
            event.key === "down" ||
            (event.key === "n" && event.modifiers?.ctrl)
          ) {
            context.moveActive(1)
          } else if (
            event.key === "up" ||
            (event.key === "p" && event.modifiers?.ctrl)
          ) {
            context.moveActive(-1)
          } else if (
            (event.key === "enter" || event.key === "space") &&
            context.activeValue
          ) {
            context.selectValue(context.activeValue)
          }
        },
      }
      return h(FloatingLayer, layerProps, slots.default?.())
    }
  },
})

export interface SelectItemState {
  selected: boolean
  highlighted: boolean
  disabled: boolean
}

export interface SelectItemProps {
  value: string
  disabled?: boolean
  textValue?: string
  style?: StateStyle<SelectItemState>
}

export const SelectItem = defineComponent({
  props: {
    value: { type: String, required: true },
    disabled: { type: Boolean, default: false },
    textValue: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const context = useSelectContext("SelectItem")
    return () => {
      const state: SelectItemState = {
        selected: context.value === props.value,
        highlighted: context.activeValue === props.value,
        disabled: props.disabled,
      }
      const itemProps: Record<string, unknown> = {
        ...attrs,
        style: resolveStyle(
          attrs.style as StateStyle<SelectItemState> | undefined,
          state,
        ),
        onMouseEnter: (event: EventPayload) => {
          ;(attrs.onMouseEnter as ((event: EventPayload) => void) | undefined)?.(event)
          if (!props.disabled) context.setActiveValue(props.value)
        },
        onClick: (event: EventPayload) => {
          ;(attrs.onClick as ((event: EventPayload) => void) | undefined)?.(event)
          if (!props.disabled) context.selectValue(props.value)
        },
      }
      return h("div", itemProps, slots.default?.(state))
    }
  },
})

export const SelectGroup = defineComponent({
  setup(_, { attrs, slots }) {
    return () => h("div", attrs, slots.default?.())
  },
})

export const SelectLabel = defineComponent({
  setup(_, { attrs, slots }) {
    return () => h("div", attrs, slots.default?.())
  },
})

export const SelectSeparator = defineComponent({
  setup(_, { attrs }) {
    return () => h("div", attrs)
  },
})

export const SelectScrollUpButton = defineComponent({
  setup(_, { attrs, slots }) {
    return () => h("div", attrs, slots.default?.())
  },
})

export const SelectScrollDownButton = defineComponent({
  setup(_, { attrs, slots }) {
    return () => h("div", attrs, slots.default?.())
  },
})

export {
  Select as Root,
  SelectContent as Content,
  SelectGroup as Group,
  SelectItem as Item,
  SelectLabel as Label,
  SelectScrollDownButton as ScrollDownButton,
  SelectScrollUpButton as ScrollUpButton,
  SelectSeparator as Separator,
  SelectTrigger as Trigger,
  SelectValue as Value,
}
