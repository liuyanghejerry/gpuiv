import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, ref } from "vue"
import { colors } from "../src/tokens.js"
import type { HostNode } from "@gpuiv/vue"
import { Pagination } from "../src/components/Pagination.js"
import { mountHost } from "./harness.js"
const hosts: ReturnType<typeof mountHost>[] = []
afterEach(() => hosts.splice(0).forEach((host) => host.unmount()))
function text(node: HostNode): string { return node.text + node.children.map(text).join("") }

describe("Pagination", () => {
  it("opens the page-size menu above its trigger with the original left alignment and gap", async () => {
    const host = mountHost(defineComponent(() => () => h(Pagination, { testId: "pager", total: 100, showSizeChanger: true })))
    hosts.push(host)
    await host.fire("pager-size-changer", "click")
    const layer = host.find(node => node.type === "anchored")
    expect(layer.props.side).toBe("top")
    expect(layer.props.align).toBe("start")
    expect(layer.props.gap).toBe(8)
    expect(host.find(node => node.props.testId === "pager-size-changer-popup")).toBeDefined()
  })

  it("animates arrow SVG tint with the button through hover and disabled states", async () => {
    const disabled = ref(false)
    const host = mountHost(defineComponent(() => () => h(Pagination, { total: 100, defaultCurrent: 2, variant: "teal", disabled: disabled.value })))
    hosts.push(host)
    const edge = () => host.find(node => node.props["aria-label"] === "下一页")
    const target = (node: HostNode) => (node.props.motion as { animate: { color: string } }).animate.color
    const icon = () => edge().children.find(node => node.type === "svg")!
    expect(target(icon())).toBe(colors.warmSoft)
    await host.fire(edge(), "mouseEnter")
    expect(target(edge())).toBe(colors.primary)
    expect(target(icon())).toBe(target(edge()))
    await host.fire(edge(), "mouseLeave")
    expect(target(icon())).toBe(colors.warmSoft)
    disabled.value = true; await host.settle()
    expect(target(icon())).toBe(colors.shadowSoft)
    expect(target(icon())).toBe(target(edge()))
  })

  it("emits change for an uncontrolled size update and clamps the page", async () => {
    const onChange = vi.fn(), onShowSizeChange = vi.fn()
    const host = mountHost(defineComponent({ setup: () => () => h(Pagination, { total: 100, defaultCurrent: 9, showSizeChanger: true, onChange, onShowSizeChange }) }))
    hosts.push(host)
    await host.fire(host.find((node) => node.props.role === "combobox"), "click")
    const option = host.find((node) => (node.props.style as { paddingLeft?: number })?.paddingLeft === 14 && text(node).includes("20 条/页"))
    await host.fire(option, "click")
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(5, 20)
    expect(onShowSizeChange).toHaveBeenCalledWith(5, 20)
    expect(host.text()).toContain("20 条/页")
  })

  it("disabled quick jumper cannot submit or blur a value filled before disabling", async () => {
    const disabled = ref(false), onChange = vi.fn()
    const host = mountHost(defineComponent({ setup: () => () => h(Pagination, { total: 100, showQuickJumper: true, disabled: disabled.value, onChange }) }))
    hosts.push(host)
    const input = () => host.find((node) => node.type === "input")
    await host.fire(input(), "change", { value: "3" })
    disabled.value = true
    await host.settle()
    expect(input().props.tabIndex).toBe(-1)
    expect(input().props.readOnly).toBe(true)
    await host.fire(input(), "submit")
    await host.fire(input(), "blur")
    await host.fire(input(), "change", { value: "8" })
    expect(onChange).not.toHaveBeenCalled()
    expect(input().props.value).toBe("3")
    disabled.value = false
    await host.settle()
    await host.fire(input(), "submit")
    expect(onChange).toHaveBeenCalledWith(3, 10)
  })

  it("controlled size updates emit once without changing the external page", async () => {
    const onChange = vi.fn(), update = vi.fn()
    const host = mountHost(defineComponent({ setup: () => () => h(Pagination, { total: 100, current: 9, pageSize: 10, showSizeChanger: true,
      onChange, "onUpdate:pageSize": update }) }))
    hosts.push(host)
    await host.fire(host.find((node) => node.props.role === "combobox"), "click")
    await host.fire(host.find((node) => (node.props.style as { paddingLeft?: number })?.paddingLeft === 14 && text(node).includes("20 条/页")), "click")
    expect(update).toHaveBeenCalledWith(20)
    expect(onChange).toHaveBeenCalledWith(5, 20)
    expect(onChange).toHaveBeenCalledOnce()
    expect(host.text()).toContain("10 条/页")
  })
})
