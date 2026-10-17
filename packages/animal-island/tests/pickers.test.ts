import { defineComponent, h, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { StyleDesc } from "@gpuiv/vue"
import { DatePicker, type DatePickerValue } from "../src/components/DatePicker.js"
import { TimePicker } from "../src/components/TimePicker.js"
import { mountHost } from "./harness.js"

let app: ReturnType<typeof mountHost> | undefined
afterEach(() => { app?.unmount(); app = undefined })
function mount(component: typeof DatePicker | typeof TimePicker, props: Record<string, unknown> = {}) {
  const change = vi.fn(), update = vi.fn(), open = vi.fn(), openUpdate = vi.fn()
  app = mountHost(defineComponent({ setup: () => () => h(component, {
    testId: "picker", onChange: change, "onUpdate:modelValue": update,
    onOpenChange: open, "onUpdate:open": openUpdate, ...props,
  }) }))
  return { app, change, update, open, openUpdate }
}

describe("DatePicker through the native mutation/event host", () => {
  it("opens a deferred popup and previews a date until confirmation", async () => {
    const result = mount(DatePicker, { defaultValue: "2024-01-15", allowClear: true })
    expect(result.app.text()).toContain("2024-01-15")
    await result.app.fire("picker", "click")
    expect(result.open).toHaveBeenCalledWith(true)
    const anchor = result.app.find((node) => node.type === "anchored")
    expect(anchor.props).toMatchObject({ deferred: true, fit: "snap", side: "bottom", gap: 6 })
    expect(result.app.all().filter((node) => String(node.props.testId ?? "").startsWith("picker-day-"))).toHaveLength(42)
    await result.app.fire("picker-day-0-2024-01-20", "click")
    expect(result.app.text()).toContain("2024-01-20")
    expect(result.change).not.toHaveBeenCalled()
    await result.app.fire("picker-confirm", "click")
    expect(result.change).toHaveBeenCalledExactlyOnceWith("2024-01-20")
    expect(result.update).toHaveBeenCalledExactlyOnceWith("2024-01-20")
    expect(result.openUpdate).toHaveBeenLastCalledWith(false)
    expect(result.app.all().some((node) => node.props.testId === "picker-panel")).toBe(false)
    expect(result.app.text()).toContain("2024-01-20")
  })

  it("controlled values retain parent ownership and follow later prop changes", async () => {
    const value = ref<DatePickerValue>("2024-01-15"), update = vi.fn()
    app = mountHost(defineComponent({ setup: () => () => h(DatePicker, { testId: "picker", modelValue: value.value, "onUpdate:modelValue": update }) }))
    await app.fire("picker", "click")
    await app.fire("picker-day-0-2024-01-20", "click")
    await app.fire("picker-confirm", "click")
    expect(update).toHaveBeenCalledWith("2024-01-20")
    expect(app.text()).toContain("2024-01-15")
    value.value = "2024-02-10"; await app.settle()
    expect(app.text()).toContain("2024-02-10")
    await app.fire("picker", "click")
    expect(app.text()).toContain("2024年2月")
  })

  it("selects adjacent-month ranges, supports reverse starts and resets on reopen", async () => {
    const range = ref<DatePickerValue>(["2024-01-01", "2024-01-31"])
    const change = vi.fn()
    app = mountHost(defineComponent({ setup: () => () => h(DatePicker, {
      testId: "picker", range: true, modelValue: range.value, onChange: change,
      "onUpdate:modelValue": (next: DatePickerValue) => { range.value = next },
    }) }))
    await app.fire("picker", "click")
    expect(app.text()).toContain("2024年1月")
    expect(app.text()).toContain("2024年2月")
    await app.fire("picker-day-0-2024-01-20", "click")
    await app.fire("picker-day-0-2024-01-10", "click")
    await app.fire("picker-day-1-2024-02-05", "click")
    expect(change).not.toHaveBeenCalled()
    await app.fire("picker-confirm", "click")
    expect(range.value).toEqual(["2024-01-10", "2024-02-05"])
    await app.fire("picker", "click")
    await app.fire("picker-day-1-2024-02-10", "click")
    await app.fire("picker-day-1-2024-02-15", "click")
    await app.fire("picker-confirm", "click")
    expect(range.value).toEqual(["2024-02-10", "2024-02-15"])
    await app.fire("picker", "click")
    expect(app.text()).toContain("2024年2月")
    expect(app.text()).toContain("2024年3月")
  })

  it("keeps range-preview hover on stable cells instead of re-styling the whole grid", async () => {
    const result = mount(DatePicker, { range: true, defaultValue: ["2024-01-10", "2024-01-20"] })
    await result.app.fire("picker", "click")
    const day = (key: string) => result.app.find(`picker-day-0-${key}`)
    const outside = day("2024-01-05"), inside = day("2024-01-22")
    const outsideStyle = outside.props.style, insideStyle = inside.props.style
    expect(outside.type).toBe("div")
    expect(outside.props.motion).toBeUndefined()
    await result.app.fire("picker-day-0-2024-01-10", "click")
    result.app.operations.length = 0
    await result.app.fire("picker-day-0-2024-01-25", "mouseEnter")
    // Only the cells whose range state changed receive a new style object.
    expect(day("2024-01-05").props.style).toBe(outsideStyle)
    expect(day("2024-01-22").props.style).not.toBe(insideStyle)
    const dayIds = new Set(result.app.all().filter(node => String(node.props.testId ?? "").startsWith("picker-day-")).map(node => node.id))
    const styleOps = result.app.operations.filter(operation => operation[0] === "setStyle" && dayIds.has(operation[1]))
    expect(styleOps.length).toBeGreaterThan(0)
    expect(styleOps.length).toBeLessThan(30)
    // Moving to another cell extends the same range without an intermediate
    // empty preview: the previous endpoint becomes in-range, not cleared.
    await result.app.fire("picker-day-0-2024-01-28", "mouseEnter")
    const inRange = (key: string) => ((day(key).props.style as StyleDesc).backgroundColor)
    expect(inRange("2024-01-26")).toBe("#ffc107")
    expect(inRange("2024-01-28")).toBe("#ffc107")
    expect(inRange("2024-01-29")).toBeUndefined()
  })

  it("does not commit an incomplete range or a disabled date", async () => {
    const result = mount(DatePicker, { defaultValue: ["2024-01-01", "2024-01-31"], range: true, disabledDate: (date: Date) => date.getDate() === 15 })
    await result.app.fire("picker", "click")
    await result.app.fire("picker-day-0-2024-01-15", "click")
    await result.app.fire("picker-day-0-2024-01-10", "click")
    await result.app.fire("picker-confirm", "click")
    expect(result.change).not.toHaveBeenCalled()
  })

  it("month picker opens directly on months and commits YYYY-MM using custom format", async () => {
    const result = mount(DatePicker, { picker: "month", defaultValue: "2024-01", format: "YYYY年M月" })
    expect(result.app.text()).toContain("2024年1月")
    await result.app.fire("picker", "click")
    expect(result.app.all().filter((node) => String(node.props.testId ?? "").startsWith("picker-month-"))).toHaveLength(12)
    await result.app.fire("picker-month-5", "click")
    expect(result.app.text()).toContain("2024年5月")
    await result.app.fire("picker-confirm", "click")
    expect(result.change).toHaveBeenCalledWith("2024-05")
  })

  it("navigates year and month grids to a new calendar", async () => {
    const result = mount(DatePicker, { defaultValue: "2024-01-15" })
    await result.app.fire("picker", "click")
    await result.app.fire("picker-header", "click")
    await result.app.fire("picker-year-2025", "click")
    await result.app.fire("picker-month-3", "click")
    await result.app.fire("picker-day-0-2025-03-08", "click")
    await result.app.fire("picker-confirm", "click")
    expect(result.change).toHaveBeenCalledWith("2025-03-08")
  })

  it("supports native navigation keys and refuses disabled keyboard selection", async () => {
    const result = mount(DatePicker, { defaultValue: "2024-01-15", disabledDate: (date: Date) => date.getDate() === 16 })
    await result.app.fire("picker", "keyDown", { key: "enter" })
    await result.app.fire("picker-panel", "keyDown", { key: "right" })
    await result.app.fire("picker-panel", "keyDown", { key: "enter" })
    await result.app.fire("picker-confirm", "click")
    expect(result.change).not.toHaveBeenCalled()
    await result.app.fire("picker", "keyDown", { key: "ArrowDown" })
    await result.app.fire("picker-panel", "keyDown", { key: "PageDown" })
    await result.app.fire("picker-panel", "keyDown", { key: "enter" })
    await result.app.fire("picker-confirm", "click")
    expect(result.change).toHaveBeenCalledWith("2024-02-15")
  })

  it("honors controlled open requests and native outside dismissal", async () => {
    const open = ref(false), requests = vi.fn()
    app = mountHost(defineComponent({ setup: () => () => h(DatePicker, { testId: "picker", open: open.value, "onUpdate:open": requests }) }))
    await app.fire("picker", "click")
    expect(requests).toHaveBeenCalledWith(true)
    expect(app.all().some((node) => node.type === "anchored")).toBe(false)
    open.value = true; await app.settle()
    expect(app.all().some((node) => node.type === "anchored")).toBe(true)
    await app.fire("picker-panel", "mouseDownOutside", { x: 900, y: 700 })
    expect(requests).toHaveBeenLastCalledWith(false)
    expect(app.all().some((node) => node.type === "anchored")).toBe(true)
    open.value = false; await app.settle()
    expect(app.all().some((node) => node.type === "anchored")).toBe(false)
  })

  it("clears to null and disables interaction completely", async () => {
    const result = mount(DatePicker, { defaultValue: "2024-01-15", allowClear: true })
    await result.app.fire("picker-clear", "click")
    expect(result.update).toHaveBeenCalledWith(null)
    expect(result.app.text()).toContain("请选择日期")
    result.app.unmount(); app = undefined
    const disabled = mount(DatePicker, { disabled: true, defaultValue: "2024-01-15", allowClear: true })
    await disabled.app.fire("picker", "click")
    await disabled.app.fire("picker", "keyDown", { key: "enter" })
    expect(disabled.app.find("picker").props.tabIndex).toBe(-1)
    expect(disabled.app.all().some((node) => node.type === "anchored")).toBe(false)
    expect(disabled.app.all().some((node) => node.props.testId === "picker-clear")).toBe(false)
  })

  it("today shortcut commits the current date and obeys disabledDate", async () => {
    const result = mount(DatePicker)
    await result.app.fire("picker", "click")
    await result.app.fire("picker-today", "click")
    await result.app.fire("picker-confirm", "click")
    const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    expect(result.change).toHaveBeenCalledWith(today)
    result.app.unmount(); app = undefined
    const blocked = mount(DatePicker, { disabledDate: () => true })
    await blocked.app.fire("picker", "click")
    await blocked.app.fire("picker-today", "click")
    await blocked.app.fire("picker-confirm", "click")
    expect(blocked.change).not.toHaveBeenCalled()
  })

  it("does not normalize invalid dates into another month", () => {
    const result = mount(DatePicker, { modelValue: "2024-02-31" })
    expect(result.app.text()).toContain("请选择日期")
  })

  it("Escape dismisses from a focused footer and restores trigger focus", async () => {
    const result = mount(DatePicker, { defaultValue: "2024-01-15" })
    await result.app.fire("picker", "click")
    result.app.native.focusElement?.(result.app.find("picker-confirm").id!)
    await result.app.fire("picker-panel", "keyDown", { key: "escape" })
    expect(result.app.native.getFocusedElementId?.()).toBe(result.app.find("picker").id)
    expect(result.app.all().some((node) => node.props.testId === "picker-panel")).toBe(false)
  })
})

describe("TimePicker through the native mutation/event host", () => {
  it("previews units, commits on confirmation and keeps controlled ownership", async () => {
    const result = mount(TimePicker, { modelValue: "10:20:30" })
    await result.app.fire("picker", "click")
    await result.app.fire("picker-h-12", "click")
    await result.app.fire("picker-m-column", "scroll", { deltaY: -30 })
    await result.app.fire("picker-m-column", "scroll", { deltaY: -30 })
    await result.app.fire("picker-m-15", "click")
    expect(result.app.text()).toContain("12:15:30")
    expect(result.change).not.toHaveBeenCalled()
    await result.app.fire("picker-confirm", "click")
    expect(result.change).toHaveBeenCalledExactlyOnceWith("12:15:30")
    expect(result.update).toHaveBeenCalledExactlyOnceWith("12:15:30")
    expect(result.app.text()).toContain("10:20:30")
  })

  it("updates a v-model parent and supports uncontrolled defaults", async () => {
    const value = ref<string | null>(null)
    app = mountHost(defineComponent({ setup: () => () => h(TimePicker, {
      testId: "picker", modelValue: value.value, minuteStep: 15,
      "onUpdate:modelValue": (next: string | null) => { value.value = next },
    }) }))
    await app.fire("picker", "click")
    await app.fire("picker-m-15", "click")
    await app.fire("picker-confirm", "click")
    expect(value.value).toBe("00:15:00")
    app.unmount(); app = undefined
    const result = mount(TimePicker, { defaultValue: "08:30:00" })
    expect(result.app.text()).toContain("08:30:00")
    await result.app.fire("picker", "click")
    await result.app.fire("picker-h-10", "click")
    await result.app.fire("picker-confirm", "click")
    expect(result.app.text()).toContain("10:30:00")
  })

  it("does not submit a value that has not changed", async () => {
    const result = mount(TimePicker, { modelValue: "10:20:30" })
    await result.app.fire("picker", "click")
    await result.app.fire("picker-confirm", "click")
    expect(result.change).not.toHaveBeenCalled()
    expect(result.open).toHaveBeenLastCalledWith(false)
  })

  it("filters all unit options by steps and omits seconds for formats without ss", async () => {
    const result = mount(TimePicker, { modelValue: "09:05:06", format: "H:mm", hourStep: 6, minuteStep: 15 })
    expect(result.app.text()).toContain("9:05")
    await result.app.fire("picker", "click")
    expect(result.app.all().some((node) => node.props.testId === "picker-h-6")).toBe(true)
    expect(result.app.all().some((node) => node.props.testId === "picker-h-7")).toBe(false)
    expect(result.app.all().some((node) => node.props.testId === "picker-m-15")).toBe(true)
    expect(result.app.all().some((node) => node.props.testId === "picker-s-column")).toBe(false)
    await result.app.fire("picker-h-6", "click")
    await result.app.fire("picker-confirm", "click")
    // Display format only changes presentation; serialization stays HH:mm:ss.
    expect(result.change).toHaveBeenCalledWith("06:05:06")
  })

  it("pages the entire option set without introducing an inner scroll container", async () => {
    const result = mount(TimePicker, { defaultValue: "00:00:00" })
    await result.app.fire("picker", "click")
    expect(result.app.find("picker-m-column").props.stopWheelPropagation).toBe(true)
    for (let i = 0; i < 8; i++) await result.app.fire("picker-m-next", "click")
    expect(result.app.find("picker-m-59")).toBeDefined()
    await result.app.fire("picker-m-59", "click")
    await result.app.fire("picker-confirm", "click")
    expect(result.change).toHaveBeenCalledWith("00:59:00")
    const styles = result.app.operations.filter(([op]) => op === "setStyle").map((operation) => operation[2] as Record<string, unknown>)
    expect(styles.some((style) => style.overflow === "scroll" || style.overflowY === "scroll")).toBe(false)
  })

  it("native arrow/home/end keys choose units and Enter confirms", async () => {
    const result = mount(TimePicker, { defaultValue: "08:30:00", minuteStep: 15 })
    await result.app.fire("picker", "keyDown", { key: "enter" })
    await result.app.fire("picker-panel", "keyDown", { key: "right" })
    await result.app.fire("picker-panel", "keyDown", { key: "down" })
    await result.app.fire("picker-panel", "keyDown", { key: "enter" })
    expect(result.change).toHaveBeenCalledWith("08:45:00")
  })

  it("sets now as pending and clears to null", async () => {
    const result = mount(TimePicker, { allowClear: true })
    await result.app.fire("picker", "click")
    await result.app.fire("picker-now", "click")
    expect(result.change).not.toHaveBeenCalled()
    await result.app.fire("picker-confirm", "click")
    expect(result.change.mock.calls[0][0]).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    const now = new Date(), [hours, minutes, seconds] = result.change.mock.calls[0][0].split(":").map(Number)
    expect(Math.abs(hours * 3600 + minutes * 60 + seconds - (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()))).toBeLessThanOrEqual(2)
    await result.app.fire("picker-clear", "click")
    expect(result.change).toHaveBeenLastCalledWith(null)
    expect(result.app.text()).toContain("请选择时间")
  })

  it("supports controlled initial open and reacts to parent changes", async () => {
    const open = ref(true), value = ref<string | null>("10:20:30"), requests = vi.fn()
    app = mountHost(defineComponent({ setup: () => () => h(TimePicker, { testId: "picker", modelValue: value.value, open: open.value, onOpenChange: requests }) }))
    expect(app.text()).toContain("10:20:30")
    await app.fire("picker-panel", "keyDown", { key: "escape" })
    expect(requests).toHaveBeenCalledWith(false)
    expect(app.all().some((node) => node.props.testId === "picker-panel")).toBe(true)
    open.value = false; value.value = "23:59:59"; await app.settle()
    expect(app.text()).toContain("23:59:59")
    open.value = true; await app.settle()
    expect(app.find("picker-h-23").props["aria-selected"]).toBe(true)
  })

  it("closes on outside presses without restoring focus and refuses disabled opening", async () => {
    const result = mount(TimePicker)
    await result.app.fire("picker", "click")
    await result.app.fire("picker-panel", "mouseDownOutside", { x: 900, y: 700 })
    expect(result.openUpdate).toHaveBeenLastCalledWith(false)
    expect(result.app.all().some((node) => node.props.testId === "picker-panel")).toBe(false)
    result.app.unmount(); app = undefined
    const disabled = mount(TimePicker, { disabled: true })
    await disabled.app.fire("picker", "keyDown", { key: "enter" })
    await disabled.app.fire("picker", "click")
    expect(disabled.app.find("picker").props.tabIndex).toBe(-1)
    expect(disabled.open).not.toHaveBeenCalled()
  })

  it("a second trigger press closes without reopening after its outside notification", async () => {
    const result = mount(TimePicker)
    await result.app.fire("picker", "mouseDown")
    await result.app.fire("picker", "click")
    await result.app.fire("picker", "mouseDown")
    await result.app.fire("picker-panel", "mouseDownOutside", { x: 10, y: 10 })
    await result.app.fire("picker", "click")
    expect(result.app.all().some((node) => node.props.testId === "picker-panel")).toBe(false)
    expect(result.open.mock.calls.map(([open]) => open)).toEqual([true, false])
  })
})
