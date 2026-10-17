import { afterEach, describe, expect, it } from "vitest"
import { defineComponent, h, ref } from "vue"
import type { StyleDesc } from "@gpuiv/vue"
import { Image, type ImageProps } from "../src/components/Image.js"
import { mountHost } from "./harness.js"

const hosts: ReturnType<typeof mountHost>[] = []
afterEach(() => hosts.splice(0).forEach(host => host.unmount()))
function mount(props: Partial<ImageProps> & { style?: StyleDesc } = {}) {
  const host = mountHost(defineComponent({ setup: () => () => h(Image, { src: "island.svg", preview: false, testId: "picture", ...props }) }))
  hosts.push(host)
  return host
}
const style = (host: ReturnType<typeof mountHost>, id = "picture") => host.find(id).props.style as StyleDesc
const load = (host: ReturnType<typeof mountHost>, src = "island.svg", naturalWidth: unknown = 80, naturalHeight: unknown = 60) => host.fire("picture-img", "load", {
  value: JSON.stringify({ src, naturalWidth, naturalHeight }),
})

describe("Image single-axis intrinsic dimensions", () => {
  it.each([240, "240px", " +240px "])("derives a missing height from a %s pixel width after decoding", async width => {
    const host = mount({ width })
    expect(style(host).height).toBeUndefined()
    await load(host)
    expect(style(host)).toMatchObject({ width, height: 180 })
    expect(style(host, "picture-img")).toMatchObject({ width: 240, height: 180 })
    expect(host.find("picture-img").props.motion).toMatchObject({ animate: { opacity: 1 } })
  })

  it.each([180, "180px"])("derives a missing width from a %s pixel height", async height => {
    const host = mount({ height })
    await load(host)
    expect(style(host)).toMatchObject({ width: 240, height })
    expect(style(host, "picture-img")).toMatchObject({ width: 240, height: 180 })
  })

  it.each([
    ["bordered", 12, 186, 216, 162],
    ["stamp", 14, 187, 212, 159],
  ] as const)("accounts for %s padding in the frame and the actual image content", async (variant, padding, frameHeight, contentWidth, contentHeight) => {
    const host = mount({ width: 240, variant })
    await load(host)
    expect(style(host)).toMatchObject({ width: 240, height: frameHeight, padding })
    expect(style(host, "picture-img")).toMatchObject({ width: contentWidth, height: contentHeight })
  })

  it("uses final attribute pixel dimensions, padding and border sides while preserving style overrides", async () => {
    const host = mount({ width: 300, variant: "bordered", style: {
      width: "240px", padding: 20, paddingLeft: 10, paddingBottom: 5, borderWidth: 2, borderRightWidth: 4,
      backgroundColor: "#ffddcc",
    } })
    await load(host)
    // content width = 240-(10+20+2+4)=204; ratio height=153;
    // vertical frame insets = 20+5+2+2=29.
    expect(style(host)).toMatchObject({ width: "240px", height: 182, paddingLeft: 10, paddingBottom: 5, backgroundColor: "#ffddcc" })
    expect(style(host, "picture-img")).toMatchObject({ width: 204, height: 153 })
  })

  it("respects final two-axis styles and keeps a deliberate non-proportional fill box", async () => {
    const host = mount({ width: 300, height: 250, style: { width: 240, height: 100 } })
    await load(host)
    expect(style(host)).toMatchObject({ width: 240, height: 100 })
    expect(style(host, "picture-img")).toMatchObject({ width: 240, height: 100 })
    expect(host.find("picture-img").props.objectFit).toBe("fill")
  })

  it("uses known pixel min/max constraints without guessing unresolved percentage constraints", async () => {
    const host = mount({ width: 240, style: { maxWidth: 120 } })
    await load(host)
    expect(style(host)).toMatchObject({ width: 240, height: 90, maxWidth: 120 })
    expect(style(host, "picture-img")).toMatchObject({ width: 120, height: 90 })
    const unknown = mount({ width: 240, style: { maxWidth: "75%" } })
    await load(unknown)
    expect(style(unknown).height).toBeUndefined()
  })

  it.each(["75%", "auto", "calc(100% - 20px)"])("does not invent a missing dimension for %s", async width => {
    const host = mount({ width })
    await load(host)
    expect(style(host).height).toBeUndefined()
    expect(style(host, "picture-img")).toMatchObject({ width: "100%" })
    expect(style(host, "picture-img").height).toBeUndefined()
  })

  it("does not replace an explicitly supplied auto axis or attribute percentage override", async () => {
    const auto = mount({ width: 240, height: "auto" })
    await load(auto)
    expect(style(auto)).toMatchObject({ width: 240, height: "auto" })
    const percent = mount({ width: 240, style: { width: "50%" } })
    await load(percent)
    expect(style(percent)).toMatchObject({ width: "50%" })
    expect(style(percent).height).toBeUndefined()
  })

  it("keeps padding-only content boxes non-negative when a supplied axis is smaller than its insets", async () => {
    const host = mount({ width: 20, variant: "bordered" })
    await load(host)
    expect(style(host).height).toBe(24)
    expect(style(host, "picture-img")).toMatchObject({ width: 0, height: 0 })
  })

  it.each([[0, 60], [80, 0], ["80", 60], [80, null], [1e308, 1e-308]])("ignores invalid natural dimensions %s x %s", async (width, height) => {
    const host = mount({ width: 240 })
    await load(host, "island.svg", width, height)
    expect(style(host).height).toBeUndefined()
  })

  it("does not guess the ratio when a matching load lacks natural dimensions", async () => {
    const host = mount({ width: 240 })
    await host.fire("picture-img", "load", { value: JSON.stringify({ src: "island.svg", naturalWidth: 80 }) })
    expect(style(host).height).toBeUndefined()
  })

  it("clears the previous source ratio, rejects stale completion, and applies the replacement ratio", async () => {
    const src = ref("first.svg")
    const host = mountHost(defineComponent({ setup: () => () => h(Image, { src: src.value, width: 240, testId: "picture", preview: false }) }))
    hosts.push(host)
    await load(host, "first.svg")
    expect(style(host).height).toBe(180)
    src.value = "second.svg"
    await host.settle()
    expect(style(host).height).toBeUndefined()
    await load(host, "first.svg")
    expect(style(host).height).toBeUndefined()
    await load(host, "second.svg", 80, 40)
    expect(style(host).height).toBe(120)
    await host.fire("picture-img", "error", { value: JSON.stringify({ src: "second.svg", error: "failed" }) })
    expect(style(host).height).toBeUndefined()
    expect(style(host)).toMatchObject({ width: 240, padding: 12, flexDirection: "column" })
    expect(host.text()).toContain("图片加载失败")
  })
})
