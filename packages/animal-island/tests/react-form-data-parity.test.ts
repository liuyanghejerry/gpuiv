import { defineComponent, Fragment, h, ref, shallowRef, type Component, type VNodeChild } from "vue"
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest"
import { Select } from "../src/components/Select.js"
import { Input, type InputProps } from "../src/components/Input.js"
import { DatePicker, type DatePickerValue } from "../src/components/DatePicker.js"
import { TimePicker } from "../src/components/TimePicker.js"
import { Upload, type UploadExpose, type UploadFile, type UploadProps, type UploadChangeParam, type UploadNativeFile, type UploadOnChange } from "../src/components/Upload.js"
import { Table, type TableColumn, type TableProps } from "../src/components/Table.js"
import { Checkbox, type CheckboxProps, type CheckboxOption } from "../src/components/Checkbox.js"
import { Radio, type RadioProps, type RadioOption } from "../src/components/Radio.js"
import { Switch, type SwitchProps } from "../src/components/Switch.js"
import type { RateProps } from "../src/components/Rate.js"
import type { EventPayload, StyleDesc } from "@gpuiv/vue"
import { Progress } from "../src/components/Progress.js"
import { Form } from "../src/components/Form.js"
import { FormItem } from "../src/components/FormItem.js"
import { FormProvider } from "../src/components/FormProvider.js"
import { Button } from "../src/components/Button.js"
import { useForm, type InternalForm } from "../src/form/useForm.js"
import type { FormInstance, FormItemProps } from "../src/form/types.js"
import type { UploadOnChange as PublicUploadOnChange } from "../src/index.js"
import { mountHost } from "./harness.js"

const hosts: ReturnType<typeof mountHost>[] = []
afterEach(() => hosts.splice(0).forEach(host => host.unmount()))
const options = [{ key: "island", label: "小岛" }, { key: "forest", label: "森林" }, { key: "beach", label: "海滩" }]
function mountSelect(props: Record<string, unknown> = {}) {
  const host = mountHost(defineComponent(() => () => h(Select, { testId: "select", options, ...props })))
  hosts.push(host)
  return host
}
const visibleOptions = (host: ReturnType<typeof mountHost>) => host.all().filter(node => String(node.props.testId ?? "").startsWith("select-option-")).map(node => node.props.testId)

