import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, ref } from "vue"
import { Title, type TitleColor, type TitleSize, type TitleVariant } from "../src/components/Title.js"
import { createTitleDecoration, projectRibbonPoint } from "../src/components/title-decoration.js"
import { mountHost } from "./harness.js"

const hosts: ReturnType<typeof mountHost>[] = []
afterEach(() => {
  hosts.splice(0).forEach(host => host.unmount())
  vi.restoreAllMocks()
  vi.useRealTimers()
})
const palette = { front: "#27d039", back: "#20992a", fold: "#115017", text: "#ffffff" }
const decode = (src: unknown) => Buffer.from(String(src).split(",")[1], "base64").toString("utf8")
const path = (svg: string, part: string) => new RegExp(`<path data-part="${part}" d="([^"]+)"`).exec(svg)![1]

describe("Title decoration geometry from original CSS", () => {
  it("draws both notched ribbon tails behind the original asymmetric fold triangles", () => {
    const art = createTitleDecoration("ribbon", 20, 200, 40, palette)
    const svg = decode(art.src)
    expect(svg).toContain('<clipPath id="left-tail"><path d="M22 14L22 48L-12 48L-1.8 31L-12 14Z"')
    expect(svg).toContain('<clipPath id="right-tail"><path d="M178 14L212 14L201.8 31L212 48L178 48Z"')
    expect(path(svg, "fold-left")).toBe("M3 39L22 39L22 48Z")
    expect(path(svg, "fold-right")).toBe("M177.8 39L196.8 39L177.8 48Z")
    expect(svg.indexOf('data-part="tail-left"')).toBeLessThan(svg.indexOf('data-part="fold-left"'))
    expect(svg.indexOf('data-part="fold-left"')).toBeLessThan(svg.indexOf('data-part="front"'))
    expect(svg).toContain(`fill="${palette.back}"`)
    expect(svg).toContain(`fill="${palette.fold}"`)
    expect(svg).toContain(`fill="${palette.front}"`)
    expect(svg).toContain('stdDeviation="2.4"')
    expect(svg).toContain('dy="1.6"')
    expect(svg).toContain('transform="translate(0 -1.2)"')
    expect(svg).toContain('mask="url(#inset)"')
    expect(art.left).toBeCloseTo(-21.6)
    expect(art.top).toBeCloseTo(-9.6)
    expect(art.width).toBeCloseTo(243.2)
    expect(art.height).toBeCloseTo(68.8)
  })

  it("projects the front about its centre so the top narrows and the bottom widens", () => {
    const top = projectRibbonPoint([2, 0], 200, 40, 20)
    const bottom = projectRibbonPoint([2, 40], 200, 40, 20)
    expect(top[0]).toBeGreaterThan(2)
    expect(bottom[0]).toBeLessThan(2)
    expect(top[1]).toBeGreaterThan(0)
    expect(bottom[1]).toBeGreaterThan(40)
    expect(projectRibbonPoint([100, 20], 200, 40, 20)).toEqual([100, 20])
    const svg = decode(createTitleDecoration("ribbon", 20, 200, 40, palette).src)
    // The native front is not a rectangular div masking the shape.
    expect(path(svg, "front")).toContain("C")
    expect(path(svg, "front")).not.toContain("L196 0")
  })

  it("cuts the real transparent top-left 135deg gradient and keeps the bottom-right flap", () => {
    const svg = decode(createTitleDecoration("tab", 20, 200, 40, palette).src)
    expect(svg).toContain('<clipPath id="tab-cut"><path d="M25.4558 0L200 0L200 40L0 40L0 25.4558Z"')
    expect(svg).toContain('clip-path="url(#tab-cut)"')
    expect(path(svg, "tab-fold")).toBe("M200 22L200 40L182 40Z")
    expect(svg).toContain('stdDeviation="3.2"')
    expect(svg).not.toContain("<rect")
  })

  it("places the darker paper .26em left/.3em above the front with the original right inset", () => {
    const svg = decode(createTitleDecoration("layer", 20, 200, 42, palette).src)
    expect(path(svg, "back-paper").startsWith("M1.8 -6L180 -6")).toBe(true)
    expect(path(svg, "front-paper").startsWith("M7 0L193 0")).toBe(true)
    expect(svg.indexOf('data-part="back-paper"')).toBeLessThan(svg.indexOf('data-part="front-paper"'))
    expect(svg).toContain('stdDeviation="1.6"') // CSS box-shadow blur-radius / 2
    expect(svg).toContain('dy="2"')
  })
})

