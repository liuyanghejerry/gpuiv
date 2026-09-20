/** GLIDE MENU — a vertical menu whose single highlight layer slides to the
 *  hovered/focused row.
 *
 *  Ported from beautiful-ui `components/primitives/GlideMenu.tsx`. The web
 *  original is one component: on mouseover it finds the row via
 *  `event.target.closest("[data-menu-row]")` and measures it with
 *  `getBoundingClientRect`. Here the repo's headless Root/Item split applies
 *  (see `packages/vue/src/components/select.tsx`): `GlideMenuItem` wraps each
 *  row, registers its host element's live template ref with the Root on
 *  mount, and reports mouseEnter/mouseLeave/focus/blur; the Root measures
 *  the container and the active row with `useElementBounds` (painted,
 *  window-space, polled) and tweens one absolute `motion.div` to
 *  `top = rowBounds.y - containerBounds.y`, `height = rowBounds.height`.
 *  Rows keep their own text/hover colours — the sliding layer IS the hover
 *  feedback, same as the original.
 *
 *  Degradations and deliberate differences from the web original:
 *  - The original runs two transitions (top/height 220ms
 *    cubic-bezier(0.23,1,0.32,1), opacity 150ms ease). GPUIV's motion prop
 *    takes one transition per element, so opacity shares the 220ms
 *    `ease.outStrong` tween.
 *  - The highlight radius is 6 (`radius.chip`) per the port spec, not the
 *    original's `rounded-[8px]`; the background is the theme token `hover`
 *    (the original's `bg-hover`).
 *  - The original hides only on container mouseleave or when focus leaves
 *    the menu (a `relatedTarget` containment check). Here a row's own
 *    leave/blur schedules the hide one macrotask out, so moving between rows
 *    — whose events arrive old-row-then-new-row — cancels the hide and the
 *    layer keeps gliding; resting on container padding between rows hides
 *    it, which the original did not.
 *  - Bounds come from paint, so a row hovered before its first paint shows
 *    the highlight one poll (<=100ms) late; already-painted rows are
 *    measured synchronously in `activate`.
 */

