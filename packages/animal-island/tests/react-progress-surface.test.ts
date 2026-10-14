import { defineComponent, h, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Progress, type ProgressSize } from "../src/components/Progress.js"
import { progressFillDataUrl, progressTrackDataUrl } from "../src/components/progress-decoration.js"
import { mountHost } from "./harness.js"

const hosts: ReturnType<typeof mountHost>[] = []
const svg = (source: unknown) => Buffer.from(String(source).split(",")[1]!, "base64").toString()
function mount(component: Parameters<typeof mountHost>[0], overrides: Parameters<typeof mountHost>[1] = {}) {
  const host = mountHost(component, overrides)
  hosts.push(host)
  return host
}
afterEach(() => { hosts.splice(0).forEach(host => host.unmount()); vi.restoreAllMocks(); vi.useRealTimers() })

describe("React Progress gradient and dotted surfaces", () => {
  it("paints the original three-stop vertical ramp over the existing teal fallback", async () => {
    const host = mount(defineComponent(() => () => h(Progress, { percent: 50, duration: 0, testId: "progress" })), {
      getElementBounds: () => ({ x: 0, y: 0, width: 400, height: 24 }),
    })
    await host.settle()
    const image = host.find("progress-fill-decoration")
    expect(svg(image.props.src)).toContain('<linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"')
    expect(svg(image.props.src)).toContain('<stop offset="0" stop-color="#3dd4c6"/>')
    expect(svg(image.props.src)).toContain('<stop offset="0.6" stop-color="#19c8b9"/>')
    expect(svg(image.props.src)).toContain('<stop offset="1" stop-color="#14b6a8"/>')
    expect(image.props.style).toMatchObject({ width: "100%", height: 20, minHeight: 20, maxHeight: 20, borderRadius: 999, pointerEvents: "none" })
    expect(image.parent!.props.style).toMatchObject({ backgroundColor: "#19c8b9", width: 198 })
  })

  it("uses React's lighter completed ramp when rounded aria-valuenow reaches 100", async () => {
    const percent = ref(99.49)
    const host = mount(defineComponent(() => () => h(Progress, { percent: percent.value, duration: 0, testId: "progress" })))
    await host.settle()
    expect(host.find("progress").props["aria-valuenow"]).toBe(99)
    const before = host.find("progress-fill-decoration").props.src
    percent.value = 99.5
    await host.settle()
    const completed = host.find("progress-fill-decoration").props.src
    expect(host.find("progress").props["aria-valuenow"]).toBe(100)
    expect(completed).not.toBe(before)
    expect(svg(completed)).toContain('<stop offset="0" stop-color="#7fe0d5"/>')
    expect(svg(completed)).toContain('<stop offset="1" stop-color="#3dd4c6"/>')
    expect(svg(completed)).not.toContain('offset="0.6"')
    percent.value = 120
    await host.settle()
    expect(host.find("progress-fill-decoration").props.src).toBe(completed)
  })

  it.each(["sweet-corner", "forest-grove", "starry-camp", "coffee-break"] as const)("keeps %s scene artwork above the dotted track and overrides the completed gradient", async variant => {
    const host = mount(defineComponent(() => () => h(Progress, { variant, percent: 100, duration: 0, testId: "progress" })), {
      getElementBounds: () => ({ x: 0, y: 0, width: 400, height: 24 }),
    })
    await host.settle()
    expect(host.all().some(node => node.props.testId === "progress-fill-decoration")).toBe(false)
    const image = host.find(node => node.type === "img" && String(node.props.src).endsWith(`${variant}.svg`))
    expect(image.props.style).toMatchObject({ width: 396, height: 222.75, pointerEvents: "none" })
    expect(image.parent!.props.style).toMatchObject({ width: 396, overflow: "hidden" })
    const track = image.parent!.parent!
    const decoration = host.find("progress-track-decoration")
    expect(decoration.parent).toBe(track)
    expect(track.children.indexOf(decoration)).toBeLessThan(track.children.indexOf(image.parent!))
  })

  it("restores React's 14px small-dot layer, 7px origin and rounded track clipping", async () => {
    const host = mount(defineComponent(() => () => h(Progress, { percent: 0, duration: 0, testId: "progress" })), {
      getElementBounds: () => ({ x: 0, y: 0, width: 400, height: 24 }),
    })
    await host.settle()
    const image = host.find("progress-track-decoration"), artwork = svg(image.props.src)
    expect(artwork).toContain('width="396" height="20"')
    expect(artwork).toContain('<pattern id="dots" x="7" y="7" width="14" height="14" patternUnits="userSpaceOnUse">')
    expect(artwork).toContain('<circle cx="7" cy="7" r="1.5" fill="rgba(196, 184, 158, 0.1)"/>')
    expect(artwork).toContain('<clipPath id="track"><rect width="396" height="20" rx="10"/></clipPath>')
    expect(image.props.style).toMatchObject({ width: 396, height: 20, borderRadius: 999, pointerEvents: "none" })
    expect(host.find("progress-fill-decoration").parent!.props.style).toMatchObject({ width: 0 })
  })

  it.each([["small", 10], ["middle", 20], ["large", 28]] as const)("fits %s artwork to the %spx inner height without rebuilding the gradient", async (size: ProgressSize, height) => {
    const host = mount(defineComponent(() => () => h(Progress, { percent: 50, size, duration: 0, testId: "progress" })))
    await host.settle()
    expect(host.find("progress-fill-decoration").props.style).toMatchObject({ height, minHeight: height, maxHeight: height })
    expect(host.find("progress-fill-decoration").props.src).toBe(progressFillDataUrl(false))
    expect(svg(host.find("progress-track-decoration").props.src)).toContain(`height="${height}"`)
  })

  it("keeps SVG generation and mutations idle on scroll while reusing the existing measurement", async () => {
    vi.useFakeTimers()
    let box = { x: 0, y: 0, width: 400, height: 24 }
    const percent = ref(50)
    const host = mount(defineComponent(() => () => h(Progress, { percent: percent.value, duration: 0, testId: "progress" })), {
      getElementBounds: () => box,
    })
    await host.settle()
    const fillSource = host.find("progress-fill-decoration").props.src
    const trackSource = host.find("progress-track-decoration").props.src
    const reads = vi.spyOn(host.native, "getElementBounds")
    const batches = vi.spyOn(host.native, "applyBatch")
    const encoding = vi.spyOn(Buffer, "from")
    box = { ...box, x: 40, y: -200, height: 30 }
    await vi.advanceTimersByTimeAsync(100)
    await host.settle()
    expect(reads).toHaveBeenCalled()
    expect(new Set(reads.mock.calls.map(([id]) => id)).size).toBe(1)
    expect(encoding).not.toHaveBeenCalled()
    expect(batches).not.toHaveBeenCalled()
    expect(host.find("progress-track-decoration").props.src).toBe(trackSource)
    box = { ...box, width: 472.125 }
    await vi.advanceTimersByTimeAsync(100)
    await host.settle()
    expect(batches).toHaveBeenCalled()
    expect(encoding).toHaveBeenCalledOnce()
    expect(host.find("progress-track-decoration").props.src).not.toBe(trackSource)
    expect(host.find("progress-fill-decoration").props.src).toBe(fillSource)
    expect(host.find("progress-fill-decoration").parent!.props.style).toMatchObject({ width: 234 })
    encoding.mockClear()
    percent.value = 75
    await host.settle()
    expect(encoding).not.toHaveBeenCalled()
    expect(host.find("progress-fill-decoration").props.src).toBe(fillSource)
    expect(host.find("progress-track-decoration").props.src).toBe(progressTrackDataUrl(468.125, 20))
  })

  it("keeps width animation native instead of generating SVG frames for its intermediate widths", async () => {
    const percent = ref(25)
    const host = mount(defineComponent(() => () => h(Progress, { percent: percent.value, duration: .6, testId: "progress" })), {
      getElementBounds: () => ({ x: 0, y: 0, width: 400, height: 24 }),
    })
    await host.settle()
    const image = host.find("progress-fill-decoration"), source = image.props.src
    expect(image.parent!.props.motion).toMatchObject({ animate: { width: 99 }, transition: { duration: .6, ease: [.4, 0, .2, 1] } })
    percent.value = 75
    await host.settle()
    expect(image.parent!.props.motion).toMatchObject({ animate: { width: 297 } })
    expect(image.props.src).toBe(source)
  })
})
