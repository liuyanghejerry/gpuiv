/** Decorative tiles translated from animal-island-vue Background.vue (MIT).
 * SVG patterns preserve tile periods and colours through GPUIV's image pipeline.
 */
import { computed, defineComponent, ref } from "vue"
import { useElementBounds, type HostNode } from "@gpuiv/vue"

const dots: Record<string, [string, string]> = {
  "default": [
    "rgba(196, 184, 158, 0.15)",
    "rgba(196, 184, 158, 0.1)"
  ],
  "dots-dark-green": [
    "rgba(90, 160, 90, 0.22)",
    "rgba(140, 200, 140, 0.15)"
  ],
  "dots-pink": [
    "rgba(248, 166, 178, 0.26)",
    "rgba(255, 200, 210, 0.18)"
  ],
  "dots-purple": [
    "rgba(183, 125, 238, 0.18)",
    "rgba(220, 180, 255, 0.12)"
  ],
  "dots-blue": [
    "rgba(136, 157, 240, 0.18)",
    "rgba(180, 195, 255, 0.12)"
  ],
  "dots-yellow": [
    "rgba(247, 205, 103, 0.26)",
    "rgba(255, 230, 160, 0.18)"
  ],
  "dots-orange": [
    "rgba(229, 146, 102, 0.18)",
    "rgba(255, 190, 150, 0.12)"
  ],
  "dots-teal": [
    "rgba(130, 213, 187, 0.26)",
    "rgba(170, 235, 210, 0.18)"
  ],
  "dots-green": [
    "rgba(138, 198, 138, 0.18)",
    "rgba(180, 220, 180, 0.12)"
  ],
  "dots-red": [
    "rgba(252, 115, 109, 0.18)",
    "rgba(255, 160, 155, 0.12)"
  ],
  "dots-lime-green": [
    "rgba(209, 218, 73, 0.26)",
    "rgba(230, 240, 130, 0.18)"
  ],
  "dots-yellow-green": [
    "rgba(236, 223, 82, 0.26)",
    "rgba(255, 245, 140, 0.18)"
  ],
  "dots-brown": [
    "rgba(154, 131, 90, 0.18)",
    "rgba(190, 165, 120, 0.12)"
  ],
  "dots-warm-peach-pink": [
    "rgba(225, 140, 111, 0.18)",
    "rgba(255, 185, 160, 0.12)"
  ],
  "dots-gray": ["rgba(140, 140, 140, 0.18)", "rgba(190, 190, 190, 0.12)"]
}
const sprinkles = [
  {
    "x": 0,
    "y": 0,
    "width": 190,
    "height": 170,
    "inner": "<defs><linearGradient id='shade0' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fff' stop-opacity='.55'/><stop offset='.45' stop-color='#fff' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='.25'/></linearGradient></defs><g transform='translate(18 26) rotate(24)'><rect width='17' height='4.6' rx='2.3' fill='#f8a6b2'/><rect width='17' height='4.6' rx='2.3' fill='url(#shade0)'/></g><g transform='translate(120 32) rotate(-38)'><rect width='15' height='4.4' rx='2.2' fill='#f5d04a'/><rect width='15' height='4.4' rx='2.2' fill='url(#shade0)'/></g><g transform='translate(72 76) rotate(76)'><rect width='14' height='4.2' rx='2.1' fill='#8ecae6'/><rect width='14' height='4.2' rx='2.1' fill='url(#shade0)'/></g><g transform='translate(148 108) rotate(12)'><rect width='18' height='4.8' rx='2.4' fill='#95d5b2'/><rect width='18' height='4.8' rx='2.4' fill='url(#shade0)'/></g><g transform='translate(30 128) rotate(-55)'><rect width='15' height='4.4' rx='2.2' fill='#f4a261'/><rect width='15' height='4.4' rx='2.2' fill='url(#shade0)'/></g><g transform='translate(104 148) rotate(100)'><rect width='13' height='4.2' rx='2.1' fill='#c9a7f5'/><rect width='13' height='4.2' rx='2.1' fill='url(#shade0)'/></g>"
  },
  {
    "x": 45,
    "y": 30,
    "width": 230,
    "height": 195,
    "inner": "<defs><linearGradient id='shade1' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fff' stop-opacity='.55'/><stop offset='.45' stop-color='#fff' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='.25'/></linearGradient></defs><g transform='translate(26 30) rotate(-15)'><rect width='16' height='4.6' rx='2.3' fill='#95d5b2'/><rect width='16' height='4.6' rx='2.3' fill='url(#shade1)'/></g><g transform='translate(142 22) rotate(52)'><rect width='14' height='4.2' rx='2.1' fill='#f8a6b2'/><rect width='14' height='4.2' rx='2.1' fill='url(#shade1)'/></g><g transform='translate(198 68) rotate(-70)'><rect width='15' height='4.4' rx='2.2' fill='#f5d04a'/><rect width='15' height='4.4' rx='2.2' fill='url(#shade1)'/></g><g transform='translate(60 98) rotate(33)'><rect width='17' height='4.6' rx='2.3' fill='#c9a7f5'/><rect width='17' height='4.6' rx='2.3' fill='url(#shade1)'/></g><g transform='translate(168 128) rotate(-8)'><rect width='16' height='4.6' rx='2.3' fill='#8ecae6'/><rect width='16' height='4.6' rx='2.3' fill='url(#shade1)'/></g><g transform='translate(96 162) rotate(118)'><rect width='14' height='4.2' rx='2.1' fill='#f4a261'/><rect width='14' height='4.2' rx='2.1' fill='url(#shade1)'/></g>"
  },
  {
    "x": 90,
    "y": 60,
    "width": 255,
    "height": 215,
    "inner": "<defs><linearGradient id='shade2' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fff' stop-opacity='.55'/><stop offset='.45' stop-color='#fff' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='.25'/></linearGradient></defs><g transform='translate(30 26) rotate(65)'><rect width='16' height='4.6' rx='2.3' fill='#f4a261'/><rect width='16' height='4.6' rx='2.3' fill='url(#shade2)'/></g><g transform='translate(152 38) rotate(-30)'><rect width='15' height='4.4' rx='2.2' fill='#c9a7f5'/><rect width='15' height='4.4' rx='2.2' fill='url(#shade2)'/></g><g transform='translate(222 88) rotate(15)'><rect width='17' height='4.8' rx='2.4' fill='#f8a6b2'/><rect width='17' height='4.8' rx='2.4' fill='url(#shade2)'/></g><g transform='translate(82 118) rotate(-95)'><rect width='14' height='4.2' rx='2.1' fill='#f5d04a'/><rect width='14' height='4.2' rx='2.1' fill='url(#shade2)'/></g><g transform='translate(186 158) rotate(48)'><rect width='15' height='4.4' rx='2.2' fill='#95d5b2'/><rect width='15' height='4.4' rx='2.2' fill='url(#shade2)'/></g><g transform='translate(42 184) rotate(10)'><rect width='16' height='4.6' rx='2.3' fill='#8ecae6'/><rect width='16' height='4.6' rx='2.3' fill='url(#shade2)'/></g>"
  }
]