describe("React Select search and clear parity", () => {
  it.each([
    { name: "null", content: null, text: "" },
    { name: "boolean", content: false, text: "" },
    { name: "empty list", content: [], text: "" },
    { name: "zero", content: 0, text: "0" },
    { name: "mixed list", content: ["无", 12, h("text", "记录"), null, false], text: "无 12 记录" },
    { name: "empty fragment", content: h(Fragment, [null, false]), text: "" },
  ] satisfies Array<{ name: string; content: VNodeChild; text: string }>)("renders $name empty content without making it selectable", async ({ content, text }) => {
    const change = vi.fn(), host = mountSelect({ showSearch: true, onChange: change, notFoundContent: content })
    await host.fire("select", "change", { value: "unknown" })
    expect(host.text().trim()).toBe(text)
    const empty = host.find("select-empty")
    expect(empty.props.role).toBe("option")
    expect(empty.props.onClick).toBeUndefined()
    await host.fire("select", "submit")
    expect(change).not.toHaveBeenCalled()
  })
  it("filters labels, reports search changes and selects using the input keyboard", async () => {
    const onSearch = vi.fn(), onChange = vi.fn(), host = mountSelect({ showSearch: true, onSearch, onChange })
    await host.fire("select", "change", { value: "森" })
    expect(onSearch).toHaveBeenLastCalledWith("森")
    expect(visibleOptions(host)).toEqual(["select-option-forest"])
    expect(host.find(node => node.type === "anchored").props).toMatchObject({ side: "top", align: "start", gap: 8, deferred: true })
    await host.fire("select", "submit")
    expect(onChange).toHaveBeenCalledExactlyOnceWith("forest")
    expect(onSearch).toHaveBeenLastCalledWith("")
    expect(host.find("select").props.value).toBe("森林")
    expect(host.all().some(node => node.props.testId === "select-popup")).toBe(false)
  })
  it("matches keys, supports custom matchers and permits external filtering", async () => {
    const mode = ref<"key" | "custom" | "external">("key"), matcher = vi.fn((query: string, option: { key: string }) => option.key.endsWith(query))
    const host = mountHost(defineComponent(() => () => h(Select, { testId: "select", options, showSearch: true, optionFilterProp: "key", filterOption: mode.value === "key" ? true : mode.value === "custom" ? matcher : false })))
    hosts.push(host)
    await host.fire("select", "change", { value: "FORE" })
    expect(visibleOptions(host)).toEqual(["select-option-forest"])
    mode.value = "custom"; await host.settle()
    await host.fire("select", "change", { value: "ch" })
    expect(matcher).toHaveBeenCalledWith("ch", expect.objectContaining({ key: "beach" }))
    expect(visibleOptions(host)).toEqual(["select-option-beach"])
    mode.value = "external"; await host.settle()
    expect(visibleOptions(host)).toHaveLength(3)
  })
  it("shows custom empty content and cannot confirm a stale filtered option", async () => {
    const change = vi.fn(), host = mountSelect({ showSearch: true, onChange: change, notFoundContent: h("text", "没有目的地") })
    await host.fire("select", "change", { value: "unknown" })
    expect(host.text()).toContain("没有目的地")
    expect(host.find("select-empty").props).toMatchObject({ role: "option", "aria-selected": false })
    await host.fire("select", "submit")
    expect(change).not.toHaveBeenCalled()
  })
  it("keeps spaces as search input and clears a query before closing on Escape", async () => {
    const search = vi.fn(), host = mountSelect({ showSearch: true, onSearch: search })
    await host.fire("select", "change", { value: "森" })
    await host.fire("select", "keyDown", { key: "space" })
    expect(host.all().some(node => node.props.testId === "select-popup")).toBe(true)
    await host.fire("select", "keyDown", { key: "escape" })
    expect(search).toHaveBeenLastCalledWith("")
    expect(visibleOptions(host)).toHaveLength(3)
    await host.fire("select", "keyDown", { key: "escape" })
    expect(host.all().some(node => node.props.testId === "select-popup")).toBe(false)
  })
  it("removes echoed label text from a new query and preserves controlled ownership", async () => {
    const value = ref("island"), change = vi.fn(), search = vi.fn()
    const host = mountHost(defineComponent(() => () => h(Select, { options, testId: "select", showSearch: true, value: value.value, modelValue: "forest", onChange: change, onSearch: search })))
    hosts.push(host)
    expect(host.find("select").props.value).toBe("小岛")
    await host.fire("select", "change", { value: "小岛海" })
    expect(search).toHaveBeenLastCalledWith("海")
    expect(host.find("select").props).toMatchObject({ value: "海", valueRevision: 1 })
    await host.fire("select", "submit")
    expect(change).toHaveBeenCalledExactlyOnceWith("beach")
    expect(host.find("select").props.value).toBe("小岛")
    value.value = "beach"; await host.settle()
    expect(host.find("select").props.value).toBe("海滩")
  })
  it("supports Home/End and arrow navigation within filtered results", async () => {
    const change = vi.fn(), host = mountSelect({ showSearch: true, onChange: change })
    await host.fire("select", "click")
    await host.fire("select", "keyDown", { key: "end" })
    await host.fire("select", "keyDown", { key: "up" })
    await host.fire("select", "submit")
    expect(change).toHaveBeenLastCalledWith("forest")
    await host.fire("select", "click")
    await host.fire("select", "keyDown", { key: "home" })
    await host.fire("select", "submit")
    expect(change).toHaveBeenLastCalledWith("island")
  })
  it.each([false, true])("clears selected values with showSearch=%s without reopening or retaining the old internal value", async showSearch => {
    const change = vi.fn(), clear = vi.fn(), host = mountSelect({ showSearch, defaultValue: "island", allowClear: true, onClear: clear, onChange: change, clearAriaLabel: "清除目的地" })
    await host.fire("select", "focus")
    const button = host.find("select-clear")
    expect(button.props["aria-label"]).toBe("清除目的地")
    await host.fire(button, "keyDown", { key: "enter" })
    expect(clear).toHaveBeenCalledExactlyOnceWith()
    expect(change).toHaveBeenCalledExactlyOnceWith("")
    expect(host.all().some(node => node.props.testId === "select-popup")).toBe(false)
    if (showSearch) expect(host.find("select").props.value).toBe("")
    else expect(host.text()).toContain("请选择")
    await host.fire("select", "click")
    await host.fire("select-option-beach", "click")
    expect(change).toHaveBeenLastCalledWith("beach")
  })
  it("ignores editing and opening while disabled", async () => {
    const search = vi.fn(), change = vi.fn(), host = mountSelect({ showSearch: true, value: "island", allowClear: true, disabled: true, onSearch: search, onChange: change })
    await host.fire("select", "change", { value: "森" })
    await host.fire("select", "click")
    await host.fire("select", "submit")
    expect(host.all().some(node => node.props.testId === "select-popup")).toBe(false)
    expect(search).not.toHaveBeenCalled()
    expect(change).not.toHaveBeenCalled()
    expect(host.find("select").props.readOnly).toBe(true)
  })
})

