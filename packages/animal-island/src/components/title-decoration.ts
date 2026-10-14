/** Title.vue's CSS silhouettes, rendered as full-colour SVG decorations.
 * Native text remains a separate selectable element above these surfaces.
 */
export type DecorationVariant = "ribbon" | "layer" | "tab"
export interface TitlePalette { front: string; back: string; fold: string; text: string }
export interface TitleDecoration { src: string; left: number; top: number; width: number; height: number }
type Point = [number, number]
const n = (value: number) => String(Number(value.toFixed(4)))
const pair = (point: Point) => `${n(point[0])} ${n(point[1])}`
const polygon = (points: Point[]) => `M${points.map(pair).join("L")}Z`

function roundedRect(x: number, y: number, width: number, height: number, radii: [number, number, number, number], project: (point: Point) => Point = p => p) {
  const [tl, tr, br, bl] = radii, right = x + width, bottom = y + height, k = 0.5522847498
  const p = (a: number, b: number) => pair(project([a, b]))
  return `M${p(x + tl, y)}L${p(right - tr, y)}C${p(right - tr + k * tr, y)} ${p(right, y + tr - k * tr)} ${p(right, y + tr)}L${p(right, bottom - br)}C${p(right, bottom - br + k * br)} ${p(right - br + k * br, bottom)} ${p(right - br, bottom)}L${p(x + bl, bottom)}C${p(x + bl - k * bl, bottom)} ${p(x, bottom - bl + k * bl)} ${p(x, bottom - bl)}L${p(x, y + tl)}C${p(x, y + tl - k * tl)} ${p(x + tl - k * tl, y)} ${p(x + tl, y)}Z`
}

/** The original perspective(11.5em) rotateX(3deg), about the front's centre.
 * Projecting the rounded rectangle's cubic control points approximates its
 * corner curves; its edges and the perspective widening are exact.
 */
export function projectRibbonPoint(point: Point, width: number, height: number, em: number): Point {
  const angle = 3 * Math.PI / 180, dy = point[1] - height / 2
  const perspective = 1 - dy * Math.sin(angle) / (11.5 * em)
  return [width / 2 + (point[0] - width / 2) / perspective, height / 2 + dy * Math.cos(angle) / perspective]
}

