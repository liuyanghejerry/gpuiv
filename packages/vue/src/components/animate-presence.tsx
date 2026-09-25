/** AnimatePresence: keep leaving children mounted until their exit motion
 *  finishes, matching Motion for React's AnimatePresence contract.
 *
 *  Vue port of upstream's `animate-presence.ts`: the React context becomes a
 *  reactive provide, and `usePresence` returns an object with a computed
 *  `isPresent` instead of a tuple. Children are keyed vnodes from the default
 *  slot; a child that leaves the slot keeps rendering (its last vnode,
 *  re-cloned) inside a PresenceChild that provides `isPresent: false`, until
 *  the child's `motion` track reports completion for the current target.
 */

import {
  computed,
  defineComponent,
  getCurrentInstance,
  inject,
  onMounted,
  onUnmounted,
  provide,
  reactive,
  ref,
  watchEffect,
  type ComputedRef,
  type InjectionKey,
  type PropType,
  type VNode,
  type VNodeChild,
} from "vue"
import { cloneVNode, Comment, isVNode, Text } from "vue"

export type ComponentKey = string | number

export interface PresenceContextValue {
  isPresent: boolean
  initial: false | undefined
  onExitComplete: (childId: number) => void
  register: (childId: number) => () => void
}

export const PresenceKey: InjectionKey<PresenceContextValue> = Symbol.for(
  "gpuiv:presence"
) as InjectionKey<PresenceContextValue>

export type SafeToRemove = () => void

export interface Presence {
  /** Whether the surrounding `AnimatePresence` still renders this subtree. */
  isPresent: ComputedRef<boolean>
  /** Report that this subtree finished its exit work. Undefined outside
   *  `AnimatePresence` — nothing waits for this subtree there. */
  safeToRemove: SafeToRemove | undefined
}

/** Integrate a custom component into its ancestor `AnimatePresence`.
 *
 *  Inside `AnimatePresence`, call the returned `safeToRemove` once the
 *  component's own exit work is done. Without it the presence child waits for
 *  registered descendants — `<motion.div>` calls it on exit completion. */
export function usePresence(): Presence {
  const context = inject(PresenceKey, null)
  const childId = getCurrentInstance()?.uid ?? 0

  if (context) {
    onMounted(() => {
      const unregister = context.register(childId)
      onUnmounted(unregister)
    })
  }

  return {
    isPresent: computed(() => context?.isPresent ?? true),
    safeToRemove: context ? () => context.onExitComplete(childId) : undefined,
  }
}

/** Read presence without participating in exit completion. */
export function useIsPresent(): ComputedRef<boolean> {
  const context = inject(PresenceKey, null)
  return computed(() => context?.isPresent ?? true)
}

export interface AnimatePresenceProps {
  /** Skip enter animations for children present on the first render. */
  initial?: boolean
}

function getChildKey(child: VNode): ComponentKey {
  return child.key ?? ""
}

function onlyElements(children: VNodeChild[]): VNode[] {
  const filtered: VNode[] = []
  for (const child of children) {
    if (isVNode(child) && child.type !== Text && child.type !== Comment) {
      filtered.push(child)
    }
  }
  return filtered
}

/**
 * Provides the presence context to one child subtree. When the child is
 * leaving, aggregates completions from every registered descendant
 * (`usePresence` / `motion.div`) and releases the slot once all are done.
 */
const PresenceChild = defineComponent({
  name: "PresenceChild",
  props: {
    isPresent: { type: Boolean, required: true },
    /** `initial === false` on the first render: children skip their enter. */
    skipEnter: { type: Boolean, default: false },
    /** AnimatePresence's per-child callback; null while the child is present. */
    onExit: { type: Function as PropType<(() => void) | null>, default: null },
  },
  setup(props, { slots }) {
    // childId → its completion reporter, null while still pending.
    const descendants = reactive(new Map<number, (() => void) | null>())
    const isPresent = ref(props.isPresent)
    watchEffect(() => {
      isPresent.value = props.isPresent
    })

    const release = () => props.onExit?.()

    const context = reactive<PresenceContextValue>({
      // `initial === false` means "skip the enter animation"; a motion child
      // reads it once on mount.
      initial: props.skipEnter ? false : undefined,
      isPresent: props.isPresent,
      register(childId: number) {
        descendants.set(childId, null)
        return () => {
          descendants.delete(childId)
          // A pending descendant unmounting cannot report completion anymore.
          queueMicrotask(() => {
            if (!isPresent.value && descendants.size === 0) release()
          })
        }
      },
      onExitComplete(childId: number) {
        if (!descendants.has(childId)) return
        const complete = () => {
          for (const reporter of descendants.values()) {
            if (reporter !== complete) return
          }
          release()
        }
        descendants.set(childId, complete)
        complete()
      },
    })
    watchEffect(() => {
      context.isPresent = props.isPresent
    })
    // A child with no registered motion (e.g. a plain div) leaves immediately.
    watchEffect(() => {
      if (!props.isPresent && descendants.size === 0) release()
    })

    provide(PresenceKey, context)

    return () => {
      // Re-clone on every render: the stored child vnode is reused across
      // renders while it exits, and one vnode instance cannot be patched twice.
      return (slots.default?.() ?? []).map((child) =>
        isVNode(child) ? cloneVNode(child) : child
      )
    }
  },
})

export const AnimatePresence = defineComponent({
  name: "AnimatePresence",
  props: {
    initial: { type: Boolean, default: true },
  },
  emits: ["exitComplete"],
  setup(props, { slots, emit }) {
    /** Children currently rendered (present or still exiting), by key. */
    let rendered = new Map<ComponentKey, VNode>()
    /** Keys from the last render's slot. */
    let presentKeys = new Set<ComponentKey>()
    /** Keys whose exit finished; dropped by the next render. */
    const exitDone = reactive(new Set<ComponentKey>())
    /** Bumped whenever an exit settles so the render recomputes the list. */
    const exitTick = ref(0)
    let firstRender = true

    return () => {
      exitTick.value // tracked: an exit settling recomputes the child list

      const presentChildren = onlyElements(slots.default?.() ?? [])
      presentKeys = new Set(presentChildren.map(getChildKey))
      const skipEnter = firstRender && props.initial === false
      firstRender = false

      // Present children replace their own key; a child that left the slot
      // keeps its last vnode until its exit reports completion.
      const next = new Map<ComponentKey, VNode>()
      for (const child of presentChildren) {
        next.set(getChildKey(child), child)
      }
      for (const [key, child] of rendered) {
        if (!presentKeys.has(key) && !exitDone.has(key)) {
          next.set(key, child)
        }
      }
      rendered = next
      exitDone.clear()

      const children: VNode[] = []
      for (const [key, child] of rendered) {
        const isPresent = presentKeys.has(key)
        const onExit = isPresent
          ? null
          : () => {
              if (exitDone.has(key)) return
              exitDone.add(key)
              // `exitComplete` fires once every rendered child is either
              // present again or finished exiting.
              for (const other of rendered.keys()) {
                if (!presentKeys.has(other) && !exitDone.has(other)) {
                  exitTick.value++
                  return
                }
              }
              exitTick.value++
              emit("exitComplete")
            }
        children.push(
          <PresenceChild
            key={key}
            isPresent={isPresent}
            skipEnter={skipEnter}
            onExit={onExit}
          >
            {child}
          </PresenceChild>
        )
      }
      return children
    }
  },
})