describe("React controlled props and composed content", () => {
  it("exports inferred native props and preserves native callback/style types", () => {
    expectTypeOf<NonNullable<InputProps["onChange"]>>().toEqualTypeOf<(value: string, event?: EventPayload) => void>()
    expectTypeOf<NonNullable<SwitchProps["onChange"]>>().toEqualTypeOf<(value: boolean) => void>()
    expectTypeOf<NonNullable<CheckboxProps["onChange"]>>().toEqualTypeOf<(value: Array<string | number>) => void>()
    expectTypeOf<NonNullable<RadioProps["onChange"]>>().toEqualTypeOf<(value: string | number) => void>()
    expectTypeOf<NonNullable<RateProps["onChange"]>>().toEqualTypeOf<(value: number) => void>()
    expectTypeOf<InputProps["style"]>().toEqualTypeOf<StyleDesc | undefined>()
    expectTypeOf<InputProps["prefix"]>().toEqualTypeOf<VNodeChild>()
    expectTypeOf<InputProps["suffix"]>().toEqualTypeOf<VNodeChild>()
    expectTypeOf<UploadProps["tip"]>().toEqualTypeOf<VNodeChild>()
    expectTypeOf<SwitchProps["checkedChildren"]>().toEqualTypeOf<VNodeChild>()
    expectTypeOf<SwitchProps["unCheckedChildren"]>().toEqualTypeOf<VNodeChild>()
    expectTypeOf<CheckboxOption["label"]>().toEqualTypeOf<VNodeChild>()
    expectTypeOf<RadioOption["label"]>().toEqualTypeOf<VNodeChild>()
    expectTypeOf<FormItemProps["label"]>().toEqualTypeOf<VNodeChild>()
    expectTypeOf<FormItemProps["help"]>().toEqualTypeOf<VNodeChild>()
    expectTypeOf<TableProps["emptyText"]>().toEqualTypeOf<VNodeChild>()
    expectTypeOf<TableColumn["title"]>().toEqualTypeOf<VNodeChild | (() => VNodeChild)>()
    expectTypeOf<ReturnType<NonNullable<TableColumn["render"]>>>().toEqualTypeOf<VNodeChild>()
    expectTypeOf<PublicUploadOnChange>().toEqualTypeOf<UploadOnChange>()
    expectTypeOf<NonNullable<UploadProps["onChange"]>>().toEqualTypeOf<(info: UploadChangeParam) => void>()
    expectTypeOf<NonNullable<UploadProps["onPreview"]>>().toEqualTypeOf<(file: UploadFile) => void>()
    expectTypeOf<NonNullable<UploadProps["onExceed"]>>().toEqualTypeOf<(files: UploadNativeFile[], fileList: UploadFile[]) => void>()
    expectTypeOf<UploadProps["style"]>().toEqualTypeOf<StyleDesc | undefined>()
  })
  it("recognizes Input value/readOnly and preserves VNode prefix/suffix", async () => {
    const value = ref<string | number>(12), keyDown = vi.fn()
    const host = mountHost(defineComponent(() => () => h(Input, { value: value.value, modelValue: "ignored", readOnly: true, autoFocus: true, tabIndex: 3, onKeyDown: keyDown, prefix: h("text", "前缀"), suffix: h("text", "后缀") })))
    hosts.push(host)
    const input = () => host.find(node => node.type === "input")
    expect(input().props).toMatchObject({ value: "12", readOnly: true, autoFocus: true, tabIndex: 3 })
    expect(host.text()).toContain("前缀")
    expect(host.text()).toContain("后缀")
    value.value = "next"; await host.settle()
    expect(input().props.value).toBe("next")
    await host.fire(input(), "keyDown", { key: "escape" })
    expect(keyDown).toHaveBeenCalledWith(expect.objectContaining({ key: "escape" }))
  })
  it.each([DatePicker, TimePicker])("recognizes picker value, controlled null and precedence over modelValue", async Picker => {
    const isDate = Picker === DatePicker, value = ref<DatePickerValue>(isDate ? "2024-01-15" : "08:30:00"), change = vi.fn()
    const host = mountHost(defineComponent(() => () => h(Picker as Component, { testId: "picker", value: value.value, modelValue: isDate ? "2025-02-10" : "14:00:00", allowClear: true, onChange: change })))
    hosts.push(host)
    expect(host.text()).toContain(value.value)
    await host.fire("picker-clear", "click")
    expect(change).toHaveBeenCalledExactlyOnceWith(null)
    expect(host.text()).toContain(value.value)
    value.value = null; await host.settle()
    expect(host.text()).toContain(isDate ? "请选择日期" : "请选择时间")
  })
  it("recognizes Upload fileList and leaves controlled removal to its parent", async () => {
    const files = ref<UploadFile[]>([{ uid: "first", name: "first.txt", status: "done" }]), upload = ref<UploadExpose | null>(null), change = vi.fn()
    const host = mountHost(defineComponent(() => () => h(Upload, { ref: upload, fileList: files.value, modelValue: [{ uid: "ignored", name: "ignored.txt" }], onChange: change, tip: h("text", "上传说明") })))
    hosts.push(host)
    expect(host.text()).toContain("first.txt")
    expect(host.text()).not.toContain("ignored.txt")
    expect(host.text()).toContain("上传说明")
    await upload.value!.remove(files.value[0]); await host.settle()
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ status: "removed" }), fileList: [] }))
    expect(host.text()).toContain("first.txt")
    files.value = []; await host.settle()
    expect(host.text()).not.toContain("first.txt")
  })
  it("forwards Table pagination.onChange as well as its own change event", async () => {
    const onChange = vi.fn(), paginationChange = vi.fn()
    const host = mountHost(defineComponent(() => () => h(Table, { testId: "table", columns: [{ title: "名称", dataIndex: "name" }], dataSource: [{ key: "one", name: "第一页" }, { key: "two", name: "第二页" }], pagination: { defaultPageSize: 1, onChange: paginationChange }, onChange })))
    hosts.push(host)
    await host.fire(host.find(node => node.props["aria-label"] === "下一页"), "click")
    expect(host.text()).toContain("第二页")
    expect(host.text()).not.toContain("第一页")
    expect(paginationChange).toHaveBeenCalledExactlyOnceWith(2, 1)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(2, 1)
  })
  it("renders VNode Checkbox/Radio labels and Switch state content", () => {
    const host = mountHost(defineComponent(() => () => h("div", [h(Checkbox, { options: [{ value: "a", label: h("text", "复选标签") }] }), h(Radio, { options: [{ value: "a", label: h("text", "单选标签") }] }), h(Switch, { checked: true, checkedChildren: h("text", "已开启") })])))
    hosts.push(host)
    expect(host.text()).toContain("复选标签")
    expect(host.text()).toContain("单选标签")
    expect(host.text()).toContain("已开启")
    expect(host.text()).not.toContain("[object Object]")
  })
})

