import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, ref } from "vue"
import { AnimateHeight } from "@gpuiv/vue"
import { PatternSurface } from "../src/patterns.js"
import { Progress } from "../src/components/Progress.js"
import { Carousel } from "../src/components/Carousel.js"
import { mountHost } from "./harness.js"

const hosts: ReturnType<typeof mountHost>[] = []
afterEach(() => {
  hosts.splice(0).forEach((host) => host.unmount())
  vi.restoreAllMocks()
  vi.useRealTimers()
})
function sourceSvg(src: unknown): string { return Buffer.from(String(src).split(",")[1], "base64").toString("utf8") }

describe("size-dependent decoration and controls", () => {
  it("keeps pattern generation and mutations idle for moving bounds, then updates on size or pattern changes", async () => {
    vi.useFakeTimers()
    let box = { x: 10, y: 20, width: 300, height: 100 }
    const pattern = ref("grid")
    const host = mountHost(defineComponent({ setup: () => () => h(PatternSurface, { pattern: pattern.value }) }), { getElementBounds: () => box })
    hosts.push(host)
    await host.settle()
    const image = () => host.find((node) => node.type === "img")
    const before = image().props.src
    const read = vi.spyOn(host.native, "getElementBounds")
    const apply = vi.spyOn(host.native, "applyBatch")
    const encode = vi.spyOn(Buffer, "from")

    box = { ...box, x: 30, y: -180 }
    await vi.advanceTimersByTimeAsync(100)
    await host.settle()
    expect(read).toHaveBeenCalled()
    expect(encode).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(image().props.src).toBe(before)

    box = { ...box, width: 420, height: 160 }
    await vi.advanceTimersByTimeAsync(100)
    await host.settle()
    expect(apply).toHaveBeenCalled()
    expect(encode).toHaveBeenCalledOnce()
    expect(sourceSvg(image().props.src)).toContain('width="420" height="160"')
    expect(image().props.src).not.toBe(before)

    pattern.value = "dots-red"
    await host.settle()
    const svg = sourceSvg(image().props.src)
    expect(svg).toContain("rgba(252, 115, 109, 0.18)")
    expect(svg).toContain('width="420" height="160"')
  })

  it("does not re-send Progress on scroll or track height changes and still adjusts its actual fill width", async () => {
    vi.useFakeTimers()
    let box = { x: 10, y: 20, width: 400, height: 20 }
    const percent = ref(50)
    const host = mountHost(defineComponent({ setup: () => () => h(Progress, { percent: percent.value, duration: 0 }) }), { getElementBounds: () => box })
    hosts.push(host)
    await host.settle()
    const fill = () => host.find((node) => (node.props.style as { backgroundColor?: string })?.backgroundColor === "rgb(255, 193, 7)")
    expect(fill().props.style).toMatchObject({ width: 198 })
    const read = vi.spyOn(host.native, "getElementBounds")
    const apply = vi.spyOn(host.native, "applyBatch")

    box = { ...box, x: 40, y: -200, height: 30 }
    await vi.advanceTimersByTimeAsync(100)
    await host.settle()
    expect(read).toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(fill().props.style).toMatchObject({ width: 198 })

    box = { ...box, width: 500 }
    await vi.advanceTimersByTimeAsync(100)
    await host.settle()
    expect(apply).toHaveBeenCalled()
    expect(fill().props.style).toMatchObject({ width: 248 })
    percent.value = 75
    await host.settle()
    expect(fill().props.style).toMatchObject({ width: 372 })
  })

  it("leaves Carousel mutations idle for moving bounds and updates arrow centering and responsive sizes", async () => {
    vi.useFakeTimers()
    let box = { x: 10, y: 20, width: 600, height: 180 }
    const host = mountHost(defineComponent({ setup: () => () => h(Carousel, { testId: "carousel", duration: 0 }, {
      default: () => [h("div", { key: "one" }, [h("text", "one")]), h("div", { key: "two" }, [h("text", "two")])],
    }) }), { getElementBounds: () => box })
    hosts.push(host)
    await host.settle()
    expect(host.find("carousel-prev").props.style).toMatchObject({ width: 42, height: 42, top: 69 })
    const read = vi.spyOn(host.native, "getElementBounds")
    const apply = vi.spyOn(host.native, "applyBatch")

    box = { ...box, x: 100, y: -300 }
    await vi.advanceTimersByTimeAsync(100)
    await host.settle()
    expect(read).toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()

    box = { ...box, width: 360, height: 260 }
    await vi.advanceTimersByTimeAsync(100)
    await host.settle()
    expect(apply).toHaveBeenCalled()
    expect(host.find("carousel-prev").props.style).toMatchObject({ width: 36, height: 36, top: 112, left: 8 })
    expect(host.find("carousel-next").props.style).toMatchObject({ width: 36, height: 36, top: 112, right: 8 })
    await host.fire("carousel-next", "click")
    expect(host.text()).toContain("two")
    expect(host.text()).not.toContain("one")
  })

  it("keeps AnimateHeight idle for position or width samples and still retargets natural or explicit height", async () => {
    vi.useFakeTimers()
    let box = { x: 10, y: 20, width: 300, height: 100 }
    const height = ref<number | "auto">("auto")
    const complete = vi.fn()
    const host = mountHost(defineComponent({ setup: () => () => h(AnimateHeight, {
      height: height.value, initialHeight: 0, testId: "animated-height", onMotionComplete: complete,
    }, { default: () => h("text", "resizable content") }) }), { getElementBounds: () => box })
    hosts.push(host)
    await host.settle()
    const motion = () => host.find("animated-height").props.motion as { generation: number; animate: { height: number } }
    const firstGeneration = motion().generation
    expect(motion().animate.height).toBe(100)
    const read = vi.spyOn(host.native, "getElementBounds")
    const apply = vi.spyOn(host.native, "applyBatch")

    box = { ...box, x: 40, y: -200, width: 420 }
    await vi.advanceTimersByTimeAsync(100)
    await host.settle()
    expect(read).toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(motion()).toMatchObject({ generation: firstGeneration, animate: { height: 100 } })

    box = { ...box, height: 160 }
    await vi.advanceTimersByTimeAsync(100)
    await host.settle()
    expect(apply).toHaveBeenCalled()
    expect(motion().animate.height).toBe(160)
    expect(motion().generation).toBeGreaterThan(firstGeneration)
    const resizedGeneration = motion().generation
    await host.fire("animated-height", "motionComplete", { motionGeneration: firstGeneration })
    expect(complete).not.toHaveBeenCalled()
    await host.fire("animated-height", "motionComplete", { motionGeneration: resizedGeneration })
    expect(complete).toHaveBeenCalledOnce()

    height.value = 0
    await host.settle()
    expect(motion().animate.height).toBe(0)
    expect(motion().generation).toBeGreaterThan(resizedGeneration)
    apply.mockClear()
    box = { ...box, y: -400, width: 500, height: 220 }
    await vi.advanceTimersByTimeAsync(100)
    await host.settle()
    expect(apply).not.toHaveBeenCalled()
    expect(motion().animate.height).toBe(0)
  })
})
