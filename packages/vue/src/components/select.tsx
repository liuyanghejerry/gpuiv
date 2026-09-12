/** Headless shadcn-shaped Select components rendered with GPUIX host elements. */

import {
  computed,
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  onMounted,
  provide,
  reactive,
  ref,
  watch,
  type InjectionKey,
  type PropType,
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

export interface SelectItemData {
  value: string
  // `unknown` instead of VNodeChild — Vue's VNodeChild is a recursive conditional
  // type that triggers TS2589 on deep instantiations.
  label?: unknown
  textValue?: string
}

interface SelectItemRecord {
  value: string
  disabled: boolean
}

interface SelectContextValue {
  open: boolean
  value: string | undefined
  disabled: boolean
  labels: Map<string, unknown>
  activeValue: string | null
  triggerPressedWhileOpen: boolean
  dismissedByOutsidePress: boolean
  triggerRef: { current: number | null }
  setOpen: (open: boolean) => void
  setActiveValue: (value: string | null) => void
  moveActive: (delta: number) => void
  selectValue: (value: string) => void
  registerItem: (item: SelectItemRecord & { mounted: boolean }) => void
}

const SelectContextKey: InjectionKey<SelectContextValue> = Symbol("gpuiv-select")

function useSelectContext(name: string): SelectContextValue {
  const context = inject(SelectContextKey)
  if (!context) throw new Error(`${name} must be used inside Select`)
  return context
}

export interface SelectProps {
  items?: readonly SelectItemData[]
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
  // Attrs are forwarded by hand below. Without this, Vue also merges them
  // onto the root vnode, where every handler this file overrides is chained
  // with the user's copy — firing that handler twice per event.
  inheritAttrs: false,
  props: {
    items: { type: Array as PropType<readonly SelectItemData[]>, default: undefined },
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
      // Getters keep the controlled props reactive — reading `props.value`
      // once here would pin the state to the mount-time value.
      get value() {
        return props.value
      },
      defaultValue: props.defaultValue,
      onChange: (nextValue) => {
        if (nextValue !== undefined) props.onValueChange?.(nextValue)
      },
    })
    const [open, setOpenState] = useControllableState({
      get value() {
        return props.open
      },
      defaultValue: props.defaultOpen,
      onChange: props.onOpenChange,
    })

    const contextInitial: SelectContextValue = {
      open: false,
      value: undefined,
      disabled: props.disabled,
      labels: new Map(),
      activeValue: null,
      triggerPressedWhileOpen: false,
      dismissedByOutsidePress: false,
      triggerRef: { current: null },
      setOpen: () => {},
      setActiveValue: () => {},
      moveActive: () => {},
      selectValue: () => {},
      registerItem: () => {},
    }
    const context = reactive(contextInitial)

    // Mounted SelectItem children in mount (= document) order. Keyboard nav
    // and clicks read this registry; `items` on Root is only a label lookup
    // for SelectValue while the popup is closed.
    const registeredItems = ref<SelectItemRecord[]>([])

    const labels = computed(() => {
      const next = new Map<string, unknown>()
      for (const item of props.items ?? []) {
        next.set(item.value, item.label ?? item.textValue ?? item.value)
      }
      return next
    })

    const setOpen = (nextOpen: boolean) => {
      setOpenState(nextOpen)
      if (!nextOpen && context.triggerRef.current != null) {
        gpuix.renderer?.focusElement?.(context.triggerRef.current)
      }
    }

    const registerItem = ({
      value: itemValue,
      disabled: itemDisabled,
      mounted,
    }: SelectItemRecord & { mounted: boolean }) => {
      const existing = registeredItems.value.findIndex((item) => item.value === itemValue)
      if (!mounted) {
        if (existing < 0) return
        registeredItems.value = registeredItems.value.filter(
          (item) => item.value !== itemValue,
        )
        return
      }
      if (existing >= 0) {
        registeredItems.value[existing] = { value: itemValue, disabled: itemDisabled }
        return
      }
      registeredItems.value = [
        ...registeredItems.value,
        { value: itemValue, disabled: itemDisabled },
      ]
    }

    // The highlight follows the selected item, so a selected item that mounts
    // after the popup opened becomes the highlight (React: useLayoutEffect on
    // [open, value, itemsVersion]).
    watch(
      [open, value, registeredItems],
      () => {
        if (!open.value) return
        const selected = registeredItems.value.find(
          (item) => item.value === value.value && !item.disabled,
        )
        context.activeValue = selected?.value ?? null
      },
      { flush: "sync" },
    )

    const moveActive = (delta: number) => {
      if (context.disabled) return
      const enabled = registeredItems.value.filter((item) => !item.disabled)
      if (enabled.length === 0) return
      const currentIndex = enabled.findIndex((item) => item.value === context.activeValue)
      const start = currentIndex < 0 ? (delta > 0 ? -1 : 0) : currentIndex
      const nextIndex = (start + delta + enabled.length) % enabled.length
      context.activeValue = enabled[nextIndex].value
    }

    const selectValue = (nextValue: string) => {
      if (context.disabled) return
      const item = registeredItems.value.find((candidate) => candidate.value === nextValue)
      if (!item || item.disabled) return
      setValue(nextValue)
      // Close through `setOpen`, not the raw setter: selecting destroys the
      // focused content div, so focus has to go back to the trigger.
      setOpen(false)
    }

    context.setOpen = setOpen
    context.setActiveValue = (next: string | null) => {
      context.activeValue = next
    }
    context.moveActive = moveActive
    context.selectValue = selectValue
    context.registerItem = registerItem

    // `as any` — the reactive SelectContextValue type is too deep for
    // provide's generic inference on some TS versions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provide(SelectContextKey as any, context)

    return () => {
      context.labels = labels.value
      context.open = open.value
      context.value = value.value
      context.disabled = props.disabled
      return h(
        "div",
        { ...attrs, style: floatingRootStyle(attrs.style as StyleDesc | undefined) },
        (slots.default?.() ?? []) as VNodeChild[],
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
  inheritAttrs: false,
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
            else context.moveActive(1)
          } else if (
            event.key === "up" ||
            (event.key === "p" && event.modifiers?.ctrl)
          ) {
            if (!context.open) context.setOpen(true)
            else context.moveActive(-1)
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
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    const context = useSelectContext("SelectValue")
    return () => {
      const label =
        context.value === undefined ? undefined : context.labels.get(context.value)
      const content =
        slots.default?.() ?? label ?? context.value ?? attrs.placeholder ?? null
      return h("div", attrs as Record<string, unknown>, [content as VNodeChild])
    }
  },
})