describe.each(["prefix", "suffix", "tip"] as const)("ReactNode %s content", field => {
  it.each([
    { name: "mixed arrays", value: ["内容", 12, [h("text", "节点"), true, false, null]], expected: "内容 12 节点" },
    { name: "true", value: true, expected: "" },
    { name: "false", value: false, expected: "" },
    { name: "null", value: null, expected: "" },
    { name: "number", value: 42, expected: "42" },
    { name: "fragment", value: h(Fragment, [h("text", "片段"), false, null]), expected: "片段" },
    { name: "empty array", value: [], expected: "" },
    { name: "empty fragment", value: h(Fragment, [null, false]), expected: "" },
  ] satisfies Array<{ name: string; value: VNodeChild; expected: string }>)("renders $name and preserves wrapper visibility", ({ value, expected }) => {
    const host = mountHost(defineComponent(() => () => field === "tip"
      ? h(Upload, { tip: value }, () => h("text", "Trigger"))
      : h(Input, { [field]: value })))
    hosts.push(host)
    const text = field === "tip" ? host.text().replace("Trigger", "").trim() : host.text().trim()
    expect(text).toBe(expected)
    const wrappers = host.all().filter(node => {
      if (node.type !== "div") return false
      const style = node.props.style as StyleDesc | undefined
      if (field === "tip") return style?.fontSize === 12 && style.lineHeight === 19.2
      return field === "prefix" ? style?.marginRight === 6 : style?.marginLeft === 6
    })
    expect(wrappers).toHaveLength(value ? 1 : 0)
  })
})

