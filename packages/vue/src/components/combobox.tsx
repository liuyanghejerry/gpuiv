/** Headless shadcn-shaped Combobox components with native GPUI text input. */

import {
  defineComponent,
  h,
  inject,
  provide,
  reactive,
  type InjectionKey,
  type PropType,
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

export type ComboboxValue = string | string[] | null

interface ComboboxContextValue {
  open: boolean
  disabled: boolean
  multiple: boolean
  value: ComboboxValue
  inputValue: string
  filteredItems: readonly string[]
  activeIndex: number | null
  inputRef: { current: { id: number } | null }
  itemToString: (item: string) => string
  setOpen: (open: boolean) => void
  setInputValue: (value: string) => void
  setActiveIndex: (index: number | null) => void
  moveActive: (delta: number) => void
  selectItem: (item: string) => void
  registerItem: (item: { value: string; disabled: boolean; mounted: boolean }) => void
}

const ComboboxContextKey: InjectionKey<ComboboxContextValue> = Symbol("gpuiv-combobox")

function useComboboxContext(name: string): ComboboxContextValue {
  const context = inject(ComboboxContextKey)
  if (!context) throw new Error(`${name} must be used inside Combobox`)
  return context
}

function defaultFilter({
  items,
  query,
  itemToString,
}: {
  items: readonly string[]
  query: string
  itemToString: (item: string) => string
}): string[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return [...items]
  const matches: Array<{ item: string; rank: number; index: number }> = []
  items.forEach((item, index) => {
    const label = itemToString(item).toLowerCase()
    const rank = label.startsWith(normalized) ? 0 : label.includes(normalized) ? 1 : null
    if (rank !== null) matches.push({ item, rank, index })
  })
  return matches
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((match) => match.item)
}

export interface ComboboxProps {
  items?: readonly string[]
  value?: ComboboxValue
  defaultValue?: ComboboxValue
  onValueChange?: (value: ComboboxValue) => void
  inputValue?: string
  defaultInputValue?: string
  onInputValueChange?: (value: string) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  multiple?: boolean
  disabled?: boolean
  autoHighlight?: boolean | "always"
  filter?: null | ((item: string, query: string, itemToString: (item: string) => string) => boolean)
  itemToStringValue?: (item: string) => string
  style?: StyleDesc
}

export const Combobox = defineComponent({
  props: {
    items: { type: Array as PropType<readonly string[]>, default: () => [] },
    value: { type: null, default: undefined },
    defaultValue: { type: null, default: null },
    onValueChange: { type: Function as PropType<(value: ComboboxValue) => void>, default: undefined },
    inputValue: { type: String, default: undefined },
    defaultInputValue: { type: String, default: "" },
    onInputValueChange: { type: Function as PropType<(value: string) => void>, default: undefined },
    open: { type: Boolean, default: undefined },
    defaultOpen: { type: Boolean, default: false },
    onOpenChange: { type: Function as PropType<(open: boolean) => void>, default: undefined },
    multiple: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    autoHighlight: { type: [Boolean, String], default: false },
    // `null` disables filtering; a function filters, undefined defaults.
    filter: { type: Function as unknown as PropType<ComboboxProps["filter"]>, default: undefined },
    itemToStringValue: { type: Function as PropType<(item: string) => string>, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const gpuix = useGpuix()
    const [value, setValue] = useControllableState<ComboboxValue>({
      value: props.value as ComboboxValue | undefined,
      defaultValue: props.defaultValue as ComboboxValue,
      onChange: props.onValueChange,
    })
    const [inputValue, setInputValueState] = useControllableState({
      value: props.inputValue,
      defaultValue: props.defaultInputValue,
      onChange: props.onInputValueChange,
    })
    const [open, setOpenState] = useControllableState({
      value: props.open,
      defaultValue: props.defaultOpen,
      onChange: props.onOpenChange,
    })

    const contextInitial: ComboboxContextValue = {
      open: false,
      disabled: props.disabled,
      multiple: props.multiple,
      value: null,
      inputValue: "",
      filteredItems: [],
      activeIndex: null,
      inputRef: { current: null },
      itemToString: (item) => item,
      setOpen: () => {},
      setInputValue: () => {},
      setActiveIndex: () => {},
      moveActive: () => {},
      selectItem: () => {},
      registerItem: () => {},
    }
    const context = reactive(contextInitial)
    const disabledItems = new Set<string>()

    const itemToString = props.itemToStringValue ?? ((item: string) => item)
    const filterItems = (query: string): string[] => {
      if (props.filter === null) return [...props.items]
      if (props.filter) {
        return props.items.filter((item) => props.filter!(item, query, itemToString))
      }
      return defaultFilter({ items: props.items, query, itemToString })
    }

    const setOpen = (nextOpen: boolean) => {
      setOpenState(nextOpen)
      if (nextOpen) {
        queueMicrotask(() => {
          if (context.inputRef.current?.id != null) {
            gpuix.renderer?.focusElement?.(context.inputRef.current.id)
          }
        })
      }
    }

    const updateInputValue = (nextValue: string) => {
      setInputValueState(nextValue)
      const nextItems = filterItems(nextValue)
      const firstEnabled = nextItems.findIndex((item) => !disabledItems.has(item))
      context.activeIndex =
        props.autoHighlight && firstEnabled >= 0 ? firstEnabled : null
    }

    const moveActive = (delta: number) => {
      const filtered = context.filteredItems
      if (filtered.length === 0) return
      let nextIndex = context.activeIndex === null ? (delta > 0 ? -1 : 0) : context.activeIndex
      for (let checked = 0; checked < filtered.length; checked++) {
        nextIndex = (nextIndex + delta + filtered.length) % filtered.length
        if (!disabledItems.has(filtered[nextIndex])) {
          context.activeIndex = nextIndex
          return
        }
      }
    }

    const selectItem = (item: string) => {
      if (props.disabled || disabledItems.has(item)) return
      if (props.multiple) {
        const selected = Array.isArray(value.value) ? value.value : []
        const exists = selected.includes(item)
        setValue(exists ? selected.filter((candidate) => candidate !== item) : [...selected, item])
        setInputValueState("")
        context.activeIndex = null
        return
      }
      setValue(item)
      setInputValueState(itemToString(item))
      setOpenState(false)
      context.activeIndex = null
    }

    const registerItem = ({ value: item, disabled, mounted }: {
      value: string
      disabled: boolean
      mounted: boolean
    }) => {
      disabledItems.delete(item)
      if (mounted && disabled) disabledItems.add(item)
    }

    context.setOpen = setOpen
    context.setInputValue = updateInputValue
    context.setActiveIndex = (index: number | null) => {
      context.activeIndex = index
    }
    context.moveActive = moveActive
    context.selectItem = selectItem
    context.registerItem = registerItem
    context.itemToString = itemToString
    context.multiple = props.multiple

    provide(ComboboxContextKey, context)

    return () => {
      context.disabled = props.disabled
      context.open = open.value
      context.value = value.value
      context.inputValue = inputValue.value
      context.filteredItems = filterItems(inputValue.value)
      return h(
        "div",
        {
          ...(attrs as Record<string, unknown>),
          style: floatingRootStyle(attrs.style as StyleDesc | undefined),
        },
        slots.default?.(),
      )
    }
  },
})

export interface ComboboxInputProps {
  disabled?: boolean
  placeholder?: string
  readOnly?: boolean
}

export const ComboboxInput = defineComponent({
  props: {
    disabled: { type: Boolean, default: undefined },
    placeholder: { type: String, default: undefined },
    readOnly: { type: Boolean, default: undefined },
  },
  setup(props, { attrs }) {
    const context = useComboboxContext("ComboboxInput")
    return () => {
      const disabled = props.disabled ?? context.disabled
      const inputProps: Record<string, unknown> = {
        ...(attrs as Record<string, unknown>),
        ref: (node: { id: number } | null) => {
          context.inputRef.current = node
        },
        value: context.inputValue,
        readOnly: disabled || props.readOnly,
        autoFocus: context.open,
        onClick: (event: EventPayload) => {
          ;(attrs.onClick as ((event: EventPayload) => void) | undefined)?.(event)
          if (!disabled) context.setOpen(true)
        },
        onFocus: (event: EventPayload) => {
          ;(attrs.onFocus as ((event: EventPayload) => void) | undefined)?.(event)
          if (!disabled) context.setOpen(true)
        },
        onChange: (event: EventPayload) => {
          ;(attrs.onChange as ((event: EventPayload) => void) | undefined)?.(event)
          context.setInputValue(event.value ?? "")
          if (!disabled) context.setOpen(true)
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
            context.moveActive(1)
          } else if (
            event.key === "up" ||
            (event.key === "p" && event.modifiers?.ctrl)
          ) {
            context.moveActive(-1)
          }
        },
        onKeyUp: (event: EventPayload) => {
          ;(attrs.onKeyUp as ((event: EventPayload) => void) | undefined)?.(event)
        },
        onSubmit: (event: EventPayload) => {
          ;(attrs.onSubmit as ((event: EventPayload) => void) | undefined)?.(event)
          if (disabled) return
          if (context.activeIndex !== null) {
            const item = context.filteredItems[context.activeIndex]
            if (item !== undefined) context.selectItem(item)
          }
        },
      }
      return h("input", inputProps)
    }
  },
})

export interface ComboboxTriggerProps {
  disabled?: boolean
}

export const ComboboxTrigger = defineComponent({
  props: {
    disabled: { type: Boolean, default: undefined },
    tabIndex: { type: Number, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const context = useComboboxContext("ComboboxTrigger")
    return () => {
      const disabled = props.disabled ?? context.disabled
      const triggerProps: Record<string, unknown> = {
        ...(attrs as Record<string, unknown>),
        tabIndex: disabled ? -1 : (props.tabIndex ?? 0),
        onClick: (event: EventPayload) => {
          ;(attrs.onClick as ((event: EventPayload) => void) | undefined)?.(event)
          if (!disabled) context.setOpen(!context.open)
        },
        onKeyDown: (event: EventPayload) => {
          ;(attrs.onKeyDown as ((event: EventPayload) => void) | undefined)?.(event)
          if (disabled) return
          if (event.key === "down" || event.key === "up") context.setOpen(true)
          if (event.key === "escape") context.setOpen(false)
        },
      }
      return h("div", triggerProps, slots.default?.())
    }
  },
})

export interface ComboboxValueProps {
  placeholder?: unknown
}

export const ComboboxValue = defineComponent({
  setup(_, { attrs, slots }) {
    const context = useComboboxContext("ComboboxValue")
    return () => {
      const value = Array.isArray(context.value)
        ? context.value.map(context.itemToString).join(", ")
        : context.value === null
          ? ""
          : context.itemToString(context.value)
      const slot = slots.default
      const content =
        slot && slot.length ? slot(context.value) : undefined
      const fallback = value || (attrs.placeholder as unknown) || ""
      return h("div", attrs as Record<string, unknown>, [
        (content ?? fallback) as never,
      ])
    }
  },
})

export const ComboboxContent = defineComponent({
  setup(_, { attrs, slots }) {
    const context = useComboboxContext("ComboboxContent")
    const layerProps: Record<string, unknown> = {
      side: attrs.side ?? "bottom",
      sideOffset: attrs.sideOffset ?? 4,
      align: attrs.align ?? "start",
      alignOffset: attrs.alignOffset ?? 0,
      collisionPadding: attrs.collisionPadding ?? 8,
      ...(attrs as Record<string, unknown>),
      onMouseDownOutside: (event: EventPayload) => {
        ;(attrs.onMouseDownOutside as ((event: EventPayload) => void) | undefined)?.(event)
        context.setOpen(false)
      },
    }
    return () => {
      if (!context.open) return null
      return h(FloatingLayer, layerProps, slots.default?.())
    }
  },
})

export interface ComboboxListProps {
  /** Per-item render function (one call per filtered item). When absent,
   *  children render as-is (map over `items` yourself). */
  renderItem?: (item: string) => unknown
}

export const ComboboxList = defineComponent({
  props: {
    renderItem: { type: Function as PropType<(item: string) => unknown>, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const context = useComboboxContext("ComboboxList")
    return () => {
      const content = props.renderItem
        ? context.filteredItems.map((item) => props.renderItem!(item) as never)
        : (slots.default?.() as never)
      return h("div", attrs as Record<string, unknown>, content)
    }
  },
})

export interface ComboboxItemState {
  selected: boolean
  highlighted: boolean
  disabled: boolean
}

export interface ComboboxItemProps {
  value: string
  disabled?: boolean
  style?: StateStyle<ComboboxItemState>
}

export const ComboboxItem = defineComponent({
  props: {
    value: { type: String, required: true },
    disabled: { type: Boolean, default: false },
  },
  setup(props, { attrs, slots }) {
    const context = useComboboxContext("ComboboxItem")
    return () => {
      const index = context.filteredItems.indexOf(props.value)
      const selected = Array.isArray(context.value)
        ? context.value.includes(props.value)
        : context.value === props.value
      const state: ComboboxItemState = {
        selected,
        highlighted: context.activeIndex === index,
        disabled: props.disabled,
      }
      ;(context as unknown as { _mounted?: boolean })._mounted
      const itemProps: Record<string, unknown> = {
        ...(attrs as Record<string, unknown>),
        style: resolveStyle(
          attrs.style as StateStyle<ComboboxItemState> | undefined,
          state,
        ),
        ref: (node: unknown) => {
          context.registerItem({ value: props.value, disabled: props.disabled, mounted: node != null })
        },
        onMouseEnter: (event: EventPayload) => {
          ;(attrs.onMouseEnter as ((event: EventPayload) => void) | undefined)?.(event)
          if (!props.disabled && index >= 0) context.setActiveIndex(index)
        },
        onClick: (event: EventPayload) => {
          ;(attrs.onClick as ((event: EventPayload) => void) | undefined)?.(event)
          if (!props.disabled) context.selectItem(props.value)
        },
      }
      return h("div", itemProps, slots.default?.(state))
    }
  },
})

export const ComboboxEmpty = defineComponent({
  setup(_, { attrs, slots }) {
    const context = useComboboxContext("ComboboxEmpty")
    return () =>
      context.filteredItems.length === 0
        ? h("div", attrs as Record<string, unknown>, slots.default?.())
        : null
  },
})

export const ComboboxGroup = defineComponent({
  setup(_, { attrs, slots }) {
    return () => h("div", attrs as Record<string, unknown>, slots.default?.())
  },
})

export const ComboboxLabel = defineComponent({
  setup(_, { attrs, slots }) {
    return () => h("div", attrs as Record<string, unknown>, slots.default?.())
  },
})

export const ComboboxSeparator = defineComponent({
  setup(_, { attrs }) {
    return () => h("div", attrs as Record<string, unknown>)
  },
})

export {
  Combobox as Root,
  ComboboxContent as Content,
  ComboboxEmpty as Empty,
  ComboboxGroup as Group,
  ComboboxInput as Input,
  ComboboxItem as Item,
  ComboboxLabel as Label,
  ComboboxList as List,
  ComboboxSeparator as Separator,
  ComboboxTrigger as Trigger,
  ComboboxValue as Value,
}
