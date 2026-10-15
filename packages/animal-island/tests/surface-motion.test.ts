import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, ref, shallowRef, type VNodeRef } from "vue"
import type { BoxShadow, EventPayload, HostNode, MotionProps, StyleDesc } from "@gpuiv/vue"
import { ColorSurface, surfaceMotion } from "../src/components/surface-motion.js"
import { Button } from "../src/components/Button.js"
import { Input } from "../src/components/Input.js"
import { mountHost } from "./harness.js"

const hosts: ReturnType<typeof mountHost>[] = []
const mount = (render: () => ReturnType<typeof h>) => {
  const app = mountHost(defineComponent({ setup: () => render }))
  hosts.push(app)
  return app
}
afterEach(() => { hosts.splice(0).forEach(app => app.unmount()); vi.useRealTimers() })
const shadow: BoxShadow = { offsetX: 0, offsetY: 4, blurRadius: 8, spreadRadius: 0, color: "#00000040" }
const paint = (app: ReturnType<typeof mountHost>, id = "surface") => (app.find(id).props.motion as MotionProps).animate

const interactive: StyleDesc = {
  color: "#111111", backgroundColor: "#ffffff", borderColor: "#222222",
  hover: { color: "#00ff00", backgroundColor: "#ff0000", borderColor: "#444444", boxShadow: shadow, cursor: "pointer" },
  active: { color: "#0000ff", backgroundColor: "#ffff00", borderColor: "#666666", boxShadow: { ...shadow, offsetY: 1 } },
}