describe("Title native host structure", () => {
  it.each(["ribbon", "layer", "tab"] as TitleVariant[])("keeps %s text selectable with no opaque quad over its SVG", async variant => {
    const host = mountHost(defineComponent({ setup: () => () => h(Title, { variant, testId: "title" }, { default: () => "小岛标题" }) }), {
      getElementBounds: () => ({ x: 0, y: 0, width: 200, height: variant === "layer" ? 42 : 40 }),
    })
    hosts.push(host)
    await host.settle()
    expect(host.text()).toContain("小岛标题")
    expect(host.find("title-text").type).toBe("text")
    expect(host.find("title-text").props.style).toMatchObject({ pointerEvents: "none", userSelect: "text" })
    expect(host.find("title-decoration").type).toBe("img")
    expect(host.find("title-decoration").props).toMatchObject({ "aria-hidden": true, objectFit: "fill" })
    expect(host.find("title-decoration").props.style).toMatchObject({ pointerEvents: "none" })
    expect(host.all().every(node => !(node.props.style as { backgroundColor?: string } | undefined)?.backgroundColor)).toBe(true)
    const style = host.find("title").props.style
    expect(style).toMatchObject(variant === "ribbon" ? { paddingLeft: 12, paddingRight: 12, paddingBottom: 8 }
      : variant === "layer" ? { paddingLeft: 5.2, paddingTop: 6 } : { paddingLeft: 0, paddingTop: 0 })
  })

  it.each([["small", 14], ["middle", 20], ["large", 28]] as [TitleSize, number][])("resolves %s em geometry while forwarding root attributes", async (size, em) => {
    const host = mountHost(defineComponent({ setup: () => () => h(Title, {
      size, testId: "title", "aria-label": "A title", style: { marginLeft: 4 },
    }, { default: () => "Heading" }) }))
    hosts.push(host)
    await host.settle()
    expect(host.find("title").props).toMatchObject({ "aria-label": "A title", style: { fontSize: em, lineHeight: em, marginLeft: 4 } })
    expect(host.find("title-surface").props.style).toMatchObject({ height: 2 * em, paddingLeft: 1.6 * em, paddingRight: 1.6 * em })
    expect(host.find("title-text").props.style).toMatchObject({ paddingTop: 0.11 * em })
  })

  it("joins plain CJK/emoji/combining-mark slot runs into one selectable native text model", async () => {
    const host = mountHost(defineComponent({ setup: () => () => h(Title, { testId: "title" }, {
      default: () => ["小岛 ", h("text", null, "🐱"), " e\u0301"],
    }) }))
    hosts.push(host)
    await host.settle()
    const text = host.find("title-text")
    expect(text.props.style).toMatchObject({ display: "flex", alignItems: "center", userSelect: "text" })
    expect(text.children).toHaveLength(1)
    expect(text.children[0].text).toBe("小岛 🐱 e\u0301")
  })

  it("preserves styled text and component slots in a horizontal wrapper", async () => {
    const marked = defineComponent({ setup: () => () => h("text", { testId: "custom-slot" }, "岛") })
    const host = mountHost(defineComponent({ setup: () => () => h(Title, { testId: "title" }, {
      default: () => [h("text", { testId: "styled-slot", style: { color: "#ffcc00" } }, "小"), h(marked)],
    }) }))
    hosts.push(host)
    await host.settle()
    expect(host.find("title-text").props.style).toMatchObject({ display: "flex", alignItems: "center" })
    expect(host.find("styled-slot").props.style).toMatchObject({ color: "#ffcc00" })
    expect(host.find("custom-slot").children[0].text).toBe("岛")
  })

  it.each([
    ["default", "#27d039", "#20992a", "#115017", "#ffffff"],
    ["app-pink", "#f8a6b2", "#e06880", "#a03060", "#ffffff"],
    ["purple", "#b77dee", "#9050d0", "#5a1a9a", "#ffffff"],
    ["app-blue", "#889df0", "#5068d8", "#2030a0", "#ffffff"],
    ["app-yellow", "#f7cd67", "#d4a030", "#8a6010", "#725d42"],
    ["app-orange", "#e59266", "#c06a30", "#7a3a10", "#ffffff"],
    ["app-teal", "#82d5bb", "#40a880", "#186048", "#ffffff"],
    ["app-green", "#8ac68a", "#509050", "#205020", "#ffffff"],
    ["app-red", "#fc736d", "#d43030", "#900010", "#ffffff"],
    ["lime-green", "#d1da49", "#90a010", "#485800", "#3d5a1a"],
    ["yellow-green", "#ecdf52", "#c0b010", "#706800", "#725d42"],
    ["brown", "#9a835a", "#705830", "#3a2810", "#ffffff"],
    ["warm-peach-pink", "#e18c6f", "#b85a30", "#6a2a10", "#ffffff"],
  ])("keeps the original four-role %s palette", async (color, front, back, fold, text) => {
    const host = mountHost(defineComponent({ setup: () => () => h(Title, { color: color as TitleColor, testId: "title" }, { default: () => "Title" }) }))
    hosts.push(host)
    await host.settle()
    const svg = decode(host.find("title-decoration").props.src)
    for (const value of [front, back, fold]) expect(svg).toContain(`fill="${value}"`)
    expect(host.find("title").props.style).toMatchObject({ color: text })
  })

  it("does not regenerate or mutate on scroll samples, and refreshes actual dimensions/props", async () => {
    vi.useFakeTimers()
    let box = { x: 10, y: 20, width: 200, height: 40 }
    const variant = ref<TitleVariant>("ribbon"), color = ref<TitleColor>("default")
    const host = mountHost(defineComponent({ setup: () => () => h(Title, {
      variant: variant.value, color: color.value, testId: "title",
    }, { default: () => "Title" }) }), { getElementBounds: () => box })
    hosts.push(host)
    await host.settle()
    const original = host.find("title-decoration").props.src
    const read = vi.spyOn(host.native, "getElementBounds"), apply = vi.spyOn(host.native, "applyBatch"), encode = vi.spyOn(Buffer, "from")
    box = { ...box, x: 40, y: -180 }
    await vi.advanceTimersByTimeAsync(100); await host.settle()
    expect(read).toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(encode).not.toHaveBeenCalled()
    expect(host.find("title-decoration").props.src).toBe(original)

    box = { ...box, width: 300 }
    await vi.advanceTimersByTimeAsync(100); await host.settle()
    expect(encode).toHaveBeenCalledOnce()
    expect(host.find("title-decoration").props.src).not.toBe(original)
    expect((host.find("title-decoration").props.style as { width: number }).width).toBeCloseTo(343.2)
    variant.value = "tab"; color.value = "app-pink"
    await host.settle()
    expect(decode(host.find("title-decoration").props.src)).toContain('data-part="tab-fold"')
    expect(decode(host.find("title-decoration").props.src)).toContain('fill="#f8a6b2"')
    host.unmount(); hosts.pop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
