import { defineComponent, h, onMounted, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Button } from "../src/components/Button.js"
import { Typewriter } from "../src/components/Typewriter.js"
import { mountHost } from "./harness.js"

const hosts: ReturnType<typeof mountHost>[] = []
function mount(component: Parameters<typeof mountHost>[0]) {
  const host = mountHost(component)
  hosts.push(host)
  return host
}
afterEach(() => { hosts.splice(0).forEach(host => host.unmount()); vi.useRealTimers() })

describe("React Typewriter children through Vue component slots", () => {
  it("types Button default content and preserves its click handler", async () => {
    vi.useFakeTimers()
    const click = vi.fn(), done = vi.fn()
    const host = mount(defineComponent(() => () => h(Typewriter, { speed: 10, onDone: done }, {
      default: () => h(Button, { testId: "typed-button", onClick: click }, { default: () => h("text", "AB") }),
    })))
    expect(host.text()).toBe("")
    await vi.advanceTimersByTimeAsync(10)
    await host.settle()
    expect(host.text()).toBe("A")
    await vi.advanceTimersByTimeAsync(10)
    await host.settle()
    expect(host.text()).toBe("AB")
    expect(done).toHaveBeenCalledOnce()
    await host.fire("typed-button", "click")
    expect(click).toHaveBeenCalledOnce()
  })

  it("preserves named slots and component state while recursively typing default slots", async () => {
    vi.useFakeTimers()
    const mounted = vi.fn(), click = vi.fn()
    const Leaf = defineComponent({
      setup(_, { slots }) {
        onMounted(mounted)
        return () => h("div", { testId: "leaf", onClick: click }, [slots.icon?.(), slots.default?.()])
      },
    })
    const Parent = defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) })
    const host = mount(defineComponent(() => () => h(Typewriter, { speed: 10 }, {
      default: () => h(Parent, {}, {
        default: () => h(Leaf, {}, { icon: () => h("text", "★"), default: () => h("text", "岛屿") }),
      }),
    })))
    expect(host.text()).toBe("★")
    await vi.advanceTimersByTimeAsync(10)
    await host.settle()
    expect(host.text()).toBe("★ 岛")
    await vi.advanceTimersByTimeAsync(10)
    await host.settle()
    expect(host.text()).toBe("★ 岛屿")
    expect(mounted).toHaveBeenCalledOnce()
    await host.fire("leaf", "click")
    expect(click).toHaveBeenCalledOnce()
  })

  it("shares the character budget between component children and later siblings", async () => {
    vi.useFakeTimers()
    const Child = defineComponent({ setup: (_, { slots }) => () => h("text", slots.default?.()) })
    const host = mount(defineComponent(() => () => h(Typewriter, { speed: 10 }, {
      default: () => [h(Child, {}, { default: () => "AB" }), h("text", "CD")],
    })))
    await vi.advanceTimersByTimeAsync(20)
    await host.settle()
    expect(host.text()).toBe("AB")
    await vi.advanceTimersByTimeAsync(10)
    await host.settle()
    expect(host.text()).toBe("AB C")
    await vi.advanceTimersByTimeAsync(10)
    await host.settle()
    expect(host.text()).toBe("AB CD")
  })

  it("autoPlay false renders component content immediately and reports completion once", async () => {
    vi.useFakeTimers()
    const done = vi.fn(), color = ref("#ffffff")
    const host = mount(defineComponent(() => () => h(Typewriter, { autoPlay: false, onDone: done }, {
      default: () => h(Button, { style: { color: color.value } }, { default: () => h("text", "完成") }),
    })))
    await host.settle()
    expect(host.text()).toBe("完成")
    expect(done).toHaveBeenCalledOnce()
    color.value = "#000000"
    await host.settle()
    expect(done).toHaveBeenCalledOnce()
  })

  it("replays when component slot text changes length after the previous run finishes", async () => {
    vi.useFakeTimers()
    const value = ref("AB"), done = vi.fn()
    const host = mount(defineComponent(() => () => h(Typewriter, { speed: 10, onDone: done }, {
      default: () => h(Button, {}, { default: () => h("text", value.value) }),
    })))
    await vi.advanceTimersByTimeAsync(20)
    await host.settle()
    expect(host.text()).toBe("AB")
    value.value = "CDEF"
    await host.settle()
    expect(host.text()).toBe("")
    await vi.advanceTimersByTimeAsync(40)
    await host.settle()
    expect(host.text()).toBe("CDEF")
    expect(done).toHaveBeenCalledTimes(2)
  })
})
