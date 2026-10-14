/** React Animal Island selection effects, expressed with native geometry.
 * Six dots replace the CSS box-shadow splash. Star width/height replace scale
 * keyframes; two native targets keep the overshoot without a JS frame timer.
 * The SVG check path itself stays static: native SVG has no stroke-dashoffset.
 */
import { defineComponent, h, ref } from "vue"
import { motion } from "@gpuiv/vue"
import { duration, ease } from "../tokens.js"

const rays = [[0, -36], [32, -16], [32, 16], [0, 36], [-32, 16], [-32, -16]] as const

export const SelectionSplash = defineComponent({
  name: "AnimalSelectionSplash", inheritAttrs: false,
  props: { size: { type: Number, required: true }, color: { type: String, required: true }, testId: { type: String, default: undefined } },
  setup(props) {
    return () => <div aria-hidden={true} testId={props.testId} style={{ position: "absolute", left: 0, top: 0, width: props.size, height: props.size, pointerEvents: "none" }}>
      {rays.map(([x, y], index) => <motion.div key={index}
        {...{ testId: props.testId ? `${props.testId}-${index}` : undefined }}
        initial={{ left: props.size / 2 - 3, top: props.size / 2 - 3, width: 6, height: 6, opacity: 1 }}
        animate={{ left: props.size / 2 + x * props.size / 22 - 1, top: props.size / 2 + y * props.size / 22 - 1, width: 2, height: 2, opacity: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        style={{ position: "absolute", borderRadius: 999, backgroundColor: props.color, pointerEvents: "none" }} />)}
    </div>
  },
})

export const RatingStarMotion = defineComponent({
  name: "AnimalRatingStarMotion", inheritAttrs: false,
  props: {
    size: { type: Number, required: true }, src: { type: String, required: true },
    burst: { type: Boolean, default: false }, hovered: { type: Boolean, default: false },
    delay: { type: Number, default: 0 }, testId: { type: String, default: undefined },
  },
  setup(props) {
    const settling = ref(false)
    return () => {
      const scale = props.burst && !settling.value ? 1.15 : 1
      const offset = (props.size - props.size * scale) / 2
      const lift = props.hovered ? -1 : 0
      return h(motion.div, {
        testId: props.testId,
        initial: props.burst ? { width: props.size * 0.55, height: props.size * 0.55, left: props.size * 0.225, top: props.size * 0.225 + lift } : false,
        animate: { width: props.size * scale, height: props.size * scale, left: offset, top: offset + lift },
        transition: { duration: props.burst ? duration.slow * (settling.value ? 0.4 : 0.6) : duration.base, delay: props.burst && !settling.value ? props.delay : 0, ease },
        onMotionComplete: () => { if (props.burst && !settling.value) settling.value = true },
        style: { position: "absolute", pointerEvents: "none" },
      }, () => h("img", { src: props.src, style: { width: "100%", height: "100%", pointerEvents: "none" } }))
    }
  },
})