// Validate that controls send native tracks, rather than running JS frame loops.
describe("React selection animation parity", () => {
  it.each([
    { checked: false, loading: false, disabled: false, color: "rgba(114, 93, 66, 0.15)", opacity: undefined },
    { checked: true, loading: false, disabled: false, color: "rgba(90, 158, 30, 0.2)", opacity: undefined },
    { checked: false, loading: true, disabled: false, color: "rgba(114, 93, 66, 0.15)", opacity: 0.7 },
    { checked: true, loading: true, disabled: false, color: "rgba(90, 158, 30, 0.2)", opacity: 0.7 },
    { checked: true, loading: false, disabled: true, color: "rgba(90, 158, 30, 0.2)", opacity: 0.5 },
  ])("keeps React Switch inset depth with checked=$checked/loading=$loading/disabled=$disabled", ({ color, opacity, ...props }) => {
    const host = mountHost(defineComponent(() => () => h(Switch, { testId: "inset-switch", ...props })))
    hosts.push(host)
    const style = host.find("inset-switch").props.style as StyleDesc
    expect(style.boxShadow).toEqual({ offsetX: 0, offsetY: 2, blurRadius: 4, spreadRadius: 0, color, inset: true })
    expect(style.opacity).toBe(opacity)
  })
  it.each([undefined, "forest-grove"] as const)("paints the native Progress inset highlight above its %s artwork and below the label", async variant => {
    const host = mountHost(defineComponent(() => () => h(Progress, { testId: "inset-progress", percent: 50, duration: 0, showInfo: true, infoPosition: "inside", variant })))
    hosts.push(host)
    await host.settle()
    const highlight = host.find("inset-progress-fill-highlight")
    expect(highlight.props.style).toMatchObject({ position: "absolute", width: "100%", height: 20, pointerEvents: "none", borderRadius: 999, boxShadow: { offsetX: 0, offsetY: 2, blurRadius: 0, spreadRadius: 0, color: "rgba(255, 255, 255, 0.45)", inset: true } })
    const fill = highlight.parent!
    expect((fill.props.style as StyleDesc).boxShadow).toBeUndefined()
    const artworkIndex = fill.children.findIndex(child => child.type === "img")
    expect(artworkIndex).toBeGreaterThanOrEqual(0)
    expect(fill.children.indexOf(highlight)).toBeGreaterThan(artworkIndex)
    const infoIndex = fill.children.findIndex(child => subtreeText(child) === "50%")
    expect(infoIndex).toBeGreaterThan(fill.children.indexOf(highlight))
    expect((fill.parent!.props.style as StyleDesc).boxShadow).toBeUndefined()
  })
  it.each([Checkbox, Radio])("sends six expanding/fading native splash dots on selection", async Control => {
    const host = mountHost(defineComponent(() => () => h(Control as Component, { testId: "choice", options: [{ value: "a", label: "选项" }] })))
    hosts.push(host)
    const row = host.find(node => node.props.role === (Control === Checkbox ? "checkbox" : "radio"))
    await host.fire(row, "click")
    const splash = host.find("choice-splash-a")
    expect(splash.children).toHaveLength(6)
    for (const dot of splash.children) {
      expect(dot.props.style).toMatchObject({ pointerEvents: "none", position: "absolute" })
      expect(dot.props.motion).toMatchObject({ initial: { opacity: 1, width: 6 }, animate: { opacity: 0, width: 2 }, transition: { duration: 0.6 } })
    }
    if (Control === Checkbox) {
      await host.fire(row, "click")
      expect(host.all().some(node => node.props.testId === "choice-splash-a")).toBe(false)
      await host.fire(row, "click")
      expect(host.find("choice-splash-a").id).not.toBe(splash.id)
    }
  })
  it("stagger-pops newly filled rating stars, settles after overshoot and drops the effect when clearing", async () => {
    const { Rate } = await import("../src/components/Rate.js")
    const host = mountHost(defineComponent(() => () => h(Rate, { testId: "rating" })))
    hosts.push(host)
    await host.fire(host.find(node => node.props["aria-label"] === "3 星"), "click")
    const tracks = [1, 2, 3].map(index => host.find(`rating-star-${index}`))
    expect(tracks.map(node => (node.props.motion as { transition: { delay: number } }).transition.delay)).toEqual([0, 0.06, 0.12])
    const first = tracks[0], target = first.props.motion as { generation: number; animate: { width: number }; initial: { width: number } }
    expect(target.initial.width).toBeCloseTo(26 * 0.55)
    expect(target.animate.width).toBeCloseTo(26 * 1.15)
    expect(host.find("rating-splash-3").children).toHaveLength(6)
    await host.fire(first, "motionComplete", { motionGeneration: target.generation })
    expect(first.props.motion).toMatchObject({ animate: { width: 26, height: 26 }, transition: { delay: 0 } })
    await host.fire(host.find(node => node.props["aria-label"] === "3 星"), "click")
    expect(host.all().some(node => node.props.testId === "rating-splash-3")).toBe(false)
  })
})

