/** Native animations with a Motion-like declarative Vue API. */

import { defineComponent, h, type PropType } from "vue"
import type { MotionProps, MotionStyle } from "../types.js"

/**
 * `<motion.div animate={...} transition={...}>` — the `motion` custom prop
 * drives GPUI's native transitions (see `packages/native/src/motion.rs`).
 */
export const motion = {
  div: defineComponent({
    props: {
      initial: {
        type: [Object, Boolean] as PropType<MotionStyle | false>,
        default: undefined,
      },
      animate: { type: Object as PropType<MotionStyle>, required: true },
      transition: {
        type: Object as PropType<NonNullable<MotionProps["transition"]>>,
        default: undefined,
      },
    },
    setup(props, { attrs, slots }) {
      return () => {
        const motionProp: MotionProps = {
          animate: props.animate,
          ...(props.initial === undefined ? {} : { initial: props.initial }),
          ...(props.transition === undefined
            ? {}
            : { transition: props.transition }),
        }
        return h("div", { ...attrs, motion: motionProp }, slots.default?.())
      }
    },
  }),
}
