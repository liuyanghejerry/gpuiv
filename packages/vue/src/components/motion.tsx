/** Native animations with a Motion-like declarative Vue API. */

import { computed, defineComponent, h, inject, ref, watch, watchEffect } from "vue"
import type { PropType } from "vue"
import type { EventPayload } from "@gpuiv/native"
import type { MotionProps, MotionStyle } from "../types.js"
import { PresenceKey, usePresence } from "./animate-presence.js"

/** Monotonic id for every logical motion target. A completion event carries
 *  the generation it settled; stale completions from a previous target cannot
 *  unmount a child that has since retargeted. */
let nextMotionGeneration = 0

function motionStyleKey(style: MotionStyle | false | undefined) {
  if (!style) return style
  return [
    style.width,
    style.height,
    style.opacity,
    style.top,
    style.right,
    style.bottom,
    style.left,
    style.borderRadius,
  ]
}

/**
 * `<motion.div animate={...} transition={...}>` — the `motion` custom prop
 * drives GPUI's native transitions (see `packages/native/src/motion.rs`).
 *
 * Inside `AnimatePresence`, a leaving node swaps `animate` for `exit` and
 * stays mounted until the native track reaches the exit target; the
 * completion event must match the generation of the current target.
 */
export const motion = {
  div: defineComponent({
    name: "MotionDiv",
    inheritAttrs: false,
    props: {
      initial: {
        type: [Object, Boolean] as PropType<MotionStyle | false>,
        default: undefined,
      },
      animate: { type: Object as PropType<MotionStyle>, required: true },
      /** Target applied while this node is leaving `AnimatePresence`. */
      exit: { type: Object as PropType<MotionStyle>, default: undefined },
      transition: {
        type: Object as PropType<NonNullable<MotionProps["transition"]>>,
        default: undefined,
      },
      onMotionComplete: {
        type: Function as PropType<(event: EventPayload) => void>,
        default: undefined,
      },
    },
    setup(props, { attrs, slots }) {
      const presence = inject(PresenceKey, null)
      const { isPresent, safeToRemove } = usePresence()

      // Without an exit target there is nothing to animate — release the
      // presence slot as soon as the node leaves.
      watchEffect(() => {
        if (!isPresent.value && props.exit === undefined) safeToRemove?.()
      })

      const resolvedInitial = computed(() =>
        presence?.initial === false ? false : props.initial
      )
      const resolvedAnimate = computed(() =>
        !isPresent.value && props.exit ? props.exit : props.animate
      )

      // One generation per logical target: mount, retarget, or the
      // enter→exit swap each get a fresh id.
      const motionKey = computed(() =>
        JSON.stringify([
          isPresent.value,
          motionStyleKey(resolvedInitial.value),
          motionStyleKey(resolvedAnimate.value),
          props.transition?.duration,
          props.transition?.delay,
          props.transition?.ease,
        ])
      )
      const generation = ref(0)
      watch(
        motionKey,
        () => {
          generation.value = ++nextMotionGeneration
        },
        { immediate: true }
      )

      return () => {
        const motionProp: Record<string, unknown> = {
          generation: generation.value,
          isExit: !isPresent.value && props.exit !== undefined,
          initial: resolvedInitial.value,
          animate: resolvedAnimate.value,
          ...(props.transition === undefined
            ? {}
            : { transition: props.transition }),
        }
        // The exit listener must exist for the completion event to fire; a
        // user callback additionally filters stale generations.
        const wrapped =
          !isPresent.value || props.onMotionComplete
            ? (event: EventPayload) => {
                if (event.motionGeneration !== generation.value) return
                props.onMotionComplete?.(event)
                if (!isPresent.value) safeToRemove?.()
              }
            : undefined
        return h(
          "div",
          {
            ...attrs,
            motion: motionProp,
            ...(wrapped ? { onMotionComplete: wrapped } : {}),
          },
          slots.default?.()
        )
      }
    },
  }),
}
