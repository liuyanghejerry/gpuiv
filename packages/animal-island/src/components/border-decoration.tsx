/** Dashed CSS borders translated to a measured SVG stroke. Only decoration
 * paints here; the parent keeps its transparent native border for layout. */
import { computed, defineComponent, ref, type PropType } from "vue"
import { useElementBounds, type HostNode, type MotionTransition } from "@gpuiv/vue"
import { duration, ease } from "../tokens.js"

export function dashedBorderDataUrl(width: number, height: number, color: string, strokeWidth: number, radius: number): string {
  const w = Math.max(1, width), h = Math.max(1, height), inset = strokeWidth / 2
  const ink = color.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
  const document = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="${inset}" y="${inset}" width="${Math.max(0, w - strokeWidth)}" height="${Math.max(0, h - strokeWidth)}" rx="${Math.max(0, Math.min(radius - inset, (w - strokeWidth) / 2, (h - strokeWidth) / 2))}" fill="none" stroke="${ink}" stroke-width="${strokeWidth}" stroke-dasharray="${strokeWidth * 3} ${strokeWidth * 3}"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(document).toString("base64")}`
}

export const DashedBorderSurface = defineComponent({
  name: "AnimalDashedBorderSurface",
  props: {
    color: { type: String, required: true },
    width: { type: Number, default: 2 },
    radius: { type: Number, default: 0 },
    transition: { type: Object as PropType<MotionTransition>, default: undefined },
  },
  setup(props) {
    const surface = ref<HostNode | null>(null)
    const { bounds } = useElementBounds(surface)
    const width = computed(() => bounds.value?.width ?? null), height = computed(() => bounds.value?.height ?? null)
    // Cache geometry independently of ink. GPUI's monochrome SVG tint can
    // interpolate the outline without re-decoding an SVG for every color.
    const src = computed(() => width.value !== null && height.value !== null ? dashedBorderDataUrl(width.value, height.value, "#ffffff", props.width, props.radius) : null)
    return () => <div ref={surface} aria-hidden={true} style={{ position: "absolute", top: -props.width, left: -props.width, right: -props.width, bottom: -props.width, pointerEvents: "none" }}>
      {src.value ? <svg src={src.value} motion={{ initial: false, animate: { color: props.color }, transition: props.transition ?? { duration: duration.base, ease } }} style={{ width: "100%", height: "100%", color: props.color, pointerEvents: "none" }} /> : null}
    </div>
  },
})
