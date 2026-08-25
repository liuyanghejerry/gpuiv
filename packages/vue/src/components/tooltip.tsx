/** Headless shadcn-shaped Tooltip components over GPUIX Vue anchored layers. */

import {
  defineComponent,
  h,
  inject,
  onUnmounted,
  provide,
  reactive,
  type InjectionKey,
  type PropType,
} from "vue"
import type { EventPayload } from "@gpuiv/native"
import type { StyleDesc } from "../types.js"
import {
  FloatingLayer,
  floatingRootStyle,
  useControllableState,
} from "./floating.js"
import type { FloatingContentProps } from "./floating.js"

interface TooltipProviderContextValue {
  delayDuration: number
  skipDelayDuration: number
  disableHoverableContent: boolean
  lastClosedAt: { value: number }
}

const TooltipProviderContextKey: InjectionKey<TooltipProviderContextValue> = Symbol(
  "gpuiv-tooltip-provider",
)

function defaultProvider(): TooltipProviderContextValue {
  return {
    delayDuration: 0,
    skipDelayDuration: 300,
    disableHoverableContent: false,
    lastClosedAt: { value: Number.NEGATIVE_INFINITY },
  }
}

export const TooltipProvider = defineComponent({
  props: {
    delayDuration: { type: Number, default: 0 },
    skipDelayDuration: { type: Number, default: 300 },
    disableHoverableContent: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    const lastClosedAt = { value: Number.NEGATIVE_INFINITY }
    provide(TooltipProviderContextKey, {
      delayDuration: props.delayDuration,
      skipDelayDuration: props.skipDelayDuration,
      disableHoverableContent: props.disableHoverableContent,
      lastClosedAt,
    } as TooltipProviderContextValue)
    return () => slots.default?.()
  },
})

interface TooltipContextValue {
  open: boolean
  disableHoverableContent: boolean
  openImmediately: () => void
  scheduleOpen: () => void
  scheduleClose: () => void
  cancelClose: () => void
  close: () => void
}

const TooltipContextKey: InjectionKey<TooltipContextValue> = Symbol("gpuiv-tooltip")

function useTooltipContext(name: string): TooltipContextValue {
  const context = inject(TooltipContextKey)
  if (!context) throw new Error(`${name} must be used inside Tooltip`)
  return context
}

export interface TooltipProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  delayDuration?: number
  disableHoverableContent?: boolean
  style?: StyleDesc
}

export const Tooltip = defineComponent({
  props: {
    open: { type: Boolean, default: undefined },
    defaultOpen: { type: Boolean, default: false },
    onOpenChange: { type: Function as PropType<(open: boolean) => void>, default: undefined },
    delayDuration: { type: Number, default: undefined },
    disableHoverableContent: { type: Boolean, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const provider = inject(TooltipProviderContextKey, defaultProvider())
    const [open, setOpenState] = useControllableState({
      value: props.open,
      defaultValue: props.defaultOpen,
      onChange: props.onOpenChange,
    })
    let openTimer: ReturnType<typeof setTimeout> | null = null
    let closeTimer: ReturnType<typeof setTimeout> | null = null
    const hoverableDisabled =
      props.disableHoverableContent ?? provider.disableHoverableContent

    const cancelOpen = () => {
      if (openTimer !== null) clearTimeout(openTimer)
      openTimer = null
    }
    const cancelClose = () => {
      if (closeTimer !== null) clearTimeout(closeTimer)
      closeTimer = null
    }
    const setOpen = (nextOpen: boolean) => {
      cancelOpen()
      cancelClose()
      setOpenState(nextOpen)
      if (!nextOpen) provider.lastClosedAt.value = Date.now()
    }
    const openImmediately = () => setOpen(true)
    const scheduleOpen = () => {
      cancelClose()
      const recentlyClosed =
        Date.now() - provider.lastClosedAt.value <= provider.skipDelayDuration
      const delay = recentlyClosed ? 0 : (props.delayDuration ?? provider.delayDuration)
      if (delay <= 0) {
        setOpen(true)
        return
      }
      cancelOpen()
      openTimer = setTimeout(() => setOpen(true), delay)
    }
    const close = () => setOpen(false)
    const scheduleClose = () => {
      cancelOpen()
      if (hoverableDisabled) {
        close()
        return
      }
      cancelClose()
      closeTimer = setTimeout(close, 80)
    }

    onUnmounted(() => {
      cancelOpen()
      cancelClose()
    })

    const contextInitial: TooltipContextValue = {
      open: false,
      disableHoverableContent: hoverableDisabled,
      openImmediately,
      scheduleOpen,
      scheduleClose,
      cancelClose,
      close,
    }
    const context = reactive(contextInitial)
    provide(TooltipContextKey, context)

    return () => {
      context.open = open.value
      context.disableHoverableContent = hoverableDisabled
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

export interface TooltipTriggerProps {
  disabled?: boolean
}

export const TooltipTrigger = defineComponent({
  props: {
    tabIndex: { type: Number, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const context = useTooltipContext("TooltipTrigger")
    return () => {
      const triggerProps: Record<string, unknown> = {
        ...(attrs as Record<string, unknown>),
        tabIndex: props.tabIndex ?? 0,
        onMouseEnter: (event: EventPayload) => {
          ;(attrs.onMouseEnter as ((event: EventPayload) => void) | undefined)?.(event)
          context.scheduleOpen()
        },
        onMouseLeave: (event: EventPayload) => {
          ;(attrs.onMouseLeave as ((event: EventPayload) => void) | undefined)?.(event)
          context.scheduleClose()
        },
        onMouseDown: (event: EventPayload) => {
          ;(attrs.onMouseDown as ((event: EventPayload) => void) | undefined)?.(event)
          context.close()
        },
        onClick: (event: EventPayload) => {
          ;(attrs.onClick as ((event: EventPayload) => void) | undefined)?.(event)
          context.close()
        },
        onFocus: (event: EventPayload) => {
          ;(attrs.onFocus as ((event: EventPayload) => void) | undefined)?.(event)
          context.openImmediately()
        },
        onBlur: (event: EventPayload) => {
          ;(attrs.onBlur as ((event: EventPayload) => void) | undefined)?.(event)
          context.close()
        },
        onKeyDown: (event: EventPayload) => {
          ;(attrs.onKeyDown as ((event: EventPayload) => void) | undefined)?.(event)
          if (event.key === "escape") context.close()
        },
      }
      return h("div", triggerProps, slots.default?.())
    }
  },
})

export interface TooltipContentProps extends FloatingContentProps {}

export const TooltipContent = defineComponent({
  setup(_, { attrs, slots }) {
    const context = useTooltipContext("TooltipContent")
    const layerProps: Record<string, unknown> = {
      side: attrs.side ?? "top",
      align: attrs.align ?? "center",
      sideOffset: attrs.sideOffset ?? 0,
      ...(attrs as Record<string, unknown>),
      onMouseEnter: (event: EventPayload) => {
        ;(attrs.onMouseEnter as ((event: EventPayload) => void) | undefined)?.(event)
        if (!context.disableHoverableContent) context.cancelClose()
      },
      onMouseLeave: (event: EventPayload) => {
        ;(attrs.onMouseLeave as ((event: EventPayload) => void) | undefined)?.(event)
        context.scheduleClose()
      },
    }
    return () => {
      if (!context.open) return null
      return h(FloatingLayer, layerProps, slots.default?.())
    }
  },
})

export {
  Tooltip as Root,
  TooltipContent as Content,
  TooltipProvider as Provider,
  TooltipTrigger as Trigger,
}
