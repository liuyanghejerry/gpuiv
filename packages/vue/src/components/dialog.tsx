/** Headless Base UI-shaped Dialog over a full-window GPUIV anchored layer. */

import {
  defineComponent,
  h,
  inject,
  provide,
  reactive,
  ref,
  type InjectionKey,
  type PropType,
  type VNodeChild,
} from "vue"
import type { EventPayload } from "@gpuiv/native"
import type { KeyEvent, StyleDesc } from "../types.js"
import { useGpuix } from "../hooks/use-gpuix.js"
import { buttonProps } from "./button.js"
import {
  DismissableLayer,
  cloneAsChild,
  resolveFocusTarget,
  useControllableState,
} from "./floating.js"
import type { FocusTarget, FocusableNode } from "./floating.js"

interface DialogContextValue {
  open: boolean
  modal: boolean
  disablePointerDismissal: boolean
  setOpen: (open: boolean) => void
  triggerRef: { current: { id: number } | null }
}

const DialogContextKey: InjectionKey<DialogContextValue> = Symbol("gpuiv-dialog")

function useDialogContext(name: string): DialogContextValue {
  const context = inject(DialogContextKey)
  if (!context) throw new Error(`${name} must be used inside Dialog`)
  return context
}

export interface DialogProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Default true: blocks the page behind, keeps Tab inside the popup. */
  modal?: boolean
  /** Keep the dialog open when the backdrop is pressed. */
  disablePointerDismissal?: boolean
}

export const Dialog = defineComponent({
  // Attrs are forwarded onto the root host div by hand below.
  inheritAttrs: false,
  props: {
    open: { type: Boolean, default: undefined },
    defaultOpen: { type: Boolean, default: false },
    onOpenChange: {
      type: Function as PropType<(open: boolean) => void>,
      default: undefined,
    },
    modal: { type: Boolean, default: true },
    disablePointerDismissal: { type: Boolean, default: false },
  },
  setup(props, { attrs, slots }) {
    const [open, setOpen] = useControllableState({
      get value() {
        return props.open
      },
      defaultValue: props.defaultOpen,
      onChange: props.onOpenChange,
    })
    const contextInitial: DialogContextValue = {
      open: false,
      modal: true,
      disablePointerDismissal: false,
      setOpen: () => {},
      triggerRef: { current: null },
    }
    const context = reactive(contextInitial)
    context.setOpen = (next: boolean) => setOpen(next)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provide(DialogContextKey as any, context)
    return () => {
      context.open = open.value
      context.modal = props.modal
      context.disablePointerDismissal = props.disablePointerDismissal
      return h(
        "div",
        { ...(attrs as Record<string, unknown>), style: attrs.style as StyleDesc | undefined },
        (slots.default?.() ?? []) as VNodeChild[],
      )
    }
  },
})

export interface DialogTriggerProps {
  asChild?: boolean
  disabled?: boolean
  tabIndex?: number
}

export const DialogTrigger = defineComponent({
  inheritAttrs: false,
  props: {
    asChild: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    tabIndex: { type: Number, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const context = useDialogContext("DialogTrigger")
    return () => {
      const triggerProps: Record<string, unknown> = {
        ...(attrs as Record<string, unknown>),
        "aria-expanded": context.open,
        ref: (node: { id: number } | null) => {
          context.triggerRef.current = node
        },
        // Button semantics: Enter fires on key-down, Space on key-up (its
        // default is cancelled so it never scrolls or types).
        ...buttonProps({
          disabled: props.disabled,
          tabIndex: props.tabIndex ?? 0,
          onClick: (event: EventPayload) => {
            ;(attrs.onClick as ((event: EventPayload) => void) | undefined)?.(event)
            context.setOpen(true)
          },
          onKeyDown: (event: KeyEvent) => {
            ;(attrs.onKeyDown as ((event: KeyEvent) => void) | undefined)?.(event)
          },
          onKeyUp: (event: KeyEvent) => {
            ;(attrs.onKeyUp as ((event: KeyEvent) => void) | undefined)?.(event)
          },
        }),
      }
      if (props.asChild) {
        return cloneAsChild("DialogTrigger", slots.default?.(), triggerProps)
      }
      return h("div", triggerProps, slots.default?.())
    }
  },
})

/**
 * A full-window layer painted after the page, so it covers `<virtual-list>`
 * and everything else. Mounted only while the dialog is open.
 */
export const DialogPortal = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    const context = useDialogContext("DialogPortal")
    return () => {
      if (!context.open) return null
      const modal = context.modal
      const style = attrs.style as StyleDesc | undefined
      return h(
        "anchored",
        {
          ...(attrs as Record<string, unknown>),
          // Native sizes the layer to the viewport, so a resize never leaves
          // an uncovered strip that clicks could reach.
          fill: "window",
          deferred: true,
          // Below menus and tooltips (priority 1), so a Select inside the
          // popup opens on top of it.
          priority: 0,
          occlude: modal,
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // Explicit transparent: the Backdrop paints the dim, not the layer.
            backgroundColor: "transparent",
            ...style,
            pointerEvents: modal ? style?.pointerEvents : "none",
          },
        },
        (slots.default?.() ?? []) as VNodeChild[],
      )
    }
  },
})

