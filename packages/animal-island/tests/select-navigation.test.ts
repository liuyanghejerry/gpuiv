import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, ref } from "vue"
import { Select, SelectContent, SelectItem, SelectTrigger, type SelectItemState } from "@gpuiv/vue"
import { Select as AnimalSelect } from "../src/components/Select.js"
import { mountHost } from "./harness.js"

const hosts: ReturnType<typeof mountHost>[] = []
afterEach(() => hosts.splice(0).forEach(host => host.unmount()))
const item = (value: string, disabled = false) => h(SelectItem, {
  key: value, value, disabled, testId: value,
  style: ({ highlighted }: SelectItemState) => ({ backgroundColor: highlighted ? "#ff0000" : "#ffffff" }),
}, () => h("text", value))
const highlighted = (host: ReturnType<typeof mountHost>) => host.all().filter(node =>
  (node.props.style as { backgroundColor?: string } | undefined)?.backgroundColor === "#ff0000"
).map(node => node.props.testId)

describe("Select Home/End mounted option navigation", () => {
  it("ignores closed Home/End and jumps to enabled edges from trigger or popup without selecting", async () => {
    const change = vi.fn()
    const host = mountHost(defineComponent(() => () => h(Select, { defaultValue: "middle", onValueChange: change }, {
      default: () => [h(SelectTrigger, { testId: "trigger" }, () => h("text", "choose")), h(SelectContent, { testId: "content" },
        () => [item("disabled-first", true), item("first"), item("middle"), item("last"), item("disabled-last", true)])],
    })))
    hosts.push(host)
    await host.fire("trigger", "keyDown", { key: "home" })
    await host.fire("trigger", "keyDown", { key: "end" })
    expect(host.all().some(node => node.props.testId === "content")).toBe(false)
    expect(change).not.toHaveBeenCalled()
    await host.fire("trigger", "click")
    expect(highlighted(host)).toEqual(["middle"])
    await host.fire("content", "keyDown", { key: "end" })
    expect(highlighted(host)).toEqual(["last"])
    await host.fire("trigger", "keyDown", { key: "home" })
    expect(highlighted(host)).toEqual(["first"])
    expect(change).not.toHaveBeenCalled()
    await host.fire("content", "keyDown", { key: "enter" })
    expect(change).toHaveBeenCalledExactlyOnceWith("first")
    expect(host.all().some(node => node.props.testId === "content")).toBe(false)
  })

  it("uses mounted items without Root.items and removes unmounted edges from navigation", async () => {
    const includeLast = ref(true)
    const host = mountHost(defineComponent(() => () => h(Select, { defaultOpen: true }, {
      default: () => [h(SelectTrigger, { testId: "trigger" }), h(SelectContent, { testId: "content" },
        () => [item("first"), item("middle"), ...(includeLast.value ? [item("last")] : [])])],
    })))
    hosts.push(host)
    await host.settle()
    await host.fire("content", "keyDown", { key: "end" })
    expect(highlighted(host)).toEqual(["last"])
    includeLast.value = false
    await host.settle()
    await host.fire("content", "keyDown", { key: "end" })
    expect(highlighted(host)).toEqual(["middle"])
    await host.fire("content", "keyDown", { key: "home" })
    expect(highlighted(host)).toEqual(["first"])
  })

  it("leaves all-disabled menus unchanged", async () => {
    const change = vi.fn()
    const host = mountHost(defineComponent(() => () => h(Select, { defaultOpen: true, onValueChange: change }, {
      default: () => [h(SelectTrigger, { testId: "trigger" }), h(SelectContent, { testId: "content" },
        () => [item("first", true), item("last", true)])],
    })))
    hosts.push(host)
    await host.settle()
    await host.fire("content", "keyDown", { key: "home" })
    await host.fire("content", "keyDown", { key: "end" })
    await host.fire("content", "keyDown", { key: "enter" })
    expect(change).not.toHaveBeenCalled()
    expect(highlighted(host)).toEqual([])
  })

  it("does not move or select enabled options after the root becomes disabled", async () => {
    const disabled = ref(false), change = vi.fn()
    const host = mountHost(defineComponent(() => () => h(Select, { defaultOpen: true, defaultValue: "middle", disabled: disabled.value, onValueChange: change }, {
      default: () => [h(SelectTrigger, { testId: "trigger" }), h(SelectContent, { testId: "content" },
        () => [item("first"), item("middle"), item("last")])],
    })))
    hosts.push(host)
    await host.settle()
    expect(highlighted(host)).toEqual(["middle"])
    disabled.value = true
    await host.settle()
    await host.fire("trigger", "keyDown", { key: "home" })
    await host.fire("content", "keyDown", { key: "end" })
    await host.fire("content", "keyDown", { key: "enter" })
    expect(change).not.toHaveBeenCalled()
    expect(highlighted(host)).toEqual(["middle"])
  })

  it("exposes Home/End through the Animal Select wrapper", async () => {
    const change = vi.fn()
    const host = mountHost(defineComponent(() => () => h(AnimalSelect, { testId: "animal", options: [
      { key: "first", label: "First" }, { key: "middle", label: "Middle" }, { key: "last", label: "Last" },
    ], defaultValue: "middle", onChange: change })))
    hosts.push(host)
    await host.fire("animal", "click")
    const layer = host.find(node => node.type === "anchored")
    expect(layer.props.side).toBe("right")
    expect(layer.props.align).toBe("center")
    expect(layer.props.gap).toBe(6)
    const content = host.find(node => typeof node.props.onKeyDown === "function" && node.props.autoFocus === true)
    await host.fire(content, "keyDown", { key: "end" })
    await host.fire(content, "keyDown", { key: "enter" })
    expect(change).toHaveBeenCalledExactlyOnceWith("last")
    await host.fire("animal", "click")
    await host.fire(host.find(node => typeof node.props.onKeyDown === "function" && node.props.autoFocus === true), "keyDown", { key: "home" })
    await host.fire(host.find(node => typeof node.props.onKeyDown === "function" && node.props.autoFocus === true), "keyDown", { key: "space" })
    expect(change.mock.calls.map(([value]) => value)).toEqual(["last", "first"])
  })
})
