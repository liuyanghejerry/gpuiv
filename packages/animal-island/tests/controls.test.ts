import { defineComponent, h, ref, type Component } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Button } from "../src/components/Button.js"
import type { ButtonType } from "../src/components/Button.js"
import { colors, shadows } from "../src/tokens.js"
import { Checkbox } from "../src/components/Checkbox.js"
import { Input } from "../src/components/Input.js"
import { Radio } from "../src/components/Radio.js"
import { Rate } from "../src/components/Rate.js"
import { Switch } from "../src/components/Switch.js"
import { Tabs } from "../src/components/Tabs.js"
import { Tag } from "../src/components/Tag.js"
import { mountHost } from "./harness.js"

let app: ReturnType<typeof mountHost> | undefined
afterEach(() => { app?.unmount(); app = undefined })
const mount = (component: Component, props: Record<string, unknown> = {}) => {
  app = mountHost(defineComponent({ setup: () => () => h(component, { testId: "control", ...props }) }))
  return app
}

describe("native keyboard control activation", () => {
  it.each([
    ["Button", Button, "button"], ["Switch", Switch, "switch"], ["Tag", Tag, "button"],
  ] as const)("%s accepts native space and Enter", async (_name, component, role) => {
    const listener = vi.fn()
    const host = mount(component, component === Switch ? { onChange: listener } : { onClick: listener })
    const control = host.find((node) => node.props.role === role)
    await host.fire(control, "keyDown", { key: "space" })
    await host.fire(control, "keyDown", { key: "enter" })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("Checkbox toggles through native space and Enter", async () => {
    const change = vi.fn()
    const host = mount(Checkbox, { options: [{ label: "One", value: "one" }], onChange: change })
    const row = host.find((node) => node.props.role === "checkbox")
    await host.fire(row, "keyDown", { key: "space" })
    expect(change).toHaveBeenLastCalledWith(["one"])
    await host.fire(row, "keyDown", { key: "enter" })
    expect(change).toHaveBeenLastCalledWith([])
  })

  it("Radio selects with Space, while repeated activation leaves change silent", async () => {
    const change = vi.fn()
    const host = mount(Radio, { options: [{ label: "One", value: "one" }], onChange: change })
    const row = host.find((node) => node.props.role === "radio")
    await host.fire(row, "keyDown", { key: "space" })
    await host.fire(row, "keyDown", { key: "enter" })
    expect(change).toHaveBeenCalledExactlyOnceWith("one")
  })

  it("Rate keyboard activation chooses the focused star and can clear it", async () => {
    const change = vi.fn()
    const host = mount(Rate, { onChange: change })
    const star = host.find((node) => node.props["aria-label"] === "3 星")
    await host.fire(star, "keyDown", { key: "space" })
    expect(change).toHaveBeenLastCalledWith(3)
    await host.fire(star, "keyDown", { key: "enter" })
    expect(change).toHaveBeenLastCalledWith(0)
  })

  it("Tabs accepts native Space on a tab", async () => {
    const change = vi.fn()
    const host = mount(Tabs, { items: [{ key: "one", label: "One" }, { key: "two", label: "Two" }], onChange: change })
    const tabs = host.all().filter((node) => node.props.role === "tab")
    await host.fire(tabs[1], "keyDown", { key: "space" })
    expect(change).toHaveBeenCalledWith("two")
    expect(host.find((node) => node.props.role === "tab" && node.props["aria-selected"] === true).children.map((node) => node.children.map((child) => child.text).join("")).join(" ")).toContain("Two")
  })

  it("Input clear responds to native Space in clear/update/change order", async () => {
    const order: string[] = []
    const value = ref("Text")
    app = mountHost(defineComponent({ setup: () => () => h(Input, {
      allowClear: true, modelValue: value.value,
      onClear: () => order.push("clear"),
      "onUpdate:modelValue": (next: string) => { value.value = next; order.push("update") },
      onChange: () => { order.push("change"); expect(value.value).toBe("") },
    }) }))
    await app.fire(app.find((node) => node.props.role === "button"), "keyDown", { key: "space" })
    expect(order).toEqual(["clear", "update", "change"])
  })

  it.each([Button, Switch, Tag])("disabled controls ignore native activation", async (component) => {
    const click = vi.fn(), change = vi.fn()
    const host = mount(component, { disabled: true, onClick: click, onChange: change })
    await host.fire("control", "keyDown", { key: "space" })
    await host.fire("control", "keyDown", { key: "enter" })
    expect(click).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled()
  })
})

describe("v-model event order and native decoration contracts", () => {
  const cases = [
    { name: "Checkbox", component: Checkbox, initial: [], next: ["one"], props: { options: [{ label: "One", value: "one" }] }, role: "checkbox", event: "click", payload: {} },
    { name: "Radio", component: Radio, initial: undefined, next: "one", props: { options: [{ label: "One", value: "one" }] }, role: "radio", event: "click", payload: {} },
    { name: "Rate", component: Rate, initial: 0, next: 1, props: {}, role: "radio", event: "click", payload: {} },
    { name: "Switch", component: Switch, initial: false, next: true, props: {}, role: "switch", event: "click", payload: {} },
    { name: "Input", component: Input, initial: "old", next: "new", props: {}, role: undefined, event: "change", payload: { value: "new" } },
    { name: "Tabs", component: Tabs, initial: "two", next: "one", props: { items: [{ key: "one", label: "One" }, { key: "two", label: "Two" }] }, role: "tab", event: "click", payload: {} },
  ]
  it.each(cases)("$name updates the parent model before emitting change", async ({ component, initial, next, props, role, event, payload }) => {
    const value = ref<unknown>(initial), sequence: string[] = []
    app = mountHost(defineComponent({ setup: () => () => h(component, {
      ...props, modelValue: value.value,
      "onUpdate:modelValue": (newValue: unknown) => { value.value = newValue; sequence.push("update") },
      onChange: (newValue: unknown) => { sequence.push("change"); expect(value.value).toEqual(newValue) },
    }) }))
    const target = role ? app.find((node) => node.props.role === role) : app.find((node) => node.type === "input")
    await app.fire(target, event, payload)
    expect(value.value).toEqual(next)
    expect(sequence).toEqual(["update", "change"])
  })

  it("Input forwards the native change payload as the second argument", async () => {
    const change = vi.fn()
    const host = mount(Input, { onChange: change })
    const target = host.find((node) => node.type === "input")
    await host.fire(target, "change", { value: "Hello" })
    expect(change).toHaveBeenCalledWith("Hello", expect.objectContaining({ elementId: target.id, eventType: "change", value: "Hello" }))
  })

  it.each([Checkbox, Radio])("painted check circles leave the row hitbox uncovered", (component) => {
    const host = mount(component, { options: [{ label: "One", value: "one" }] })
    const row = host.find((node) => node.props.role === (component === Checkbox ? "checkbox" : "radio"))
    const circle = row.children.find((node) => node.type === "div")!
    expect(circle.props.style).toMatchObject({ pointerEvents: "none", backgroundColor: "#f7f3df" })
  })

  it("Switch animated handle leaves the track hitbox uncovered", () => {
    const host = mount(Switch)
    const track = host.find("control")
    const handle = track.children.find((node) => (node.props.style as { position?: string } | undefined)?.position === "absolute")!
    expect(handle.props.style).toMatchObject({ pointerEvents: "none", backgroundColor: "#f7f3df" })
  })

  it("Radio keeps a tab stop when the first/selected option is disabled", async () => {
    const options = ref([{ label: "One", value: "one", disabled: true }, { label: "Two", value: "two", disabled: false }, { label: "Three", value: "three", disabled: false }])
    app = mountHost(defineComponent({ setup: () => () => h(Radio, { options: options.value, modelValue: "one" }) }))
    let rows = app.all().filter((node) => node.props.role === "radio")
    expect(rows.map((node) => node.props.tabIndex)).toEqual([-1, 0, -1])
    options.value[1].disabled = true; await app.settle()
    rows = app.all().filter((node) => node.props.role === "radio")
    expect(rows.map((node) => node.props.tabIndex)).toEqual([-1, -1, 0])
    options.value[2].disabled = true; await app.settle()
    expect(app.all().filter((node) => node.props.role === "radio").map((node) => node.props.tabIndex)).toEqual([-1, -1, -1])
  })

  it("disabled native Input opts out of Tab and remains readOnly", () => {
    const host = mount(Input, { disabled: true, type: "password" })
    const target = host.find((node) => node.type === "input")
    expect(target.props).toMatchObject({ tabIndex: -1, readOnly: true, type: "password", placeholderColor: colors.textDisabled })
  })

  it("Input passes custom placeholder ink to the native editor", () => {
    const host = mount(Input, { placeholderColor: "#123456" })
    expect(host.find((node) => node.type === "input").props).toMatchObject({ type: "text", placeholderColor: "#123456" })
  })
})

describe("Button variants follow the original Less cascade", () => {
  const variants: ButtonType[] = ["default", "dashed", "primary", "text", "link"]
  const combinations = variants.flatMap((type) => [false, true].flatMap((danger) => [false, true].map((ghost) => ({ type, danger, ghost }))))
  it.each(combinations)("$type danger=$danger ghost=$ghost preserves idle/hover/active styling", async ({ type, danger, ghost }) => {
    const host = mount(Button, { type, danger, ghost })
    const c = colors
    // Motion owns sampled colors/shadows. Only non-animated pseudo styles
    // such as link opacity remain in GPUI's hover/active refinement.
    const appearance = (hovered = false, pressed = false) => {
      const node = host.find("control"), style = node.props.style as Record<string, unknown>
      const motion = node.props.motion as { animate: Record<string, unknown> }
      return { ...style, ...(hovered ? style.hover as object : {}), ...(pressed ? style.active as object : {}), ...motion.animate }
    }
    const nativeBorder = (ink: string) => type === "dashed" ? "transparent" : ink
    const rest = type === "primary" ? {
      color: ghost ? c.primary : danger ? "#ffffff" : c.warm,
      backgroundColor: ghost ? "transparent" : danger ? c.error : c.cream,
      borderColor: danger ? c.error : c.cream,
      boxShadow: ghost ? [] : danger ? shadows.hardError : shadows.hard,
    } : type === "default" || type === "dashed" ? {
      color: danger ? c.error : c.text, backgroundColor: ghost ? "transparent" : c.bg,
      borderColor: nativeBorder(danger ? c.error : c.border), boxShadow: ghost ? [] : shadows.sm,
    } : {
      color: danger ? "#ffffff" : type === "text" ? c.text : c.primary,
      backgroundColor: "transparent", borderColor: "transparent", boxShadow: [],
    }
    const over = type === "primary" ? {
      color: ghost ? c.primaryHover : danger ? "#ffffff" : c.warm,
      backgroundColor: ghost ? "rgba(25, 200, 185, 0.08)" : danger ? c.errorHover : c.cream,
      borderColor: ghost ? c.primaryHover : danger ? c.errorHover : c.cream,
      boxShadow: danger ? shadows.hardErrorHover : shadows.hardHover,
    } : type === "default" || type === "dashed" ? {
      color: danger ? c.error : c.primary,
      backgroundColor: ghost ? "transparent" : c.bg,
      borderColor: nativeBorder(danger ? c.errorHover : c.primary),
      boxShadow: type === "default" ? shadows.base : ghost ? [] : shadows.sm,
    } : type === "text" ? { ...rest, backgroundColor: c.bgSecondary }
      : { ...rest, color: danger ? "#ffffff" : c.primaryHover, opacity: 0.85 }
    const down = type === "primary" ? {
      ...over,
      // .btn-ghost.btn-primary:hover is declared after, and has the same
      // specificity as, .btn-danger.btn-primary:active. A pointer press keeps
      // the ghost hover fill/border while retaining the danger active shadow.
      backgroundColor: ghost ? "rgba(25, 200, 185, 0.08)" : danger ? c.errorActive : c.cream,
      borderColor: ghost ? c.primaryHover : danger ? c.errorActive : c.cream,
      boxShadow: danger ? shadows.hardErrorActive : shadows.hardActive,
    } : type === "default" || type === "dashed" ? {
      ...over, color: danger ? c.error : c.primaryActive,
      borderColor: nativeBorder(danger ? c.errorActive : c.primaryActive),
      boxShadow: type === "default" || !ghost ? shadows.sm : [],
    } : type === "text" ? { ...over, backgroundColor: "#e9ddc6" }
      : { ...over, color: danger ? "#ffffff" : c.primaryActive }
    expect(appearance()).toMatchObject(rest)
    expect(host.find("control").props.style).toMatchObject({ height: 45, paddingLeft: 20, paddingRight: 20, borderWidth: 2 })
    await host.settle()
    const outline = type === "dashed" ? host.find(node => node.type === "svg") : null
    const source = outline?.props.src
    if (outline) {
      const svg = Buffer.from(String(source).split(",")[1], "base64").toString()
      expect(svg).toContain('stroke="#ffffff"')
      expect(svg).toContain('stroke-width="2"')
      expect(svg).toContain('stroke-dasharray="6 6"')
      expect(outline.props.motion).toMatchObject({ animate: { color: danger ? c.error : c.border } })
      expect(outline.props.style).toMatchObject({ pointerEvents: "none" })
    }
    await host.fire("control", "mouseEnter")
    expect(appearance(true)).toMatchObject(over)
    if (outline) {
      expect(outline.props.src).toBe(source)
      expect(outline.props.motion).toMatchObject({ animate: { color: danger ? c.errorHover : c.primary } })
    }
    await host.fire("control", "mouseDown", { button: 0 })
    expect(appearance(true, true)).toMatchObject(down)
    if (outline) {
      expect(outline.props.src).toBe(source)
      expect(outline.props.motion).toMatchObject({ animate: { color: danger ? c.errorActive : c.primaryActive } })
    }
    await host.fire("control", "mouseUp", { button: 0 })
    expect(appearance(true)).toMatchObject(over)
    await host.fire("control", "mouseLeave")
    expect(appearance()).toMatchObject(rest)
    if (outline) {
      expect(outline.props.src).toBe(source)
      expect(outline.props.motion).toMatchObject({ animate: { color: danger ? c.error : c.border } })
    }
    if (type === "primary" && danger && ghost) {
      // Keyboard activation away from the pointer has no ghost :hover rule.
      // It must still reach danger :active, rather than freezing the hover
      // palette globally to accommodate the pointer cascade above.
      await host.fire("control", "keyDown", { key: "space" })
      expect(appearance(false, true)).toMatchObject({
        color: c.primary, backgroundColor: c.errorActive, borderColor: c.errorActive,
        boxShadow: shadows.hardErrorActive,
      })
      await host.fire("control", "keyUp", { key: "space" })
      expect(appearance()).toMatchObject(rest)
    }
    expect(host.find("control").props.motion).toMatchObject({ initial: false, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } })
  })

  it.each(variants)("loading $type overrides all modifiers and retains native sizes", async (type) => {
    const click = vi.fn()
    const host = mount(Button, { type, danger: true, ghost: true, loading: true, size: "large", block: true, onClick: click })
    const style = host.find("control").props.style as Record<string, unknown>
    expect(style).toMatchObject({ backgroundColor: "#0ec4b6", borderColor: "#4de2da", borderWidth: 4, color: "#ffffff", height: 48, fontSize: 16, paddingLeft: 32, paddingRight: 32, width: "100%", pointerEvents: "none" })
    expect(style.boxShadow).toBeUndefined(); expect(style.hover).toBeUndefined(); expect(style.active).toBeUndefined()
    await host.fire("control", "keyDown", { key: "space" })
    expect(click).not.toHaveBeenCalled()
  })

  it.each(variants)("disabled $type cannot acquire interactive hover/active styling", (type) => {
    const host = mount(Button, { type, danger: true, ghost: true, disabled: true })
    const node = host.find("control"), style = node.props.style as Record<string, unknown>
    expect(node.props.tabIndex).toBe(-1)
    expect(style.opacity).toBe(0.5)
    expect(style.hover).toBeUndefined(); expect(style.active).toBeUndefined(); expect(style.boxShadow).toBeUndefined()
  })
})
