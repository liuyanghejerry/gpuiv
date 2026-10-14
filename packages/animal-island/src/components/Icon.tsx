/** Icon — ported from animal-island-vue Icon.vue / _svg-data.ts (MIT), #164.
 * All 101 SVGs use the full-colour image pipeline. color/strokeWidth override
 * root strokes without discarding inner fills; custom icon components work.
 * Optional monochrome URLs remain available via getIconDataUrl. CSS bounce
 * rotation/scale is omitted; native dimensions do not accept em/rem.
 */

import { defineComponent, h, type Component, type PropType } from "vue"
import type { StyleDesc } from "@gpuiv/vue"
import { ICON_NAMES, ICON_SVG, type IconName } from "../icons/svg-data.js"

export { ICON_NAMES }
export type { IconName }

function kebabAttr(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

/** The data file carries React JSX leftovers in `attrs`
 *  (`strokeWidth={3.5}`, `{...props}`, camelCase names); rewrite them into
 *  plain SVG attributes and collapse the embedded newlines. */
function cleanAttrs(raw: string): string {
  return raw
    .replace(/\{\.\.\.props\}/g, " ")
    .replace(/([a-zA-Z][\w-]*)=\{([^{}]*)\}/g, (_m, name: string, value: string) => `${kebabAttr(name)}="${value.trim()}"`)
    .replace(/\bstroke(Linecap|Linejoin)\b/g, (_m, part: string) => `stroke-${part.toLowerCase()}`)
    .replace(/\s+/g, " ")
    .trim()
}

/** Recolour every fill/stroke to #000 for GPUIV's tint renderer.
 *  `none` is a paint keyword, not a colour — it must survive. */
function toMonochrome(markup: string): string {
  return markup.replace(/\b(fill|stroke)="(?!none")[^"]*"/g, '$1="#000"')
}

function buildSvgDocument(name: IconName, monochrome: boolean, strokeWidth?: number | string, color?: string): string {
  const data = ICON_SVG[name]
  let attrs = cleanAttrs(data.attrs)
  let inner = data.inner.replace(/\s+/g, " ").trim()
  if (monochrome) {
    attrs = toMonochrome(attrs)
    inner = toMonochrome(inner)
  }
  const setAttr = (key: string, value: string) => {
    const escaped = value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
    const pattern = new RegExp(`\\b${key}="[^"]*"`)
    attrs = pattern.test(attrs) ? attrs.replace(pattern, `${key}="${escaped}"`) : `${attrs} ${key}="${escaped}"`
  }
  if (strokeWidth !== undefined) setAttr("stroke-width", String(strokeWidth))
  if (color !== undefined) setAttr("stroke", color)
  return `<svg ${attrs}>${inner}</svg>`
}

const dataUrlCache = new Map<string, string>()

/** `data:image/svg+xml;base64,…` URL for an icon, baked on first use and
 *  memoised per (name, monochrome, strokeWidth) combination. */
export function getIconDataUrl(name: IconName, opts?: { monochrome?: boolean; strokeWidth?: number | string; color?: string }): string {
  const monochrome = opts?.monochrome ?? false
  const strokeWidth = opts?.strokeWidth
  const key = JSON.stringify([name, monochrome, strokeWidth, opts?.color])
  const cached = dataUrlCache.get(key)
  if (cached !== undefined) return cached
  const url = `data:image/svg+xml;base64,${Buffer.from(buildSvgDocument(name, monochrome, strokeWidth, opts?.color), "utf8").toString("base64")}`
  dataUrlCache.set(key, url)
  return url
}

export const Icon = defineComponent({
  name: "AnimalIcon",
  inheritAttrs: false,
  props: {
    name: { type: String as PropType<IconName>, default: undefined },
    icon: { type: [Object, Function] as PropType<Component>, default: undefined },
    size: { type: [Number, String] as PropType<number | string>, default: 24 },
    color: { type: String, default: undefined },
    strokeWidth: { type: [Number, String] as PropType<number | string>, default: undefined },
    src: { type: String, default: undefined },
    // Inert: the original's hover bounce is a CSS keyframe animation, which
    // GPUIV cannot express. Accepted for API parity only.
    bounce: { type: Boolean, default: false },
    alt: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    return () => {
      const style: StyleDesc = {
        width: props.size,
        height: props.size,
        flexShrink: 0,
        ...(attrs.style as StyleDesc | undefined),
      }
      // The original derives this from a present `aria-label` attr.
      const label = props.alt ?? attrs["aria-label"]
      const a11y = label !== undefined ? { role: "img", "aria-label": label } : { "aria-hidden": true }

      // Custom image URL, passed straight through (the original used a
      // background-image span, which GPUIV cannot paint).
      if (props.icon) return h(props.icon, { ...attrs, ...a11y, style, ...(props.color === undefined ? {} : { stroke: props.color }), ...(props.strokeWidth === undefined ? {} : { strokeWidth: String(props.strokeWidth) }) })

      const name = props.name
      if (name === undefined || ICON_SVG[name] === undefined) {
        if (props.src !== undefined) return <img {...attrs} {...a11y} src={props.src} objectFit="contain" style={style} />
        // The original renders an empty sized span in this case.
        return <div {...attrs} {...a11y} style={style} />
      }

      // Full-colour mode: <img> decodes the baked SVG as a colour image.
      return <img {...attrs} {...a11y} src={getIconDataUrl(name, { color: props.color, strokeWidth: props.strokeWidth })} objectFit="contain" style={style} />
    }
  },
})

export default Icon