export interface SelectContentProps extends FloatingContentProps {
  onEscapeKeyDown?: (event: EventPayload) => void
}

export const SelectContent = defineComponent({
  inheritAttrs: false,
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
            return
          }
          if (context.disabled) return
          if (
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
  style?: StateStyle<SelectItemState>
}

export const SelectItem = defineComponent({
  inheritAttrs: false,
  props: {
    value: { type: String, required: true },
    disabled: { type: Boolean, default: false },
  },
  setup(props, { attrs, slots }) {
    const context = useSelectContext("SelectItem")
    // Register in mount hooks, not on every render, so a middle item that
    // re-renders alone keeps its place in keyboard order (React:
    // useLayoutEffect, not a callback ref).
    onMounted(() => {
      context.registerItem({ value: props.value, disabled: props.disabled, mounted: true })
    })
    onBeforeUnmount(() => {
      context.registerItem({ value: props.value, disabled: props.disabled, mounted: false })
    })
    watch(
      () => [props.value, props.disabled] as const,
      ([value, disabled], [oldValue, oldDisabled]) => {
        context.registerItem({ value: oldValue, disabled: oldDisabled, mounted: false })
        context.registerItem({ value, disabled, mounted: true })
      },
    )
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
          if (!props.disabled && !context.disabled) context.setActiveValue(props.value)
        },
        onClick: (event: EventPayload) => {
          ;(attrs.onClick as ((event: EventPayload) => void) | undefined)?.(event)
          if (!props.disabled && !context.disabled) context.selectValue(props.value)
        },
      }
      return h("div", itemProps, slots.default?.(state))
    }
  },
})

export const SelectGroup = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h("div", attrs, slots.default?.())
  },
})

export const SelectLabel = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h("div", attrs, slots.default?.())
  },
})

export const SelectSeparator = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs }) {
    return () => h("div", attrs)
  },
})

export const SelectScrollUpButton = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h("div", attrs, slots.default?.())
  },
})

export const SelectScrollDownButton = defineComponent({
  inheritAttrs: false,
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
