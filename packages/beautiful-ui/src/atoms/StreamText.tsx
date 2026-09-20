/** Streaming text primitive — reveals characters quickly with a soft blur tail, caret blinks idle. */
import { defineComponent, h, ref, onMounted, onBeforeUnmount, type PropType } from "vue"

export const StreamText = defineComponent({
  name: "StreamText",
  props: { text: { type: String, default: "" }, charsPerTick: { type: Number, default: 2 }, tickMs: { type: Number, default: 9 }, blurTail: { type: Number, default: 6 }, caret: { type: Boolean, default: true } },
  setup(props) {
    const count = ref(0)
    const streaming = ref(false)
    let timer: ReturnType<typeof setInterval> | undefined
    onMounted(() => {
      count.value = 0
      let i = 0
      streaming.value = true
      timer = setInterval(() => {
        i = Math.min(i + props.charsPerTick, props.text.length)
        count.value = i
        if (i >= props.text.length) { clearInterval(timer); streaming.value = false }
      }, props.tickMs)
    })
    onBeforeUnmount(() => clearInterval(timer))
    return () => {
      const shown = props.text.slice(0, count.value)
      const split = streaming.value ? Math.max(0, shown.length - props.blurTail) : shown.length
      return h("span", { style: {} }, [
        shown.slice(0, split),
        split < shown.length ? h("span", { style: { filter: "blur(1px)" } }, [shown.slice(split)]) : null,
        props.caret ? h("span", { "aria-hidden": true, style: { display: "inline-block", width: 1, backgroundColor: "var(--ink)", animation: streaming.value ? undefined : "caret-blink 530ms step-end infinite" } }) : null,
      ])
    }
  },
})