export function patternDataUrl(name: string, width: number, height: number): string {
  const w = Math.max(1, Math.ceil(width)), h = Math.max(1, Math.ceil(height))
  let defs = "", layers = ""
  if (name === "grid") {
    defs = '<pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M0 .5H24M.5 0V24" stroke="#c4b89e" stroke-width="1"/></pattern>'
    layers = '<rect width="100%" height="100%" fill="url(#grid)"/>'
  } else if (name === "sprinkles") {
    defs = sprinkles.map((p, i) => `<pattern id="p${i}" x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" patternUnits="userSpaceOnUse">${p.inner}</pattern>`).join("")
    layers = [...sprinkles.keys()].reverse().map(i => `<rect width="100%" height="100%" fill="url(#p${i})"/>`).join("")
  } else {
    const pattern = name.replace(/^card-/, "")
    const source = dots[pattern] ?? dots.default
    // React's wallpapers use stronger dots in five bright palettes; Card's
    // corresponding textures keep their original 0.18 / 0.12 opacity.
    const pair = name.startsWith("card-") ? source.map((ink, index) => ink.replace(/0\.26\)/, "0.18)").replace(/0\.18\)/, index === 1 ? "0.12)" : "0.18)")) : source
    defs = `<pattern id="large" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="14" cy="14" r="1.4" fill="${pair[0]}"/></pattern><pattern id="small" x="7" y="7" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r="1" fill="${pair[1]}"/></pattern>`
    layers = '<rect width="100%" height="100%" fill="url(#small)"/><rect width="100%" height="100%" fill="url(#large)"/>'
  }
  return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${layers}</svg>`).toString("base64")}`
}

/** Decorates its positioned parent without adding a pointer or scroll hitbox. */
export const PatternSurface = defineComponent({
  name: "AnimalPatternSurface",
  props: { pattern: { type: String, default: "default" }, radius: { type: Number, default: 0 } },
  setup(props) {
    const surface = ref<HostNode | null>(null)
    const { bounds } = useElementBounds(surface)
    // Scrolling changes painted x/y without changing the texture. Primitive
    // computed dimensions keep those position samples out of SVG generation
    // and out of the component's render/mutation path.
    const width = computed(() => bounds.value?.width ?? null)
    const height = computed(() => bounds.value?.height ?? null)
    const src = computed(() => width.value === null || height.value === null
      ? null : patternDataUrl(props.pattern, width.value, height.value))
    return () => <div ref={surface} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden", borderRadius: props.radius, pointerEvents: "none" }}>
      {src.value ? <img src={src.value} style={{ width: "100%", height: "100%", pointerEvents: "none" }} /> : null}
    </div>
  },
})
