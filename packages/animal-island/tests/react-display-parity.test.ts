import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, ref } from "vue"
import { Avatar } from "../src/components/Avatar.js"
import { Badge } from "../src/components/Badge.js"
import { Countdown } from "../src/components/Countdown.js"
import { Progress } from "../src/components/Progress.js"
import { Typewriter } from "../src/components/Typewriter.js"
import { CountUp } from "../src/components/CountUp.js"
import { mountHost } from "./harness.js"

const hosts: ReturnType<typeof mountHost>[] = []
const mount = (component: Parameters<typeof mountHost>[0], overrides: Parameters<typeof mountHost>[1] = {}) => {
  const host = mountHost(component, overrides)
  hosts.push(host)
  return host
}
afterEach(() => { hosts.splice(0).forEach(host => host.unmount()); vi.useRealTimers() })

describe("React display component parity", () => {
  it.each([CountUp, Countdown])("restores the %s island dashed outline without changing native border layout", async component => {
    const host = mount(defineComponent(() => () => h(component, { ...(component === CountUp ? { end: 100 } : { value: 0 }), variant: "island", testId: "island", style: { borderColor: "#aa6622", borderWidth: 3, borderRadius: 16 } })))
    await host.settle()
    expect(host.find("island").props.style).toMatchObject({ position: "relative", borderWidth: 3, borderColor: "transparent", borderRadius: 16 })
    const image = host.find(node => node.type === "img" && String(node.props.src).startsWith("data:image/svg+xml"))
    const svg = Buffer.from(String(image.props.src).split(",")[1], "base64").toString()
    expect(svg).toContain('stroke="#aa6622"')
    expect(svg).toContain('stroke-width="3"')
    expect(svg).toContain('stroke-dasharray="9 9"')
    expect(image.props.style).toMatchObject({ pointerEvents: "none" })
  })
  it.each([["small", 14], ["middle", 24], ["large", 32]] as const)("Progress %s keeps React track height %s and default teal", async (size, height) => {
    const host = mount(defineComponent(() => () => h(Progress, { percent: 50, size, duration: 0, testId: "progress" })), { getElementBounds: () => ({ x: 0, y: 0, width: 400, height }) })
    await host.settle()
    expect(host.find(node => (node.props.style as { borderColor?: string })?.borderColor === "#e2d6bd").props.style).toMatchObject({ height, borderWidth: 2 })
    expect(host.find(node => (node.props.style as { backgroundColor?: string })?.backgroundColor === "#19c8b9").props.style).toMatchObject({ width: 198 })
  })
  it.each(["sweet-corner", "forest-grove", "starry-camp", "coffee-break"] as const)("Progress reveals %s at the full track width, not the fill width", async variant => {
    const percent = ref(25)
    const host = mount(defineComponent(() => () => h(Progress, { variant, percent: percent.value, duration: 0 })), { getElementBounds: () => ({ x: 0, y: 0, width: 400, height: 24 }) })
    await host.settle()
    const image = host.find(node => node.type === "img" && String(node.props.src).endsWith(`${variant}.svg`))
    expect(image.props.src).toMatch(new RegExp(`${variant}\\.svg$`))
    expect(image.props.style).toMatchObject({ width: 396, height: 222.75, pointerEvents: "none" })
    expect(image.parent!.props.style).toMatchObject({ width: 99, overflow: "hidden" })
    percent.value = 75
    await host.settle()
    expect(image.props.style).toMatchObject({ width: 396 })
    expect(image.parent!.props.style).toMatchObject({ width: 297 })
  })
  it("Progress accepts rich info formatting and clamps invalid/out of range values", async () => {
    const percent = ref(Number.NaN)
    const host = mount(defineComponent(() => () => h(Progress, { percent: percent.value, infoFormat: value => h("text", `抵达 ${value}`), testId: "progress" })))
    await host.settle()
    expect(host.find("progress").props["aria-valuenow"]).toBe(0)
    expect(host.text()).toContain("抵达 0")
    expect(host.find("progress").props["aria-valuetext"]).toBeUndefined()
    percent.value = 200
    await host.settle()
    expect(host.text()).toContain("抵达 100")
    expect(host.find("progress").props["aria-valuenow"]).toBe(100)
  })
  it("Badge accepts VNode counts, hides null/blank values and uses native entrance motion", async () => {
    const count = ref<unknown>(h("text", "新"))
    const host = mount(defineComponent(() => () => h(Badge, { count: count.value as never, testId: "badge" })))
    expect(host.text()).toContain("新")
    const indicator = host.find(node => !!node.props.motion)
    expect(indicator.props.motion).toMatchObject({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: .2 } })
    count.value = null
    await host.settle()
    expect(host.all().some(node => !!node.props.motion)).toBe(false)
    count.value = "   "
    await host.settle()
    expect(host.all().some(node => !!node.props.motion)).toBe(false)
    count.value = "100"
    await host.settle()
    expect(host.text()).toContain("99+")
  })
  it("Countdown rolls digits downward with native motion and finishes only once", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    const onFinish = vi.fn(), onChange = vi.fn()
    const value = ref(1000)
    const host = mount(defineComponent(() => () => h(Countdown, { value: value.value, format: "ss", prefix: h("text", "剩余"), onFinish, onChange, testId: "timer" })))
    expect(host.find("timer").props["aria-valuetext"]).toBe("01")
    expect(host.text()).toContain("剩余")
    const digit = host.find(node => (node.props.motion as { animate?: { top?: number } } | undefined)?.animate?.top === -31)
    await vi.advanceTimersByTimeAsync(1000)
    await host.settle()
    expect(host.find("timer").props["aria-valuetext"]).toBe("00")
    expect(digit.props.motion).toMatchObject({ animate: { top: -0 }, transition: { duration: .35 } })
    expect(onFinish).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenLastCalledWith(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onFinish).toHaveBeenCalledOnce()
    value.value = 11000
    await host.settle()
    expect(host.find("timer").props["aria-valuetext"]).toBe("09")
    const wrapped = host.find(node => (node.props.motion as { initial?: { top?: number }; animate?: { top?: number } } | undefined)?.initial?.top === -310)
    expect(wrapped.props.motion).toMatchObject({ initial: { top: -310 }, animate: { top: -279 } })
  })
  it("Countdown preserves format day/hour rules and cancels its clock when removed", () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    const host = mount(defineComponent(() => () => h(Countdown, { value: 90061000, format: "DD天HH:mm:ss", testId: "timer" })))
    expect(host.find("timer").props["aria-valuetext"]).toBe("01天01:01:01")
    host.unmount(); hosts.pop()
    expect(vi.getTimerCount()).toBe(0)
  })
  it("Avatar gap scales measured text once while position changes leave mutations idle", async () => {
    vi.useFakeTimers()
    let box = { x: 0, y: 0, width: 100, height: 16 }
    const gap = ref(4)
    const host = mount(defineComponent(() => () => h(Avatar, { gap: gap.value, size: 40, testId: "avatar" }, { default: () => h("text", "LONG NAME") })), { getElementBounds: () => box })
    await host.settle()
    const visible = () => host.find("avatar").children.find(node => (node.props.style as { flexShrink?: number; opacity?: number } | undefined)?.flexShrink === 0 && (node.props.style as { opacity?: number })?.opacity !== 0)!
    expect(visible().props.style).toMatchObject({ fontSize: 5.12 })
    const batches = vi.spyOn(host.native, "applyBatch")
    box = { ...box, x: 40, y: -80 }
    await vi.advanceTimersByTimeAsync(100)
    await host.settle()
    expect(batches).not.toHaveBeenCalled()
    gap.value = 0
    await host.settle()
    expect(visible().props.style).toMatchObject({ fontSize: 6.4 })
    batches.mockRestore()
  })
  it("Avatar accepts React node-valued icon content rather than only a component VNode", () => {
    const host = mount(defineComponent(() => () => h("div", [
      h(Avatar, { icon: "海" }),
      h(Avatar, { icon: [h("text", "A"), h("text", "B")] }),
    ])))
    expect(host.text()).toContain("海")
    expect(host.text()).toContain("A")
    expect(host.text()).toContain("B")
    expect(host.text()).not.toContain("[object Object]")
  })
  it("Typewriter replays when slot text length changes after completing", async () => {
    vi.useFakeTimers()
    const text = ref("ab"), onDone = vi.fn()
    const host = mount(defineComponent(() => () => h(Typewriter, { speed: 10, onDone }, { default: () => h("text", text.value) })))
    await vi.advanceTimersByTimeAsync(30)
    await host.settle()
    expect(host.text()).toBe("ab")
    expect(onDone).toHaveBeenCalledOnce()
    text.value = "abcd"
    await host.settle()
    expect(host.text()).toBe("")
    await vi.advanceTimersByTimeAsync(40)
    await host.settle()
    expect(host.text()).toBe("abcd")
    expect(onDone).toHaveBeenCalledTimes(2)
  })
  it("Typewriter autoPlay false shows rich content and emits done like React", async () => {
    const onDone = vi.fn()
    const host = mount(defineComponent(() => () => h(Typewriter, { autoPlay: false, onDone }, { default: () => h("text", ["hello ", h("text", { style: { color: "#ff0000" } }, "island")]) })))
    await host.settle()
    expect(host.text()).toContain("hello")
    expect(host.text()).toContain("island")
    expect(onDone).toHaveBeenCalledOnce()
  })
})
