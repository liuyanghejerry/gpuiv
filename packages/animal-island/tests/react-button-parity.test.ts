import { defineComponent, h, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Button } from "../src/components/Button.js"
import { ButtonLoadingIcon } from "../src/components/button-loading.js"
import { Icon } from "../src/components/Icon.js"
import { mountHost } from "./harness.js"

const cleanups: Array<() => void> = []
function mount(component: Parameters<typeof mountHost>[0]) {
  const app = mountHost(component)
  cleanups.push(app.unmount)
  return app
}
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.useRealTimers() })
const target = (app: ReturnType<typeof mountHost>) => (app.find("button").props.motion as { animate: { top: number } }).animate.top

describe("React Button interaction and artwork", () => {
  it("lifts from Vue pixel-string offsets rather than replacing their position with zero", async () => {
    for (const top of ["10px", "10"]) {
      const pixels = mount(defineComponent(() => () => h(Button, { type: "primary", testId: "button", style: { top } })))
      expect(target(pixels)).toBe(10)
      await pixels.fire("button", "mouseEnter")
      expect(target(pixels)).toBe(9)
      await pixels.fire("button", "mouseDown")
      expect(target(pixels)).toBe(12)
    }
  })

  it("lifts on hover, presses by 2px, and restores its authored position on release and leave", async () => {
    const app = mount(defineComponent(() => () => h(Button, { type: "primary", testId: "button", style: { top: 10 } }, () => "Press")))
    expect(target(app)).toBe(10)
    await app.fire("button", "mouseEnter")
    expect(target(app)).toBe(9)
    await app.fire("button", "mouseDown", { button: 0 })
    expect(target(app)).toBe(12)
    await app.fire("button", "mouseUp")
    expect(target(app)).toBe(9)
    await app.fire("button", "mouseLeave")
    expect(target(app)).toBe(10)
    expect(app.find("button").props.motion).toMatchObject({ initial: false, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } })
  })

  it("cancels a press when leaving or becoming disabled and never activates an inactive button", async () => {
    const disabled = ref(false), click = vi.fn()
    const app = mount(defineComponent(() => () => h(Button, { type: "primary", testId: "button", disabled: disabled.value, onClick: click })))
    await app.fire("button", "mouseDown", { button: 0 })
    await app.fire("button", "mouseLeave")
    expect(target(app)).toBe(0)
    await app.fire("button", "mouseDown", { button: 0 })
    disabled.value = true
    await app.settle()
    expect(target(app)).toBe(0)
    await app.fire("button", "keyDown", { key: "enter" })
    await app.fire("button", "click")
    expect(click).not.toHaveBeenCalled()
  })

  it("keeps right-click, text and link buttons from entering a raised press", async () => {
    const app = mount(defineComponent(() => () => h(Button, { type: "primary", testId: "button" })))
    await app.fire("button", "mouseDown", { button: 2 })
    expect(target(app)).toBe(0)
    for (const type of ["text", "link"] as const) {
      const plain = mount(defineComponent(() => () => h(Button, { type, testId: "button" })))
      await plain.fire("button", "mouseEnter")
      await plain.fire("button", "mouseDown")
      expect(target(plain)).toBe(0)
    }
  })

  it("presses with native Enter/Space and forwards focus and pointer handlers from Tooltip", async () => {
    const focus = vi.fn(), blur = vi.fn(), enter = vi.fn(), click = vi.fn(), key = vi.fn()
    const app = mount(defineComponent(() => () => h(Button, { type: "primary", testId: "button", onFocus: focus, onBlur: blur, onMouseEnter: enter, onKeyDown: key, onClick: click })))
    await app.fire("button", "focus")
    await app.fire("button", "mouseEnter")
    await app.fire("button", "keyDown", { key: "space" })
    expect(target(app)).toBe(2)
    expect(focus).toHaveBeenCalledOnce()
    expect(enter).toHaveBeenCalledOnce()
    expect(key).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    await app.fire("button", "keyUp", { key: "space" })
    expect(target(app)).toBe(-1)
    await app.fire("button", "blur")
    expect(blur).toHaveBeenCalledOnce()
  })

  it("accepts icon VNodes while keeping the artwork out of the button hitbox", () => {
    const app = mount(defineComponent(() => () => h(Button, { icon: h(Icon, { name: "Search" }) }, () => "搜索")))
    expect(app.find(node => node.type === "img").props.style).toMatchObject({ pointerEvents: "none" })
    expect(app.text()).toContain("搜索")
  })

  it("keeps dashed SVG geometry fixed while native motion changes its ink", async () => {
    const app = mount(defineComponent(() => () => h(Button, { type: "dashed", testId: "button" })))
    await app.settle()
    const outline = app.find(node => node.type === "svg")
    const source = outline.props.src
    const svg = Buffer.from(String(source).split(",")[1]!, "base64").toString()
    expect(svg).toContain('stroke-dasharray="6 6"')
    expect(svg).toContain('stroke-width="2"')
    expect(svg).toContain('stroke="#ffffff"')
    expect(outline.props.motion).toMatchObject({ initial: false, animate: { color: "#aaa69d" }, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } })
    expect(outline.props.style).toMatchObject({ pointerEvents: "none" })
    expect(app.find("button").props.style).toMatchObject({ borderColor: "transparent" })
    await app.fire("button", "mouseEnter")
    expect(outline.props.src).toBe(source)
    expect(outline.props.motion).toMatchObject({ animate: { color: "#19c8b9" } })
    await app.fire("button", "mouseDown", { button: 0 })
    expect(outline.props.src).toBe(source)
    expect(outline.props.motion).toMatchObject({ animate: { color: "#50b9ab" } })
    await app.fire("button", "mouseUp", { button: 0 })
    expect(outline.props.motion).toMatchObject({ animate: { color: "#19c8b9" } })
    await app.fire("button", "mouseLeave")
    expect(outline.props.src).toBe(source)
    expect(outline.props.motion).toMatchObject({ animate: { color: "#aaa69d" } })
  })

  it("rotates the original Donut counterclockwise over 2.5s and releases its timer", async () => {
    vi.useFakeTimers()
    const loading = ref(true), click = vi.fn()
    const app = mount(defineComponent(() => () => h(Button, { testId: "button", loading: loading.value, onClick: click })))
    const svg = () => Buffer.from(String(app.find("button-loading-icon").props.src).split(",")[1]!, "base64").toString()
    expect(svg()).toContain('rotate(0 24 24)')
    await vi.advanceTimersByTimeAsync(640)
    await app.settle()
    expect(svg()).toContain('rotate(-90 24 24)')
    await app.fire("button", "keyDown", { key: "enter" })
    expect(click).not.toHaveBeenCalled()
    expect(app.find("button").props.style).toMatchObject({ pointerEvents: "none", cursor: "default" })
    loading.value = false
    await app.settle()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("can pin loading artwork without starting an animation timer", () => {
    vi.useFakeTimers()
    const app = mount(defineComponent(() => () => h(ButtonLoadingIcon, { phase: 1250, testId: "donut" })))
    const svg = Buffer.from(String(app.find("donut").props.src).split(",")[1]!, "base64").toString()
    expect(svg).toContain('rotate(-180 24 24)')
    expect(vi.getTimerCount()).toBe(0)
  })
})
