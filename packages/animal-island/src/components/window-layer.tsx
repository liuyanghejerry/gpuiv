import { defineComponent, type PropType } from "vue"
import { useWindowSize, type StyleDesc } from "@gpuiv/vue"

/** GPUI owns window-space positioning and deferred overlay paint order. */
export const WindowLayer = defineComponent({
  name: "AnimalWindowLayer",
  inheritAttrs: false,
  props: { backgroundColor: { type: String, required: true }, priority: { type: Number, default: 1 }, style: { type: Object as PropType<StyleDesc>, default: undefined } },
  setup(props, { attrs, slots }) {
    const size = useWindowSize()
    return () => <anchored {...attrs} deferred priority={props.priority} position={{ x: 0, y: 0 }} snapMargin={0} occlude={props.style?.pointerEvents !== "none"}
      style={{ width: size.value.width, height: size.value.height, backgroundColor: props.backgroundColor, ...props.style }}>
      {slots.default?.()}
    </anchored>
  },
})
