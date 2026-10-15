import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, ref } from "vue"
import type { HostNode, MotionStyle, MotionTransition } from "@gpuiv/vue"
import { Input } from "../src/components/Input.js"
import { Switch } from "../src/components/Switch.js"
import { Checkbox } from "../src/components/Checkbox.js"
import { Radio } from "../src/components/Radio.js"
import { Select } from "../src/components/Select.js"
import { DatePicker } from "../src/components/DatePicker.js"
import { TimePicker } from "../src/components/TimePicker.js"
import { colors, ease } from "../src/tokens.js"
import { mountHost } from "./harness.js"

const hosts: ReturnType<typeof mountHost>[] = []
afterEach(() => hosts.splice(0).forEach(host => host.unmount()))
const mount = (render: () => ReturnType<typeof h>) => {
  const host = mountHost(defineComponent(() => render)); hosts.push(host); return host
}
const motion = (node: HostNode) => node.props.motion as { initial: boolean; animate: MotionStyle; transition: MotionTransition }

describe("native form color and shadow transition targets", () => {
  it("transitions Input status/disabled surfaces and keeps clear activation order", async () => {
    const status = ref<"error" | undefined>(undefined), disabled = ref(false), order: string[] = []
    const host = mount(() => h(Input, { testId: "input", shadow: true, status: status.value, disabled: disabled.value, defaultValue: "Island", allowClear: true,
      onClear: () => order.push("clear"), onChange: () => order.push("change") }))
    expect(motion(host.find("input"))).toMatchObject({ initial: false, animate: { boxShadow: { color: colors.shadowSoft } }, transition: { duration: 0.25, ease } })
    await host.fire("input", "mouseEnter")
    expect(motion(host.find("input")).animate.boxShadow).toMatchObject({ color: colors.shadowSoftHover })
    const clear = host.find(node => node.props.role === "button")
    expect(motion(clear).transition).toEqual({ duration: 0.15, ease: "ease" })
    await host.fire(clear, "mouseEnter")
    expect(motion(clear).animate).toMatchObject({ color: colors.warmSoft, backgroundColor: "rgba(114, 93, 66, 0.1)" })
    await host.fire(clear, "keyDown", { key: "space" })
    expect(order).toEqual(["clear", "change"])
    status.value = "error"; await host.settle()
    expect(motion(host.find("input")).animate.boxShadow).toMatchObject({ color: colors.errorActive })
    disabled.value = true; await host.settle()
    expect(motion(host.find("input")).animate).toMatchObject({ backgroundColor: "#ece8dc", boxShadow: [] })
    expect(host.find(node => node.type === "input").props.readOnly).toBe(true)
  })

  it("interpolates Switch track/handle colors and inset shadows alongside its slide", async () => {
    const checked = ref(false), change = vi.fn()
    const host = mount(() => h(Switch, { testId: "switch", checked: checked.value, onChange: change }))
    const handle = () => host.find("switch").children.find(node => (node.props.style as { position?: string })?.position === "absolute")!
    expect(motion(handle()).animate).toMatchObject({ left: 2, backgroundColor: "#f7f3df", borderColor: colors.shadowSoftHover })
    checked.value = true; await host.settle()
    expect(motion(handle()).animate).toMatchObject({ left: 24, borderColor: colors.success })
    expect(motion(host.find("switch")).animate).toMatchObject({ backgroundColor: "#86d67a", borderColor: colors.success, boxShadow: { inset: true, color: "rgba(90, 158, 30, 0.2)" } })
    await host.fire("switch", "mouseEnter")
    expect(motion(host.find("switch")).animate).toMatchObject({ backgroundColor: "#7ccc70", borderColor: colors.successActive })
    await host.fire("switch", "keyDown", { key: "space" })
    expect(change).toHaveBeenCalledExactlyOnceWith(false)
    expect(host.find("switch").props["aria-checked"]).toBe(true)
  })

  it.each([Checkbox, Radio])("keeps selection fill/splash while animating border .25s and label .15s", async component => {
    const host = mount(() => h(component, { testId: "group", options: [{ label: "Apple", value: "apple" }, { label: "Pear", value: "pear" }] }))
    const role = component === Checkbox ? "checkbox" : "radio"
    const row = host.find(node => node.props.role === role)
    const circle = () => row.children.find(node => (node.props.style as { borderWidth?: number })?.borderWidth === 2)!
    expect(motion(row).transition).toEqual({ duration: 0.15, ease: "ease" })
    expect(motion(circle())).toMatchObject({ animate: { borderColor: colors.textDisabled }, transition: { duration: 0.25, ease } })
    expect(Object.keys(motion(circle()).animate)).toEqual(["borderColor"])
    await host.fire(row, "keyDown", { key: "space" })
    expect(motion(row).animate.color).toBe(colors.text)
    expect(motion(circle()).animate.borderColor).toBe(colors.primaryActive)
    expect(circle().props.style).toMatchObject({ backgroundColor: colors.primary, pointerEvents: "none" })
    expect(host.all().some(node => node.props.testId === "group-splash-apple")).toBe(true)
    if (component === Radio) {
      await host.fire(row, "keyDown", { key: "down" })
      const next = host.find(node => node.props.role === "radio" && node.props["aria-label"] === "Pear")
      expect(host.native.getFocusedElementId?.()).toBe(next.id)
      expect(next.props["aria-checked"]).toBe(true)
    }
  })

  it.each([false, true])("preserves Select native refs while animating trigger and clear (search=%s)", async showSearch => {
    const change = vi.fn(), onClear = vi.fn()
    const host = mount(() => h(Select, { testId: "select", defaultValue: "apple", options: [{ key: "apple", label: "Apple" }], allowClear: true, showSearch, onChange: change, onClear }))
    const trigger = host.find("select")
    const surface = showSearch ? trigger.parent! : trigger
    expect(motion(surface).transition).toEqual({ duration: 0.2, ease: "ease" })
    await host.fire(surface, "mouseEnter")
    expect(motion(surface).animate).toMatchObject({ backgroundColor: "#fffdf7", borderColor: "#d4c4a8" })
    const clear = host.find("select-clear")
    expect(motion(clear).transition).toEqual({ duration: 0.15, ease })
    await host.fire(clear, "mouseEnter")
    expect(motion(clear).animate).toMatchObject({ color: colors.warmSoft, backgroundColor: "rgba(114, 93, 66, 0.1)" })
    await host.fire(clear, "keyDown", { key: "enter" })
    expect(change).toHaveBeenCalledExactlyOnceWith("")
    expect(onClear).toHaveBeenCalledExactlyOnceWith()
    expect(host.native.getFocusedElementId?.()).toBe(trigger.id)
  })

  it.each([DatePicker, TimePicker])("retains picker focus/outside dismissal and animates both open shadow layers", async component => {
    const defaultValue = component === DatePicker ? "2024-01-15" : "12:30:00"
    const host = mount(() => h(component, { testId: "picker", defaultValue, allowClear: true }))
    const trigger = host.find("picker")
    expect(motion(trigger).transition).toEqual({ duration: 0.2, ease })
    await host.fire(trigger, "mouseEnter")
    expect(motion(trigger).animate.boxShadow).toMatchObject({ color: colors.shadowSoftHover })
    await host.fire(trigger, "click")
    expect(motion(trigger).animate.boxShadow).toEqual([
      { offsetX: 0, offsetY: 3, blurRadius: 0, spreadRadius: 0, color: "#e0b800" },
      { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: 3, color: "rgba(255, 204, 0, 0.15)" },
    ])
    const target = host.find(component === DatePicker ? "picker-day-0-2024-01-20" : "picker-m-31")
    expect(motion(target).transition).toEqual({ duration: 0.15, ease: "ease" })
    await host.fire(target, "mouseEnter")
    expect(motion(target).animate.backgroundColor).toBe(component === DatePicker ? colors.primaryBg : "#ffd54f")
    const confirm = host.find("picker-confirm")
    expect(motion(confirm).transition).toEqual({ duration: 0.15, ease: "ease" })
    await host.fire("picker-panel", "keyDown", { key: "escape" })
    expect(host.native.getFocusedElementId?.()).toBe(trigger.id)
    expect(host.all().some(node => node.props.testId === "picker-panel")).toBe(false)
  })

  it("keeps Select clear mounted when its painted hitbox takes hover and focus from the input", async () => {
    const change = vi.fn()
    const host = mount(() => h(Select, { testId: "select", defaultValue: "apple", allowClear: true, showSearch: true,
      options: [{ key: "apple", label: "Apple" }], onChange: change }))
    const input = host.find("select"), surface = input.parent!
    await host.fire(input, "focus")
    const clear = host.find("select-clear")
    await host.fire(clear, "mouseEnter")
    await host.fire(surface, "mouseLeave")
    await host.fire(input, "blur")
    expect(host.find("select-clear").id).toBe(clear.id)
    await host.fire(clear, "focus")
    await host.fire(clear, "mouseLeave")
    expect(host.find("select-clear").id).toBe(clear.id)
    await host.fire(clear, "mouseDown", { button: 0 })
    await host.fire(clear, "mouseUp", { button: 0 })
    await host.fire(clear, "click")
    expect(change).toHaveBeenCalledExactlyOnceWith("")
    expect(host.all().some(node => node.props.testId === "select-clear")).toBe(false)
    expect(host.native.getFocusedElementId?.()).toBe(input.id)
  })
})
