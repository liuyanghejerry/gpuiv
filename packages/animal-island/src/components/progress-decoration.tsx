/** React Progress's original surface artwork, rendered through native images.
 * SVG keeps the 60% gradient stop that the native two-stop gradient API cannot
 * represent. GPUI's image corner radii clip the fill at its current animated
 * width; the SVG never has to be regenerated for each native motion frame.
 * Track dimensions come from Progress's existing width measurement, rather
 * than another element-bounds poll. Decorative images do not create hitboxes.
 */
import { defineComponent } from "vue"

const encode = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
const fillSources = new Map<boolean, string>()
const trackSources = new Map<string, string>()
const maxTrackSources = 64

export function progressFillDataUrl(completed: boolean): string {
  let source = fillSources.get(completed)
  if (source !== undefined) return source
  const stops = completed
    ? '<stop offset="0" stop-color="#7fe0d5"/><stop offset="1" stop-color="#3dd4c6"/>'
    : '<stop offset="0" stop-color="#3dd4c6"/><stop offset="0.6" stop-color="#19c8b9"/><stop offset="1" stop-color="#14b6a8"/>'
  // A tall rasterization surface retains the three-stop ramp even at high DPR;
  // its horizontal pixels are uniform and can stretch to any animated width.
  source = encode(`<svg xmlns="http://www.w3.org/2000/svg" width="2" height="256" viewBox="0 0 2 256" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1" color-interpolation="sRGB">${stops}</linearGradient></defs><rect width="2" height="256" fill="url(#fill)"/></svg>`)
  fillSources.set(completed, source)
  return source
}

export function progressTrackDataUrl(width: number, height: number): string {
  const w = Math.max(1, width), h = Math.max(1, height)
  const key = `${w}:${h}`
  let source = trackSources.get(key)
  if (source !== undefined) return source
  source = encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><pattern id="dots" x="7" y="7" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r="1.5" fill="rgba(196, 184, 158, 0.1)"/></pattern><clipPath id="track"><rect width="${w}" height="${h}" rx="${h / 2}"/></clipPath></defs><rect width="${w}" height="${h}" fill="url(#dots)" clip-path="url(#track)"/></svg>`)
  if (trackSources.size >= maxTrackSources) trackSources.delete(trackSources.keys().next().value!)
  trackSources.set(key, source)
  return source
}

export const ProgressFillDecoration = defineComponent({
  name: "AnimalProgressFillDecoration",
  props: {
    completed: { type: Boolean, default: false },
    height: { type: Number, required: true },
    testId: { type: String, default: undefined },
  },
  setup(props) {
    return () => <img testId={props.testId} src={progressFillDataUrl(props.completed)} alt="" aria-hidden={true}
      objectFit="fill" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: props.height,
        minHeight: props.height, maxHeight: props.height, borderRadius: 999, pointerEvents: "none" }} />
  },
})

export const ProgressTrackDecoration = defineComponent({
  name: "AnimalProgressTrackDecoration",
  props: {
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    testId: { type: String, default: undefined },
  },
  setup(props) {
    return () => props.width > 0 ? <img testId={props.testId} src={progressTrackDataUrl(props.width, props.height)}
      alt="" aria-hidden={true} objectFit="fill" style={{ position: "absolute", top: 0, left: 0,
        width: props.width, height: props.height, borderRadius: 999, pointerEvents: "none" }} /> : null
  },
})