describe("React mounted Form instance replacement", () => {
  it("moves fields, hosts, callbacks and submit/reset to the new instance while preserving both stores", async () => {
    const firstOwnedChange = vi.fn(), secondOwnedChange = vi.fn()
    const [first] = useForm({ initialValues: { name: "First seed" }, onValuesChange: firstOwnedChange })
    const [second] = useForm({ initialValues: { name: "Second seed" }, onValuesChange: secondOwnedChange })
    const active = shallowRef(first), finish = vi.fn(), failed = vi.fn(), changed = vi.fn(), reset = vi.fn(), scroll = vi.fn()
    const exposed = ref<{ form: FormInstance; submit(): void; reset(): void } | null>(null)
    const host = mountHost(defineComponent(() => () => h(Form, { ref: exposed, form: active.value, onFinish: finish, onFinishFailed: failed, onValuesChange: changed, onReset: reset }, () => [
      h(FormItem, { name: "name", testId: "field", rules: [{ required: true, message: "Required" }] }, () => h(Input)),
      h(Button, { testId: "reset-form", htmlType: "reset" }, () => h("text", "Reset")),
    ])), { scrollIntoView: scroll })
    hosts.push(host)
    const input = () => host.find(node => node.type === "input")
    const fieldId = host.find("field").id
    expect(input().props.value).toBe("First seed")
    await host.fire(input(), "change", { value: "First edit" })
    expect(first.getFieldValue("name")).toBe("First edit")
    active.value = second; await host.settle()
    expect(input().props.value).toBe("Second seed")
    expect(exposed.value?.form).toBe(second)
    expect((first as unknown as InternalForm).__store.hasField("name")).toBe(false)
    expect((second as unknown as InternalForm).__store.hasField("name")).toBe(true)
    second.scrollToField("name")
    expect(scroll).toHaveBeenCalledExactlyOnceWith(fieldId)
    changed.mockClear()
    first.setFieldValue("name", "Detached first edit")
    await host.settle()
    expect(changed).not.toHaveBeenCalled()
    expect(firstOwnedChange).toHaveBeenCalledExactlyOnceWith({ name: "Detached first edit" }, { name: "Detached first edit" })
    expect(input().props.value).toBe("Second seed")
    await host.fire(input(), "change", { value: "" })
    await host.fire(input(), "submit")
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(expect.objectContaining({ errorFields: [{ name: "name", errors: ["Required"] }] })))
    await host.fire(input(), "change", { value: "Second edit" })
    exposed.value?.submit()
    await vi.waitFor(() => expect(finish).toHaveBeenCalledExactlyOnceWith({ name: "Second edit" }))
    await host.fire("reset-form", "click")
    expect(reset).toHaveBeenCalledTimes(1)
    expect(input().props.value).toBe("Second seed")
    expect(first.getFieldValue("name")).toBe("Detached first edit")
    active.value = first; await host.settle()
    expect(input().props.value).toBe("Detached first edit")
    changed.mockClear()
    second.setFieldValue("name", "Detached second edit")
    expect(changed).not.toHaveBeenCalled()
    expect(secondOwnedChange).toHaveBeenCalledExactlyOnceWith({ name: "Detached second edit" }, { name: "Detached second edit" })
    exposed.value?.reset(); await host.settle()
    expect(input().props.value).toBe("First seed")
    expect(second.getFieldValue("name")).toBe("Detached second edit")
  })
  it("keeps existing errors on instance replacement and subscribes through a changing Provider", async () => {
    const [first] = useForm({ initialValues: { field: "First", dependency: "a" } })
    const [second] = useForm({ initialValues: { field: "Second", dependency: "b" } })
    second.setFields([{ name: "field", errors: ["Second error"], touched: true }])
    const active = shallowRef(first)
    const host = mountHost(defineComponent(() => () => h(FormProvider, { form: active.value }, () => h(FormItem, { name: "field", dependencies: ["dependency"] }, () => h(Input)))))
    hosts.push(host)
    active.value = second; await host.settle()
    expect(host.text()).toContain("Second error")
    expect(host.find(node => node.type === "input").props.value).toBe("Second")
    expect((first as unknown as InternalForm).__store.hasField("field")).toBe(false)
    second.setFieldValue("dependency", "new"); await host.settle()
    expect(second.getFieldError("field")).toBeUndefined()
    second.setFieldValue("field", "Updated second"); await host.settle()
    expect(host.find(node => node.type === "input").props.value).toBe("Updated second")
    expect(first.getFieldValue("field")).toBe("First")
  })
})