import {
  defineComponent,
  inject,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowRef,
  type InjectionKey,
  type Ref,
} from "vue"
import { motion, useElementBounds, type EventPayload, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { duration, ease, radius } from "../tokens.js"
import { useTheme } from "../theme.js"

interface GlideMenuItemRegistration {
  /** Live template ref to the row's host element; populated by `mounted`. */
  node: Ref<HostNode | null>
}

interface GlideMenuContextValue {
  register(item: GlideMenuItemRegistration): void
  unregister(item: GlideMenuItemRegistration): void
  /** Move the highlight to this row (hover or keyboard focus). */
  activate(item: GlideMenuItemRegistration): void
  /** Hide the highlight, deferred — cancelled if another row activates first. */
  deactivate(item: GlideMenuItemRegistration): void
}

const GlideMenuContextKey: InjectionKey<GlideMenuContextValue> = Symbol("gpuiv-beautiful-ui/glide-menu")

export const GlideMenuRoot = defineComponent({
  name: "BuiGlideMenuRoot",
  // Attrs are forwarded by hand so `style` can be merged, not replaced.
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    const theme = useTheme()
    const containerRef = ref<HostNode | null>(null)
    const container = useElementBounds(containerRef)

    const items = new Set<GlideMenuItemRegistration>()
    const activeItem = shallowRef<GlideMenuItemRegistration | null>(null)
    // The bounds hook's target is a ref it re-reads on every measure, so one
    // hook follows whichever row is active — the Root measures the container
    // plus the active row, never every row.
    const activeNode = shallowRef<HostNode | null>(null)
    const row = useElementBounds(activeNode)

    // Deferring the hide one macrotask replaces the original's relatedTarget
    // check: row-to-row pointer/focus moves deliver the old row's leave/blur
    // before the new row's enter/focus, and `activate` cancels the pending
    // hide, so the layer glides instead of fading out and back in.
    let clearTimer: ReturnType<typeof setTimeout> | undefined
    const cancelClear = () => {
      if (clearTimer !== undefined) {
        clearTimeout(clearTimer)
        clearTimer = undefined
      }
    }

    const activate = (item: GlideMenuItemRegistration) => {
      cancelClear()
      const node = item.node.value
      if (node === null) return
      activeItem.value = item
      activeNode.value = node
      // Measure now rather than waiting up to one poll interval.
      container.measure()
      row.measure()
    }

    const deactivate = (item: GlideMenuItemRegistration) => {
      if (activeItem.value !== item) return
      clearTimer = setTimeout(() => {
        clearTimer = undefined
        if (activeItem.value === item) {
          activeItem.value = null
          activeNode.value = null
        }
      }, 0)
    }

    provide(GlideMenuContextKey, {
      register: (item) => {
        items.add(item)
      },
      unregister: (item) => {
        items.delete(item)
        if (activeItem.value === item) {
          cancelClear()
          activeItem.value = null
          activeNode.value = null
        }
      },
      activate,
      deactivate,
    })

    onBeforeUnmount(cancelClear)

    // Last shown highlight position. Kept while hidden (the original's `box`
    // state likewise survives mouseleave) so the next hover tweens from the
    // previous row instead of jumping in from the menu's top edge.
    const lastBox = { top: 0, height: 0 }

    return () => {
      const t = theme.tokens.value
      const containerBounds = container.bounds.value
      const rowBounds = row.bounds.value
      const showing = activeItem.value !== null && containerBounds !== null && rowBounds !== null
      if (showing) {
        lastBox.top = rowBounds.y - containerBounds.y
        lastBox.height = rowBounds.height
      }
      return (
        <div
          {...attrs}
          ref={containerRef}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            ...(attrs.style as StyleDesc | undefined),
          }}
        >
          <motion.div
            animate={{ top: lastBox.top, height: lastBox.height, opacity: showing ? 1 : 0 }}
            transition={{ duration: duration.normal, ease: ease.outStrong }}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              borderRadius: radius.chip,
              backgroundColor: t.hover,
              pointerEvents: "none",
            }}
          />
          {slots.default?.()}
        </div>
      )
    }
  },
})

export const GlideMenuItem = defineComponent({
  name: "BuiGlideMenuItem",
  inheritAttrs: false,
  props: {
    /** Disabled rows keep their content but never pull the highlight. */
    disabled: { type: Boolean, default: false },
  },
  setup(props, { attrs, slots }) {
    const context = inject(GlideMenuContextKey)
    if (!context) throw new Error("GlideMenuItem must be used inside GlideMenuRoot")
    const nodeRef = ref<HostNode | null>(null)
    // Register the live ref, not its current value: it is populated by the
    // time `mounted` runs and stays the same object for the row's lifetime.
    const registration: GlideMenuItemRegistration = { node: nodeRef }
    onMounted(() => context.register(registration))
    onBeforeUnmount(() => context.unregister(registration))

    return () => (
      <div
        {...attrs}
        ref={nodeRef}
        aria-disabled={props.disabled || undefined}
        onMouseEnter={(event: EventPayload) => {
          ;(attrs.onMouseEnter as ((event: EventPayload) => void) | undefined)?.(event)
          if (!props.disabled) context.activate(registration)
        }}
        onMouseLeave={(event: EventPayload) => {
          ;(attrs.onMouseLeave as ((event: EventPayload) => void) | undefined)?.(event)
          context.deactivate(registration)
        }}
        onFocus={(event: EventPayload) => {
          ;(attrs.onFocus as ((event: EventPayload) => void) | undefined)?.(event)
          if (!props.disabled) context.activate(registration)
        }}
        onBlur={(event: EventPayload) => {
          ;(attrs.onBlur as ((event: EventPayload) => void) | undefined)?.(event)
          context.deactivate(registration)
        }}
      >
        {slots.default?.()}
      </div>
    )
  },
})