export function createTitleDecoration(variant: DecorationVariant, em: number, width: number, height: number, colors: TitlePalette): TitleDecoration {
  // Four blur sigmas keep alpha shadows inside the image. The image itself
  // has no border/background, so cutouts really reveal the parent's pixels.
  const sigma = em * (variant === "ribbon" ? 0.12 : variant === "tab" ? 0.16 : 0.08)
  const dy = em * (variant === "ribbon" ? 0.08 : 0.1)
  const bleed = 4 * sigma
  const left = -bleed - (variant === "ribbon" ? 0.6 * em : variant === "layer" ? 0.26 * em : 0)
  const top = -bleed - (variant === "layer" ? 0.3 * em : 0)
  const imageWidth = width + bleed - left + (variant === "ribbon" ? 0.6 * em : 0)
  const imageHeight = height + bleed + dy - top + (variant === "ribbon" ? 0.4 * em : 0)
  let defs = `<filter id="shadow" filterUnits="userSpaceOnUse" x="${n(left)}" y="${n(top)}" width="${n(imageWidth)}" height="${n(imageHeight)}" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation="${n(sigma)}" result="blur"/><feOffset in="blur" dy="${n(dy)}" result="offset"/><feFlood flood-color="#000" flood-opacity="${variant === "ribbon" ? "0.05" : "0.08"}" result="ink"/><feComposite in="ink" in2="offset" operator="in" result="shade"/><feMerge><feMergeNode in="shade"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
  let layers = ""

  if (variant === "ribbon") {
    const tailY = height - 1.3 * em, tailBottom = height + 0.4 * em, tailMid = tailY + 0.85 * em
    const leftX = -0.6 * em, rightX = width - 1.1 * em
    const leftTail = polygon([[leftX + 1.7 * em, tailY], [leftX + 1.7 * em, tailBottom], [leftX, tailBottom], [leftX + 0.51 * em, tailMid], [leftX, tailY]])
    const rightTail = polygon([[rightX, tailY], [rightX + 1.7 * em, tailY], [rightX + 1.19 * em, tailMid], [rightX + 1.7 * em, tailBottom], [rightX, tailBottom]])
    defs += `<clipPath id="left-tail"><path d="${leftTail}"/></clipPath><clipPath id="right-tail"><path d="${rightTail}"/></clipPath>`
    const front = roundedRect(0.1 * em, 0, width - 0.2 * em, height, [0.2 * em, 0.2 * em, 0.2 * em, 0.2 * em], point => projectRibbonPoint(point, width, height, em))
    defs += `<mask id="inset" maskUnits="userSpaceOnUse" x="${n(left)}" y="${n(top)}" width="${n(imageWidth)}" height="${n(imageHeight)}"><path d="${front}" fill="#fff"/><path d="${front}" transform="translate(0 ${n(-0.06 * em)})" fill="#000"/></mask>`
    const leftFold = polygon([[0.15 * em, height - 0.05 * em], [1.1 * em, height - 0.05 * em], [1.1 * em, height + 0.4 * em]])
    const rightFold = polygon([[width - 1.11 * em, height - 0.05 * em], [width - 0.16 * em, height - 0.05 * em], [width - 1.11 * em, height + 0.4 * em]])
    layers = `<g filter="url(#shadow)"><path data-part="tail-left" d="${roundedRect(leftX, tailY, 1.7 * em, 1.7 * em, [0.08 * em, 0, 0, 0.08 * em])}" fill="${colors.back}" clip-path="url(#left-tail)"/><path data-part="tail-right" d="${roundedRect(rightX, tailY, 1.7 * em, 1.7 * em, [0, 0.08 * em, 0.08 * em, 0])}" fill="${colors.back}" clip-path="url(#right-tail)"/><path data-part="fold-left" d="${leftFold}" fill="${colors.fold}"/><path data-part="fold-right" d="${rightFold}" fill="${colors.fold}"/><path data-part="front" d="${front}" fill="${colors.front}"/><path data-part="inset-shade" d="${front}" fill="#000" fill-opacity="0.05" mask="url(#inset)"/></g>`
  } else if (variant === "layer") {
    const radius: [number, number, number, number] = [0.35 * em, 0.35 * em, 0.35 * em, 0.35 * em]
    layers = `<path data-part="back-paper" d="${roundedRect(-0.26 * em, -0.3 * em, width - 0.39 * em, height + 0.3 * em, radius)}" fill="${colors.back}"/><path data-part="front-paper" d="${roundedRect(0, 0, width, height, radius)}" fill="${colors.front}" filter="url(#shadow)"/>`
  } else {
    // CSS 135deg starts at top-left. Its .9em gradient stop projects to
    // x+y=.9√2 em, despite the upstream comment calling it bottom-right.
    const cut = 0.9 * Math.SQRT2 * em, fold = 0.9 * em, radius = 0.32 * em
    defs += `<clipPath id="tab-cut"><path d="${polygon([[cut, 0], [width, 0], [width, height], [0, height], [0, cut]])}"/></clipPath>`
    layers = `<g filter="url(#shadow)"><path data-part="tab-front" d="${roundedRect(0, 0, width, height, [radius, radius, radius, radius])}" fill="${colors.front}" clip-path="url(#tab-cut)"/><path data-part="tab-fold" d="${polygon([[width, height - fold], [width, height], [width - fold, height]])}" fill="${colors.fold}"/></g>`
  }
  // GPUI's full-colour SVG image decoder rasterizes intrinsic dimensions.
  // Supply 2x pixels while retaining logical coordinates in the viewBox.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(imageWidth * 2)}" height="${Math.ceil(imageHeight * 2)}" viewBox="${n(left)} ${n(top)} ${n(imageWidth)} ${n(imageHeight)}" preserveAspectRatio="none"><defs>${defs}</defs>${layers}</svg>`
  return { src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, left, top, width: imageWidth, height: imageHeight }
}