const subtreeText = (node: { text: string; children: Array<{ text: string; children: unknown[] }> }): string => {
  const walk = (current: typeof node): string[] => [current.text, ...current.children.flatMap(child => walk(child as typeof node))]
  return walk(node).filter(Boolean).join(" ").trim()
}

describe("rich content across remaining React form/data props", () => {
  it.each([
    { name: "mixed nested list", value: ["内容", 12, [h("text", "节点"), true, false, null]], expected: "内容 12 节点", label: "内容12节点" },
    { name: "true", value: true, expected: "", label: undefined },
    { name: "false", value: false, expected: "", label: undefined },
    { name: "null", value: null, expected: "", label: undefined },
    { name: "zero", value: 0, expected: "0", label: "0" },
    { name: "fragment", value: h(Fragment, [h("text", "片段"), false, null]), expected: "片段", label: "片段" },
    { name: "empty fragment", value: h(Fragment, [false, null]), expected: "", label: undefined },
  ] satisfies Array<{ name: string; value: VNodeChild; expected: string; label: string | undefined }>)("preserves $name labels, state children, form help and table nodes", async ({ value, expected, label }) => {
    const [form] = useForm({ initialValues: { field: "Value" } })
    const checked = ref(true)
    const host = mountHost(defineComponent(() => () => h("div", [
      h(Checkbox, { testId: "rich-checkbox", options: [{ value: "one", label: value }] }),
      h(Radio, { testId: "rich-radio", options: [{ value: "one", label: value }] }),
      h(Switch, { testId: "rich-switch", checked: checked.value, checkedChildren: value, unCheckedChildren: value }),
      h(Form, { form }, () => h(FormItem, { name: "field", testId: "rich-field", label: value, help: value, colon: false }, () => h(Input, { testId: "rich-input" }))),
      h(Table, { testId: "rich-table", columns: [{ title: value, dataIndex: "value", render: () => value }], dataSource: [{ key: "row", value: "ignored" }] }),
      h(Table, { testId: "rich-empty", showHeader: false, columns: [], emptyText: value }),
    ])))
    hosts.push(host)
    for (const id of ["rich-checkbox", "rich-radio", "rich-switch"]) expect(subtreeText(host.find(id))).toBe(expected)
    for (const role of ["checkbox", "radio"]) expect(host.find(node => node.props.role === role).props["aria-label"]).toBe(label)
    const field = host.find("rich-field"), input = host.find("rich-input")
    expect(subtreeText(field)).toBe([expected, expected].filter(Boolean).join(" "))
    expect(input.props["aria-label"]).toBe(label)
    expect(input.props["aria-description"]).toBe(label)
    const table = host.find("rich-table")
    expect(subtreeText(table)).toBe([expected, expected].filter(Boolean).join(" "))
    expect(subtreeText(host.find("rich-empty"))).toBe(["▤", expected].filter(Boolean).join(" "))
    checked.value = false; await host.settle()
    expect(subtreeText(host.find("rich-switch"))).toBe(expected)
  })
  it("keeps component-valued labels as components rather than stringifying their definitions", () => {
    const RichLabel = defineComponent(() => () => h("text", "Component label"))
    const [form] = useForm()
    const host = mountHost(defineComponent(() => () => h("div", [
      h(Checkbox, { options: [{ value: "one", label: h(RichLabel) }] }),
      h(Radio, { options: [{ value: "one", label: h(RichLabel) }] }),
      h(Switch, { checked: true, checkedChildren: h(RichLabel) }),
      h(Form, { form }, () => h(FormItem, { label: h(RichLabel), help: h(RichLabel), colon: false }, () => h(Input))),
      h(Table, { columns: [{ title: h(RichLabel), render: () => h(RichLabel) }], dataSource: [{ key: "row" }] }),
      h(Table, { showHeader: false, emptyText: h(RichLabel) }),
    ])))
    hosts.push(host)
    expect(host.text().match(/Component label/g)).toHaveLength(8)
    expect(host.text()).not.toContain("[object Object]")
  })
})
