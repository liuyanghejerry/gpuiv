import { defineComponent, h, type PropType } from "vue"
import {
  AnimateHeight as NativeAnimateHeight,
  motion as nativeMotion,
  type EventPayload,
  type MotionProps,
  type MotionTransition,
} from "@gpuiv/vue"
import { useTheme } from "./theme.js"

/** Apply the Beautiful UI accessibility preference to native motion. */
export const motion = {
  div: defineComponent({
    name: "BuiMotionDiv",
    inheritAttrs: false,
    props: {
      initial: { type: [Object, Boolean] as PropType<MotionProps["initial"]>, default: undefined },
      animate: { type: Object as PropType<MotionProps["animate"]>, required: true },
      exit: { type: Object as PropType<MotionProps["exit"]>, default: undefined },
      transition: { type: Object as PropType<MotionProps["transition"]>, default: undefined },
      onMotionComplete: { type: Function as PropType<(event: EventPayload) => void>, default: undefined },
    },
    setup(props, { attrs, slots }) {
      const theme = useTheme()
      return () =>
        h(
          nativeMotion.div,
          { ...attrs, ...theme.motion(props), exit: props.exit, onMotionComplete: props.onMotionComplete },
          slots,
        )
    },
  }),
}

export const AnimateHeight = defineComponent({
  name: "BuiAnimateHeight",
  inheritAttrs: false,
  props: {
    height: { type: [Number, String] as PropType<number | "auto">, required: true },
    duration: { type: Number, default: 0.3 },
    ease: { type: [String, Array] as PropType<NonNullable<MotionTransition["ease"]>>, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const theme = useTheme()
    return () =>
      h(NativeAnimateHeight, { ...attrs, ...props, duration: theme.reducedMotion.value ? 0 : props.duration }, slots)
  },
})