/** Covers the window behind the popup. A press on it closes the dialog. */
export const DialogBackdrop = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    const context = useDialogContext("DialogBackdrop")
    return () => {
      if (!context.open) return null
      return h(
        "div",
        {
          ...(attrs as Record<string, unknown>),
          style: {
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            ...(attrs.style as StyleDesc | undefined),
          },
          onMouseDown: (event: EventPayload) => {
            ;(attrs.onMouseDown as ((event: EventPayload) => void) | undefined)?.(event)
            if (!context.disablePointerDismissal) context.setOpen(false)
          },
        },
        (slots.default?.() ?? []) as VNodeChild[],
      )
    }
  },
})

export interface DialogPopupProps {
  /** Focus on open. Default: the popup itself, so the first Tab enters it. */
  initialFocus?: FocusTarget<FocusableNode>
  /** Focus on close. Default: the trigger, else the element focused before open. */
  finalFocus?: FocusTarget<FocusableNode>
  tabIndex?: number
  role?: string
}

/** The dialog surface. Moves focus in on open and back out on close. */
export const DialogPopup = defineComponent({
  inheritAttrs: false,
  props: {
    initialFocus: {
      type: [Boolean, Object, Function] as PropType<DialogPopupProps["initialFocus"]>,
      default: undefined,
    },
    finalFocus: {
      type: [Boolean, Object, Function] as PropType<DialogPopupProps["finalFocus"]>,
      default: undefined,
    },
    tabIndex: { type: Number, default: -1 },
    role: { type: String, default: "dialog" },
  },
  setup(props, { attrs, slots }) {
    const context = useDialogContext("DialogPopup")
    const { renderer } = useGpuix()
    const popupRef = ref<FocusableNode | null>(null)
    return () => {
      if (!context.open) return null
      return h(
        DismissableLayer,
        {
          onEscapeKeyDown: () => context.setOpen(false),
          initialFocus: () =>
            resolveFocusTarget(props.initialFocus, () => popupRef.value?.id ?? null),
          finalFocus: (previous: number | null) =>
            resolveFocusTarget(props.finalFocus, () => context.triggerRef.current?.id ?? previous),
        },
        () =>
          h(
            "div",
            {
              ...(attrs as Record<string, unknown>),
              ref: (node: FocusableNode | null) => {
                popupRef.value = node
              },
              role: props.role,
              tabIndex: props.tabIndex,
              // A press inside the popup must never reach the backdrop behind
              // it. The popup is focused so the first Tab enters it.
              style: {
                pointerEvents: "auto",
                ...(attrs.style as StyleDesc | undefined),
              },
              onKeyDown: (event: KeyEvent) => {
                ;(attrs.onKeyDown as ((event: KeyEvent) => void) | undefined)?.(event)
                if (!context.modal || event.key !== "tab" || event.defaultPrevented) return
                const popup = popupRef.value
                if (!popup) return
                event.preventDefault()
                if (event.modifiers?.shift) renderer?.focusPreviousWithin?.(popup.id)
                else renderer?.focusNextWithin?.(popup.id)
              },
            },
            (slots.default?.() ?? []) as VNodeChild[],
          ),
      )
    }
  },
})

export const DialogTitle = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () =>
      h("div", { ...(attrs as Record<string, unknown>), role: "heading", "aria-level": 2 }, (slots.default?.() ?? []) as VNodeChild[])
  },
})

export const DialogDescription = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h("div", attrs as Record<string, unknown>, (slots.default?.() ?? []) as VNodeChild[])
  },
})

export interface DialogCloseProps {
  asChild?: boolean
  disabled?: boolean
  tabIndex?: number
}

export const DialogClose = defineComponent({
  inheritAttrs: false,
  props: {
    asChild: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    tabIndex: { type: Number, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const context = useDialogContext("DialogClose")
    return () => {
      const closeProps: Record<string, unknown> = {
        ...(attrs as Record<string, unknown>),
        // Button semantics, like DialogTrigger.
        ...buttonProps({
          disabled: props.disabled,
          tabIndex: props.tabIndex ?? 0,
          onClick: (event: EventPayload) => {
            ;(attrs.onClick as ((event: EventPayload) => void) | undefined)?.(event)
            context.setOpen(false)
          },
          onKeyDown: (event: KeyEvent) => {
            ;(attrs.onKeyDown as ((event: KeyEvent) => void) | undefined)?.(event)
          },
          onKeyUp: (event: KeyEvent) => {
            ;(attrs.onKeyUp as ((event: KeyEvent) => void) | undefined)?.(event)
          },
        }),
      }
      if (props.asChild) {
        return cloneAsChild("DialogClose", slots.default?.(), closeProps)
      }
      return h("div", closeProps, slots.default?.())
    }
  },
})

export {
  Dialog as Root,
  DialogBackdrop as Backdrop,
  DialogClose as Close,
  DialogDescription as Description,
  DialogPopup as Popup,
  DialogPortal as Portal,
  DialogTitle as Title,
  DialogTrigger as Trigger,
}
