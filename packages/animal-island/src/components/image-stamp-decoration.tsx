/** React's four CSS masks translated to one SVG luminance mask. Hole radius
 * and pitch stay in pixels; an aspect ratio change never stretches the holes. */
import { computed, defineComponent, ref } from "vue"
import { useElementBounds, type HostNode } from "@gpuiv/vue"
import { svgDecorationCache, svgShadowDecoration, type SvgDropShadow } from "./svg-effects.js"

const STAMP_SHADOWS: readonly SvgDropShadow[] = [
  { offsetX: 0, offsetY: 2, stdDeviation: 3, color: "#000000", opacity: 0.35 },
  { offsetX: 0, offsetY: 16, stdDeviation: 26, color: "#000000", opacity: 0.45 },
]
const cachedPaper = svgDecorationCache()

export function stampPaperDecoration(width: number, height: number) {
  const w = Math.max(1, width), h = Math.max(1, height)
  return cachedPaper(`${w}:${h}`, () => {
    const holes: string[] = []
    for (let x = (w / 2) % 16; x <= w; x += 16) {
      holes.push(`<circle cx="${x}" cy="0" r="5" fill="#000"/><circle cx="${x}" cy="${h}" r="5" fill="#000"/>`)
    }
    for (let y = (h / 2) % 16; y <= h; y += 16) {
      holes.push(`<circle cx="0" cy="${y}" r="5" fill="#000"/><circle cx="${w}" cy="${y}" r="5" fill="#000"/>`)
    }
    const mask = `<mask id="paper" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/>${holes.join("")}</mask>`
    return svgShadowDecoration(w, h, `<rect width="${w}" height="${h}" fill="#fbfaf5" mask="url(#paper)"/>`, STAMP_SHADOWS, mask)
  })
}

export function stampPaperDataUrl(width: number, height: number): string { return stampPaperDecoration(width, height).src }

function textureDataUrl(width: number, height: number): string {
  const w = Math.max(1, width), h = Math.max(1, height)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><pattern id="dots" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="0.6" fill="rgba(18,18,28,0.6)"/></pattern></defs><rect width="${w}" height="${h}" fill="url(#dots)" opacity="0.13"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
}

export const StampSurface = defineComponent({
  name: "AnimalStampSurface",
  props: { texture: { type: Boolean, default: false } },
  setup(props) {
    const surface = ref<HostNode | null>(null)
    const { bounds } = useElementBounds(surface)
    const width = computed(() => bounds.value?.width ?? null)
    const height = computed(() => bounds.value?.height ?? null)
    const paper = computed(() => !props.texture && width.value !== null && height.value !== null ? stampPaperDecoration(width.value, height.value) : null)
    const texture = computed(() => props.texture && width.value !== null && height.value !== null ? textureDataUrl(width.value, height.value) : null)
    return () => <div ref={surface} aria-hidden={true} style={{ position: "absolute", top: props.texture ? 14 : 0, left: props.texture ? 14 : 0, right: props.texture ? 14 : 0, bottom: props.texture ? 14 : 0, pointerEvents: "none" }}>
      {paper.value ? <img src={paper.value.src} objectFit="fill" style={{ position: "absolute", left: paper.value.left, top: paper.value.top, width: paper.value.width, height: paper.value.height, pointerEvents: "none" }} /> : null}
      {texture.value ? <img src={texture.value} objectFit="fill" style={{ width: "100%", height: "100%", pointerEvents: "none" }} /> : null}
    </div>
  },
})
