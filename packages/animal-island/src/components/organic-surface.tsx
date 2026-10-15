/** The original React Modal/Tooltip outline, drawn in the image pipeline.
 * Content stays native and accessible; decoration never intercepts input. */
import { computed, defineComponent, ref, type PropType } from "vue"
import { useElementBounds, type HostNode } from "@gpuiv/vue"
import { escapeSvg, svgDecorationCache, svgShadowDecoration, type SvgDropShadow } from "./svg-effects.js"

const OUTLINE = "M0.501,0.005 L0.501,0.005 L0.523,0.005 L0.549,0.006 C0.704,0.01,0.796,0.017,0.825,0.027 L0.827,0.028 C0.872,0.045,0.939,0.044,0.978,0.17 C1,0.254,1,0.365,0.99,0.505 L0.988,0.513 C0.979,0.558,0.971,0.598,0.965,0.633 C0.956,0.689,0.979,0.77,0.964,0.865 C0.953,0.928,0.921,0.966,0.869,0.979 C0.821,0.986,0.773,0.992,0.726,0.995 L0.712,0.996 L0.694,0.997 C0.648,1,0.586,1,0.507,1 L0.501,1 L0.464,1 C0.385,1,0.325,0.998,0.283,0.995 C0.234,0.992,0.184,0.987,0.133,0.979 C0.081,0.966,0.05,0.928,0.039,0.865 C0.023,0.77,0.047,0.689,0.037,0.633 C0.031,0.595,0.023,0.552,0.013,0.505 C-0.006,0.365,-0.002,0.254,0.024,0.17 C0.064,0.045,0.13,0.045,0.174,0.028 L0.175,0.028 C0.204,0.017,0.303,0.009,0.474,0.005 L0.501,0.005 Z"
const cachedSurface = svgDecorationCache()

export function organicSurfaceDecoration(width: number, height: number, color: string, borderColor?: string, borderWidth = 2, shadows: readonly SvgDropShadow[] = []) {
  const w = Math.max(1, width), h = Math.max(1, height)
  return cachedSurface(JSON.stringify([w, h, color, borderColor, borderWidth, shadows]), () => {
    let axis = 0
    const path = OUTLINE.replace(/[MLCZ]|-?\d*\.?\d+/g, token => {
      if (/^[MLCZ]$/.test(token)) { axis = 0; return token }
      const result = Number(token) * (axis++ % 2 === 0 ? w : h)
      return String(Number(result.toFixed(6)))
    })
    return svgShadowDecoration(w, h, `<path d="${path}" fill="${escapeSvg(color)}"${borderColor ? ` stroke="${escapeSvg(borderColor)}" stroke-width="${borderWidth}" stroke-linejoin="round"` : ""}/>`, shadows)
  })
}

export function organicSurfaceDataUrl(width: number, height: number, color: string, borderColor?: string, borderWidth = 2): string {
  return organicSurfaceDecoration(width, height, color, borderColor, borderWidth).src
}

export const OrganicSurface = defineComponent({
  name: "AnimalOrganicSurface",
  props: { color: { type: String, required: true }, borderColor: { type: String, default: undefined }, borderWidth: { type: Number, default: 2 }, shadows: { type: Array as PropType<readonly SvgDropShadow[]>, default: () => [] } },
  setup(props) {
    const surface = ref<HostNode | null>(null)
    const { bounds } = useElementBounds(surface)
    const width = computed(() => bounds.value?.width ?? null), height = computed(() => bounds.value?.height ?? null)
    const decoration = computed(() => width.value !== null && height.value !== null ? organicSurfaceDecoration(width.value, height.value, props.color, props.borderColor, props.borderWidth, props.shadows) : null)
    return () => <div ref={surface} aria-hidden={true} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "none" }}>
      {decoration.value ? <img src={decoration.value.src} objectFit="fill" style={{ position: "absolute", left: decoration.value.left, top: decoration.value.top, width: decoration.value.width, height: decoration.value.height, pointerEvents: "none" }} /> : null}
    </div>
  },
})
