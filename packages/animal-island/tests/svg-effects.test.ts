import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h } from "vue"
import { BackTop, rocketIconDecoration } from "../src/components/BackTop.js"
import { Image } from "../src/components/Image.js"
import { Tooltip } from "../src/components/Tooltip.js"
import { stampPaperDecoration } from "../src/components/image-stamp-decoration.js"
import { organicSurfaceDecoration } from "../src/components/organic-surface.js"
import { dropShadowBounds } from "../src/components/svg-effects.js"
import { mountHost } from "./harness.js"

const decode = (src: string) => Buffer.from(src.split(",")[1], "base64").toString()
const hosts: ReturnType<typeof mountHost>[] = []
afterEach(() => { hosts.splice(0).forEach(host => host.unmount()); vi.useRealTimers() })

describe("React silhouette filters", () => {
  it("shadows the stamp's perforated alpha in CSS filter order with full outside bleed", () => {
    const art = stampPaperDecoration(240, 176), svg = decode(art.src)
    expect(art).toMatchObject({ left: -116, top: -98, width: 472, height: 408 })
    expect(svg).toContain('viewBox="-116 -98 472 408"')
    expect(svg).toContain('<feDropShadow in="SourceGraphic" dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.35" result="shadow-0"/>')
    expect(svg).toContain('<feDropShadow in="shadow-0" dx="0" dy="16" stdDeviation="26" flood-color="#000000" flood-opacity="0.45" result="shadow-1"/>')
    expect(svg).toContain('<g filter="url(#silhouette-shadow)"><rect width="240" height="176" fill="#fbfaf5" mask="url(#paper)"/>')
    expect(svg).toContain('color-interpolation-filters="sRGB"')
    expect(stampPaperDecoration(240, 176)).toBe(art)
  })

  it("does not clip stamp bleed or turn the decoration into a larger interaction target", async () => {
    const host = mountHost(defineComponent(() => () => h(Image, { testId: "stamp", src: "image.svg", variant: "stamp", width: 240, height: 176, preview: false })), {
      getElementBounds: () => ({ x: 100, y: 100, width: 240, height: 176 }),
    })
    hosts.push(host)
    await host.settle()
    expect(host.find("stamp").props.style).toMatchObject({ width: 240, height: 176, overflow: "visible", padding: 14 })
    const paper = host.find(node => node.type === "img" && String(node.props.src).includes("base64") && decode(String(node.props.src)).includes("silhouette-shadow"))
    expect(paper.props.style).toMatchObject({ position: "absolute", left: -116, top: -98, width: 472, height: 408, pointerEvents: "none" })
    expect(paper.parent?.props.style).toMatchObject({ top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "none" })
  })

  it("uses the island outline for Tooltip's shadow while keeping native text and floating hitboxes", async () => {
    const shadow = [{ offsetX: 0, offsetY: 4, stdDeviation: 14, color: "#794f27", opacity: 0.14 }]
    const art = organicSurfaceDecoration(160, 70, "#f7f3df", "#c4b89e", 2, shadow)
    expect(art).toMatchObject({ left: -56, top: -52, width: 272, height: 182 })
    const svg = decode(art.src)
    expect(svg).toContain('<g filter="url(#silhouette-shadow)"><path')
    expect(svg).toContain('stdDeviation="14"')
    expect(svg).toContain('stroke="#c4b89e" stroke-width="2"')
    const host = mountHost(defineComponent(() => () => h(Tooltip, { testId: "tip", variant: "island", trigger: "click", title: "原生文字" }, { default: () => h("text", "打开") })))
    hosts.push(host)
    await host.fire("tip-trigger", "click")
    expect(host.find(node => node.type === "anchored").props.style).toMatchObject({ backgroundColor: "transparent" })
    expect((host.find("tip-content").props.style as { boxShadow?: unknown }).boxShadow).toBeUndefined()
    expect(host.all().some(node => node.type === "text" && node.children.some(child => child.text === "原生文字"))).toBe(true)
  })

  it("keeps Rocket at 64px with CSS sigma 10/14 and one stable hover viewport", async () => {
    const rest = rocketIconDecoration(false), hover = rocketIconDecoration(true)
    const { src: restSrc, ...restBounds } = rest, { src: hoverSrc, ...hoverBounds } = hover
    expect(restBounds).toEqual(hoverBounds)
    expect(restBounds).toEqual(dropShadowBounds(64, 64, [{ offsetX: 0, offsetY: 4, stdDeviation: 14, color: "#5b4e1e", opacity: 0.32 }]))
    expect(decode(restSrc)).toContain('dy="4" stdDeviation="10"')
    expect(decode(hoverSrc)).toContain('dy="4" stdDeviation="14"')
    expect(decode(hoverSrc)).toContain('transform="scale(1.3333333333333333)"')
    expect(rocketIconDecoration(false)).toBe(rest)
    expect(rocketIconDecoration(true)).toBe(hover)
    vi.useFakeTimers()
    const host = mountHost(defineComponent(() => () => h(BackTop, { target: () => 42, testId: "back" })), { getScrollOffset: () => [0, -500] })
    hosts.push(host)
    await vi.advanceTimersByTimeAsync(120)
    await host.fire("back", "mouseEnter")
    const style = host.find("back-icon").props.motion as { animate: { width: number; left: number } }
    // Transparent bleed is scaled together with the artwork; subtracting it
    // still gives the original 64px * 1.08 hover size and centred origin.
    const scale = style.animate.width / hover.width
    expect(64 * scale).toBeCloseTo(69.12)
    expect(style.animate.left - hover.left * scale).toBeCloseTo((64 - 69.12) / 2)
  })
})
