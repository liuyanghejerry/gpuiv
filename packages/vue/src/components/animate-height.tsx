/** Animates a container's height between an explicit number and `"auto"`.
 *
 *  The GPUIV answer to the web's `grid-template-rows: 0fr → 1fr` drawer
 *  trick: the content always lays out at its natural height (the outer box
 *  only clips it), `useElementBounds` reads that natural height back after
 *  paint, and `motion.div` tweens the outer height between 0 and the
 *  measured value. Because measurement is continuous, content that grows or
 *  shrinks while open is followed without any ResizeObserver.
 *
 *  ```tsx
 *  <AnimateHeight height={open ? "auto" : 0} duration={0.3}>
 *    <DrawerBody />
 *  </AnimateHeight>
 *  ```
 */

import { defineComponent, h, ref, type PropType } from "vue"
import type { MotionStyle, MotionTransition, StyleDesc } from "../types.js"
import type { HostNode } from "../types.js"
import { useElementBounds } from "../hooks/use-element-bounds.js"
import type { EventPayload } from "@gpuiv/native"

let nextHeightGeneration = 0

export const AnimateHeight = defineComponent({
  name: "AnimateHeight",
  inheritAttrs: false,
  props: {
    /** Target height in px, or `"auto"` for the content's natural height. */
    height: { type: [Number, String] as PropType<number | "auto">, required: true },
    /** Starting height on mount. Omit to render at the natural height. */
    initialHeight: { type: Number, default: undefined },
    /** Tween duration in seconds. Default 0.3. */
    duration: { type: Number, default: 0.3 },
    /** Easing curve — a named motion ease or a cubic-bezier tuple. */
    ease: { type: [String, Array] as PropType<NonNullable<MotionTransition["ease"]>>, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const content = ref<HostNode | null>(null)
    const { bounds } = useElementBounds(content)
    // Whether the motion prop has been attached. Once set it stays set —
    // dropping it would strand the element at its last animated value.
    let motionArmed = false
    let motionKey = ""
    let generation = 0

    return () => {
      const measured = bounds.value?.height ?? null
      const target = props.height === "auto" ? measured : props.height

      const style: StyleDesc = {
        overflow: "hidden",
        flexShrink: 0,
        ...(!motionArmed && props.initialHeight !== undefined ? { height: props.initialHeight } : {}),
        // Height is driven by the motion prop once armed (the FilterTable
        // pattern); before the first measurement, "auto" renders naturally.
        ...(attrs.style as StyleDesc | undefined),
      }

      let motion: { generation: number; initial?: MotionStyle | false; animate: MotionStyle; transition?: MotionTransition } | undefined
      if (target !== null) {
        const initial = !motionArmed && props.initialHeight !== undefined ? { height: props.initialHeight } : false
        motionArmed = true
        const nextKey = JSON.stringify([target, props.duration, props.ease])
        if (nextKey !== motionKey) { motionKey = nextKey; generation = ++nextHeightGeneration }
        motion = {
          generation,
          initial,
          animate: { height: target },
          transition: {
            duration: props.duration,
            ...(props.ease === undefined ? {} : { ease: props.ease }),
          },
        }
      } else if (motionArmed) {
        // Shouldn't happen (bounds persist), but never un-arm the prop.
        motion = { generation, initial: false, animate: {} }
      }

      return h(
        "div",
        { ...attrs, style, ...(motion === undefined ? {} : { motion }),
          ...(attrs.onMotionComplete ? { onMotionComplete: (event: EventPayload) => {
            if (event.motionGeneration !== generation) return
            const handlers = Array.isArray(attrs.onMotionComplete) ? attrs.onMotionComplete : [attrs.onMotionComplete]
            handlers.forEach((handler) => (handler as (event: EventPayload) => void)(event))
          } } : {}),
        },
        h(
          "div",
          {
            ref: content,
            style: { flexShrink: 0 },
          },
          slots.default?.()
        )
      )
    }
  },
})
