/** React Button's original 2.5s counterclockwise Donut rotation, expressed as
 * cached SVG artwork rather than an unsupported host transform property. */
import { defineComponent, onBeforeUnmount, onMounted, ref } from "vue"
import { getIconDataUrl } from "./Icon.js"

const period = 2500
const frameCount = 64
const frames = new Map<number, string>()
function frame(phase: number): string {
  const index = Math.floor(((phase % period + period) % period) / period * frameCount)
  let src = frames.get(index)
  if (!src) {
    const svg = Buffer.from(getIconDataUrl("Donut", { color: "#ffffff" }).split(",")[1]!, "base64").toString()
    const end = svg.indexOf(">") + 1
    const rotated = `${svg.slice(0, end)}<g transform="rotate(${-index * 360 / frameCount} 24 24)">${svg.slice(end, svg.lastIndexOf("</svg>"))}</g></svg>`
    src = `data:image/svg+xml;base64,${Buffer.from(rotated).toString("base64")}`
    frames.set(index, src)
  }
  return src
}

export const ButtonLoadingIcon = defineComponent({
  name: "AnimalButtonLoadingIcon",
  props: {
    testId: { type: String, default: undefined },
    /** Pin an SVG frame in deterministic component tests. */
    phase: { type: Number, default: undefined },
  },
  setup(props) {
    const elapsed = ref(0)
    let timer: ReturnType<typeof setInterval> | undefined
    onMounted(() => {
      if (props.phase !== undefined) return
      const start = Date.now()
      timer = setInterval(() => { elapsed.value = Date.now() - start }, 40)
    })
    onBeforeUnmount(() => { if (timer !== undefined) clearInterval(timer) })
    return () => <img testId={props.testId} src={frame(props.phase ?? elapsed.value)} alt="" aria-hidden={true}
      objectFit="contain" style={{ width: 28, height: 28, flexShrink: 0, pointerEvents: "none" }} />
  },
})