describe("native color surfaces", () => {
  it("resolves hover/active precedence and restores the base targets on release/leave", async () => {
    const app = mount(() => h(ColorSurface, { testId: "surface", role: "button", style: interactive }))
    expect(paint(app)).toEqual({ color: "#111111", backgroundColor: "#ffffff", borderColor: "#222222", boxShadow: [] })
    expect(app.find("surface").props.style).toMatchObject({ hover: { cursor: "pointer" } })
    for (const state of [(app.find("surface").props.style as StyleDesc).hover!, (app.find("surface").props.style as StyleDesc).active!]) {
      for (const key of ["color", "backgroundColor", "borderColor", "boxShadow"]) expect(state).not.toHaveProperty(key)
    }
    await app.fire("surface", "mouseEnter")
    expect(paint(app)).toMatchObject({ color: "#00ff00", backgroundColor: "#ff0000", boxShadow: shadow })
    await app.fire("surface", "mouseDown", { button: 0 })
    expect(paint(app)).toMatchObject({ color: "#0000ff", backgroundColor: "#ffff00", boxShadow: { ...shadow, offsetY: 1 } })
    await app.fire("surface", "mouseUp")
    expect(paint(app)).toMatchObject({ color: "#00ff00", backgroundColor: "#ff0000", boxShadow: shadow })
    await app.fire("surface", "mouseDown", { button: 0 })
    await app.fire("surface", "mouseLeave")
    expect(paint(app)).toMatchObject({ color: "#111111", backgroundColor: "#ffffff", boxShadow: [] })
    await app.fire("surface", "mouseDown", { button: 2 })
    expect(paint(app).backgroundColor).toBe("#ffffff")
  })


  it.each([
    ["opacity", 1, 0.85],
    ["borderRadius", 0, 30],
  ] as const)("restores the native %s default after an opted-in hover ends", async (key, base, hovered) => {
    const app = mount(() => h(ColorSurface, {
      testId: "surface", geometry: [key], style: { hover: { [key]: hovered } },
    }))
    expect(paint(app)[key]).toBe(base)
    expect((app.find("surface").props.style as StyleDesc).hover).not.toHaveProperty(key)
    await app.fire("surface", "mouseEnter")
    expect(paint(app)[key]).toBe(hovered)
    await app.fire("surface", "mouseLeave")
    expect(paint(app)[key]).toBe(base)
  })

  it("transitions an opted-in explicit width and leaves other native pseudo geometry untouched", async () => {
    const style: StyleDesc = { width: 10, height: 8,
      hover: { width: 24, height: 12, opacity: 0.85, borderRadius: 30 },
      active: { width: 32, height: 14 },
    }
    const app = mount(() => h(ColorSurface, { testId: "surface", geometry: ["width"], style }))
    expect(paint(app).width).toBe(10)
    const native = app.find("surface").props.style as StyleDesc
    expect(native).toMatchObject({ width: 10, height: 8, hover: { height: 12, opacity: 0.85, borderRadius: 30 }, active: { height: 14 } })
    expect(native.hover).not.toHaveProperty("width")
    expect(native.active).not.toHaveProperty("width")
    expect(paint(app).height).toBeUndefined()
    expect(paint(app).opacity).toBeUndefined()
    expect(paint(app).borderRadius).toBeUndefined()
    await app.fire("surface", "mouseEnter")
    expect(paint(app).width).toBe(24)
    await app.fire("surface", "mouseDown", { button: 0 })
    expect(paint(app).width).toBe(32)
    await app.fire("surface", "mouseUp")
    expect(paint(app).width).toBe(24)
    await app.fire("surface", "mouseLeave")
    expect(paint(app).width).toBe(10)
    expect(style.hover?.width).toBe(24)
    expect(style.active?.width).toBe(32)
  })

  it("keeps geometry entirely native unless each field opts into motion", async () => {
    const style: StyleDesc = { width: 10, height: 8, opacity: 0.9, borderRadius: 2,
      hover: { width: 24, height: 12, opacity: 0.85, borderRadius: 30 },
    }
    const app = mount(() => h(ColorSurface, { testId: "surface", style }))
    for (const key of ["width", "height", "opacity", "borderRadius"] as const) expect(paint(app)[key]).toBeUndefined()
    expect(app.find("surface").props.style).toMatchObject(style)
    await app.fire("surface", "mouseEnter")
    for (const key of ["width", "height", "opacity", "borderRadius"] as const) expect(paint(app)[key]).toBeUndefined()
    expect(app.find("surface").props.style).toMatchObject(style)
    await app.fire("surface", "mouseLeave")
    expect(app.find("surface").props.style).toMatchObject(style)
    // An automatic or unit-based width has no numeric native starting value;
    // opting it in must also preserve GPUI's authored sizing and hover rule.
    const automatic = surfaceMotion({ width: "100%", hover: { width: 24 } }, { hovered: true }, ["width"])
    expect(automatic.animate.width).toBeUndefined()
    expect(automatic.style).toMatchObject({ width: "100%", hover: { width: 24 } })
  })

  it("releases removed paint styles and clears missing shadow stacks without retaining old targets", async () => {
    const style = ref<StyleDesc>({ backgroundColor: "red", color: "blue", borderColor: "green", boxShadow: shadow })
    const app = mount(() => h(ColorSurface, { testId: "surface", style: style.value }))
    expect(paint(app)).toEqual({ backgroundColor: "red", color: "blue", borderColor: "green", boxShadow: shadow })
    style.value = {}
    await app.settle()
    expect(paint(app)).toEqual({ backgroundColor: null, color: null, borderColor: null, boxShadow: [] })
    expect(app.find("surface").props.style).not.toHaveProperty("color")
  })

  it("preserves the native backgroundColor precedence over a background alias", () => {
    const surface = surfaceMotion({ background: "red", backgroundColor: "blue", hover: { background: "yellow", backgroundColor: "green" } }, { hovered: true })
    expect(surface.animate.backgroundColor).toBe("green")
    expect(surface.style.backgroundColor).toBe("blue")
    expect(surface.style.background).toBeUndefined()
  })

  it("keeps gradient and inherited colors under normal native style resolution", () => {
    const gradient: NonNullable<StyleDesc["background"]> = { type: "linear-gradient", angle: 90, stops: [{ color: "red", position: 0 }, { color: "blue", position: 1 }] }
    const inherited = surfaceMotion({ background: gradient, hover: { backgroundColor: "green", color: "orange" } }, { hovered: true })
    expect(inherited.animate.backgroundColor).toBeNull()
    expect(inherited.animate.color).toBeNull()
    expect(inherited.style.background).toEqual(gradient)
    expect(inherited.style.hover).toMatchObject({ backgroundColor: "green", color: "orange" })
    const overridden = surfaceMotion({ background: gradient, backgroundColor: "red", hover: { backgroundColor: "blue" } }, { hovered: true })
    expect(overridden.animate.backgroundColor).toBe("blue")
  })

  it.each(["aria", "pointer"] as const)("cancels stale hover/press when disabled via %s and re-enabled", async mode => {
    const disabled = ref(false)
    const app = mount(() => h(ColorSurface, { testId: "surface", role: "button", "aria-disabled": mode === "aria" ? disabled.value : undefined,
      style: { ...interactive, ...(mode === "pointer" && disabled.value ? { pointerEvents: "none" } : {}) } }))
    await app.fire("surface", "mouseEnter")
    await app.fire("surface", "mouseDown", { button: 0 })
    expect(paint(app).backgroundColor).toBe("#ffff00")
    disabled.value = true
    await app.settle()
    expect(paint(app).backgroundColor).toBe("#ffffff")
    disabled.value = false
    await app.settle()
    expect(paint(app).backgroundColor).toBe("#ffffff")
    await app.fire("surface", "mouseEnter")
    expect(paint(app).backgroundColor).toBe("#ff0000")
  })

  it("forwards object and callback refs to the real native HostNode", async () => {
    const node = shallowRef<HostNode | null>(null), callback = vi.fn()
    const app = mount(() => h("div", [h(ColorSurface, { testId: "surface", hostRef: node as VNodeRef }), h(ColorSurface, { testId: "callback", hostRef: callback })]))
    expect(node.value).toBe(app.find("surface"))
    expect(node.value?.type).toBe("div")
    expect(typeof node.value?.id).toBe("number")
    expect(callback.mock.calls[0]?.[0] === app.find("callback")).toBe(true)
    app.unmount(); hosts.pop()
    expect(node.value).toBeNull()
    expect(callback.mock.calls.at(-1)?.[0]).toBeNull()
  })

  it("composes every user pointer/key/focus callback without adding activation", async () => {
    const calls: Array<[string, EventPayload]> = []
    const record = (name: string) => (event: EventPayload) => calls.push([name, event])
    const app = mount(() => h(ColorSurface, { testId: "surface", role: "button", style: interactive,
      onMouseEnter: [record("enter-first"), record("enter-second")], onMouseLeave: record("leave"), onMouseDown: record("down"), onMouseUp: record("up"),
      onFocus: record("focus"), onBlur: record("blur"), onKeyDown: record("key-down"), onKeyUp: record("key-up"), onClick: record("click"),
    }))
    for (const event of ["mouseEnter", "mouseDown", "mouseUp", "mouseLeave", "focus"] as const) await app.fire("surface", event, { key: "enter", button: 0 })
    await app.fire("surface", "keyDown", { key: "enter" })
    expect(paint(app).backgroundColor).toBe("#ffff00")
    await app.fire("surface", "keyUp", { key: "enter" })
    expect(paint(app).backgroundColor).toBe("#ffffff")
    await app.fire("surface", "keyDown", { key: "space" })
    await app.fire("surface", "blur")
    expect(paint(app).backgroundColor).toBe("#ffffff")
    await app.fire("surface", "click")
    expect(calls.map(([name]) => name)).toEqual(["enter-first", "enter-second", "down", "up", "leave", "focus", "key-down", "key-up", "key-down", "blur", "click"])
    expect(calls[0]![1]).toBe(calls[1]![1])
    expect(calls[2]![1].button).toBe(0)
    expect(calls[6]![1].key).toBe("enter")
  })

  it("does not install keyboard/blur listeners on input wrappers or move native focus", async () => {
    const focused = vi.fn(), keyDown = vi.fn(), keyUp = vi.fn(), changed = vi.fn()
    const app = mount(() => h(Input, { testId: "input", defaultValue: "hello", onFocus: focused, onKeyDown: keyDown, onKeyUp: keyUp, onChange: changed }))
    const input = app.find(node => node.type === "input")
    expect(input.type).toBe("input")
    const wrapper = input.parent!
    expect(wrapper.props.motion).toBeDefined()
    expect(wrapper.props.onKeyDown).toBeUndefined()
    expect(wrapper.props.onKeyUp).toBeUndefined()
    expect(wrapper.props.onBlur).toBeUndefined()
    app.native.focusElement!(input.id!)
    await app.fire(input, "focus")
    await app.fire(input, "keyDown", { key: "space" })
    await app.fire(input, "keyUp", { key: "space" })
    await app.fire(input, "change", { value: "hello world" })
    expect(app.native.getFocusedElementId!()).toBe(input.id)
    expect(focused).toHaveBeenCalledOnce()
    expect(keyDown).toHaveBeenCalledOnce()
    expect(keyUp).toHaveBeenCalledOnce()
    expect(changed).toHaveBeenLastCalledWith("hello world", expect.objectContaining({ value: "hello world" }))
  })

  it("preserves explicit native motion targets and transition while adding surface paints", () => {
    const prior = { initial: { top: 4 }, animate: { top: 0, color: "purple" }, generation: 42, transition: { duration: 0.4, ease: "linear" } }
    const app = mount(() => h(ColorSurface, { testId: "surface", style: interactive, motion: prior, transition: { duration: 0.1 } }))
    expect(app.find("surface").props.motion).toMatchObject({ initial: { top: 4 }, animate: { top: 0, color: "purple", backgroundColor: "#ffffff" }, generation: 42, transition: prior.transition })
  })

  it("uses no JavaScript animation timers during pointer interactions or idle frames", async () => {
    vi.useFakeTimers()
    const app = mount(() => h("div", [h(ColorSurface, { testId: "surface", role: "button", style: interactive }), h(Button, { testId: "button" }, { default: () => "Button" })]))
    for (const id of ["surface", "button"]) {
      for (const event of ["mouseEnter", "mouseDown", "mouseUp", "mouseLeave"]) await app.fire(id, event, { button: 0 })
    }
    expect(vi.getTimerCount()).toBe(0)
    const writes = app.operations.length
    await vi.advanceTimersByTimeAsync(10_000)
    await app.settle()
    expect(app.operations).toHaveLength(writes)
    app.unmount(); hosts.pop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
