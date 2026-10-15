/** CSS drop-shadow translated to SVG filter primitives. The CSS blur argument
 * is a Gaussian standard deviation, unlike box-shadow's blur radius / 2.
 * Each successive filter shadows the entire preceding result, not just the
 * original alpha silhouette. Four sigmas of transparent bleed avoid cropping
 * while leaving native content and hitboxes at their original dimensions. */
export interface SvgDropShadow {
  offsetX: number
  offsetY: number
  stdDeviation: number
  color: string
  opacity: number
}

export interface SvgDecoration { src: string; left: number; top: number; width: number; height: number }

const number = (value: number) => String(Number(value.toFixed(6)))
export const escapeSvg = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")

export function dropShadowBounds(width: number, height: number, shadows: readonly SvgDropShadow[]) {
  let left = 0, top = 0, right = width, bottom = height
  for (const shadow of shadows) {
    const bleed = 4 * shadow.stdDeviation
    left += Math.min(0, shadow.offsetX - bleed)
    top += Math.min(0, shadow.offsetY - bleed)
    right += Math.max(0, shadow.offsetX + bleed)
    bottom += Math.max(0, shadow.offsetY + bleed)
  }
  return { left, top, width: right - left, height: bottom - top }
}

export function svgShadowDecoration(width: number, height: number, content: string, shadows: readonly SvgDropShadow[], defs = "", viewport?: Omit<SvgDecoration, "src">): SvgDecoration {
  const bounds = dropShadowBounds(width, height, shadows)
  const image = viewport ?? bounds
  const viewBox = [image.left, image.top, image.width, image.height].map(number).join(" ")
  const filters = shadows.map((shadow, index) => `<feDropShadow in="${index ? `shadow-${index - 1}` : "SourceGraphic"}" dx="${number(shadow.offsetX)}" dy="${number(shadow.offsetY)}" stdDeviation="${number(shadow.stdDeviation)}" flood-color="${escapeSvg(shadow.color)}" flood-opacity="${number(shadow.opacity)}" result="shadow-${index}"/>`).join("")
  const filter = filters ? `<filter id="silhouette-shadow" filterUnits="userSpaceOnUse" x="${number(bounds.left)}" y="${number(bounds.top)}" width="${number(bounds.width)}" height="${number(bounds.height)}" color-interpolation-filters="sRGB">${filters}</filter>` : ""
  // Native SVG images use their intrinsic bitmap dimensions. Rasterize at 2x
  // and place with the logical bounds so small curved holes stay crisp.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(image.width * 2)}" height="${Math.ceil(image.height * 2)}" viewBox="${viewBox}" preserveAspectRatio="none"><defs>${defs}${filter}</defs><g${filters ? ' filter="url(#silhouette-shadow)"' : ""}>${content}</g></svg>`
  return { ...image, src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` }
}

/** Shared bounded cache: resizing can produce many distinct dimensions. */
export function svgDecorationCache() {
  const cache = new Map<string, SvgDecoration>()
  return (key: string, create: () => SvgDecoration): SvgDecoration => {
    const existing = cache.get(key)
    if (existing) { cache.delete(key); cache.set(key, existing); return existing }
    const decoration = create()
    cache.set(key, decoration)
    if (cache.size > 64) cache.delete(cache.keys().next().value!)
    return decoration
  }
}
