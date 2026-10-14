import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, ref } from "vue"
import { mountHost } from "./harness.js"
import { Button } from "../src/components/Button.js"
import { Input } from "../src/components/Input.js"
import { Modal } from "../src/components/Modal.js"
import { Select } from "../src/components/Select.js"
import { Icon, getIconDataUrl } from "../src/components/Icon.js"
import { Avatar } from "../src/components/Avatar.js"
import { Background } from "../src/components/Background.js"
import { Card } from "../src/components/Card.js"
import { Pagination } from "../src/components/Pagination.js"
import { Form } from "../src/components/Form.js"
import { useForm } from "../src/form/useForm.js"
import { patternDataUrl } from "../src/patterns.js"

const cleanups: Array<() => void> = []
function mount(component: Parameters<typeof mountHost>[0]) {
  const app = mountHost(component)
  cleanups.push(app.unmount)
  return app
}
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); vi.useRealTimers() })

describe("original animal-island contracts", () => {
  it("preserves button size, cream fill, hard shadow and keyboard activation", async () => {
    const click = vi.fn()
    const app = mount(defineComponent(() => () => h(Button, { type: "primary", testId: "button", onClick: click }, () => "确定")))
    expect(app.find("button").props.style).toMatchObject({ height: 45, backgroundColor: "#f8f8f0", boxShadow: { offsetY: 5, blurRadius: 0 } })
    await app.fire("button", "keyDown", { key: "enter" })
    expect(click).toHaveBeenCalledTimes(1)
  })

  it("forwards native input submit and excludes disabled inputs from Tab", async () => {
    const submit = vi.fn()
    const app = mount(defineComponent(() => () => h(Input, { onSubmit: submit, defaultValue: "hello" })))
    await app.fire(app.find(node => node.type === "input"), "submit", { value: "hello" })
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ value: "hello" }))
    const disabled = mount(defineComponent(() => () => h(Input, { disabled: true })))
    expect(disabled.find(node => node.type === "input").props.tabIndex).toBe(-1)
  })

  it("keeps white Select triggers and yellow menus and updates an uncontrolled label", async () => {
    const change = vi.fn()
    const app = mount(defineComponent(() => () => h(Select, { testId: "select", options: [{ key: "cat", label: "猫猫" }, { key: "dog", label: "狗狗" }], onChange: change })))
    expect(app.find("select").props.style).toMatchObject({ backgroundColor: "#ffffff", borderRadius: 12 })
    await app.fire("select", "click")
    expect(app.all().some(node => (node.props.style as any)?.backgroundColor === "#ffeea0")).toBe(true)
    const popup = app.find(node => node.props.role === "listbox")
    await app.fire(popup, "keyDown", { key: "down" })
    await app.fire(popup, "keyDown", { key: "enter" })
    expect(change).toHaveBeenCalled()
    expect(app.text()).toContain(change.mock.calls[0][0] === "cat" ? "猫猫" : "狗狗")
  })

  it("plays Modal Typewriter on each opening and restores pixel line height", async () => {
    vi.useFakeTimers()
    const open = ref(true)
    const app = mount(defineComponent(() => () => h(Modal, { open: open.value, variant: "default", typeSpeed: 10 }, () => h("text", "小岛欢迎你"))))
    await app.settle()
    expect(app.text()).not.toContain("小岛欢迎你")
    await vi.advanceTimersByTimeAsync(60)
    await app.settle()
    expect(app.text()).toContain("小岛欢迎你")
    expect(app.all().some(node => (node.props.style as any)?.fontSize === 20 && (node.props.style as any)?.lineHeight === 32)).toBe(true)
    open.value = false
    await app.settle()
    await vi.advanceTimersByTimeAsync(400)
    open.value = true
    await app.settle()
    expect(app.text()).not.toContain("小岛欢迎你")
  })

  it("keeps Select controlled when the external value is cleared to an empty string", async () => {
    const value = ref("cat")
    const change = vi.fn()
    const app = mount(defineComponent(() => () => h(Select, { testId: "controlled", value: value.value, options: [{ key: "cat", label: "猫猫" }], onChange: change })))
    value.value = ""
    await app.settle()
    await app.fire("controlled", "click")
    expect(app.find("controlled-option-cat").props["aria-selected"]).toBe(false)
    await app.fire("controlled-option-cat", "click")
    expect(change).toHaveBeenCalledWith("cat")
    expect(app.text()).toContain("请选择")
  })

  it("uses a deferred viewport layer for initially open dialogs and restores focus on unmount", async () => {
    const focus = vi.fn()
    const app = mountHost(defineComponent(() => () => h(Modal, { open: true, typewriter: false })), { getFocusedElementId: () => 42, focusElement: focus })
    const layer = app.find(node => node.type === "anchored")
    expect(layer.props).toMatchObject({ deferred: true, position: { x: 0, y: 0 }, snapMargin: 0 })
    expect(layer.props.style).toMatchObject({ width: 1000, height: 800 })
    app.unmount()
    expect(focus).toHaveBeenCalledWith(42)
  })

  it("keeps icon inner colours while overriding root stroke and supports icon components", () => {
    const original = Buffer.from(getIconDataUrl("Cat").split(",")[1], "base64").toString()
    const changed = Buffer.from(getIconDataUrl("Cat", { color: "#ff0000", strokeWidth: 2 }).split(",")[1], "base64").toString()
    expect(changed).toContain('stroke="#ff0000"')
    expect(changed).toContain('stroke-width="2"')
    expect(changed.slice(changed.indexOf(">") + 1)).toBe(original.slice(original.indexOf(">") + 1))
    const custom = defineComponent(() => () => h("text", "自定义图标"))
    const app = mount(defineComponent(() => () => h(Icon, { icon: custom })))
    expect(app.text()).toContain("自定义图标")
  })

  it("shows the original default User avatar instead of an empty placeholder", () => {
    const app = mount(defineComponent(() => () => h(Avatar)))
    expect(app.find(node => node.type === "img").props.src).toBe(getIconDataUrl("User"))
  })

  it("paints dot, grid and sprinkle backgrounds without intercepting content", async () => {
    for (const pattern of ["default", "grid", "sprinkles", "dots-pink"]) {
      const app = mount(defineComponent(() => () => h(Background, { type: pattern as any }, () => h("text", "内容"))))
      await app.settle()
      expect(app.text()).toContain("内容")
      expect(app.find(node => node.type === "img").props.style).toMatchObject({ pointerEvents: "none" })
    }
    const app = mount(defineComponent(() => () => h(Card, { pattern: "app-pink" })))
    await app.settle()
    expect(app.find(node => node.type === "img").props.src).toContain("data:image/svg+xml;base64,")
    const dots = Buffer.from(patternDataUrl("dots-pink", 200, 100).split(",")[1], "base64").toString()
    expect(dots).toContain('width="28" height="28"')
    expect(dots).toContain("rgba(248, 166, 178, 0.18)")
  })

  it("renders pagination ghost buttons and performs page changes", async () => {
    const change = vi.fn()
    const app = mount(defineComponent(() => () => h(Pagination, { total: 30, pageSize: 10, onChange: change })))
    const next = app.find(node => node.props["aria-label"] === "下一页")
    expect(next.props.style).toMatchObject({ backgroundColor: "transparent", borderWidth: 0 })
    await app.fire(next, "click")
    expect(change).toHaveBeenCalledWith(2, 10)
  })

  it("submits and resets Form through Button htmlType", async () => {
    const finish = vi.fn()
    const reset = vi.fn()
    const [form] = useForm()
    form.setFieldValue("name", "猫猫")
    const app = mount(defineComponent(() => () => h(Form, { form, onFinish: finish, onReset: reset }, () => [h(Button, { htmlType: "submit", testId: "submit" }, () => "提交"), h(Button, { htmlType: "reset", testId: "reset" }, () => "重置")])))
    await app.fire("submit", "click")
    await app.settle()
    expect(finish).toHaveBeenCalled()
    await app.fire("reset", "click")
    expect(form.getFieldValue("name")).toBeUndefined()
    expect(reset).toHaveBeenCalled()
  })
})
