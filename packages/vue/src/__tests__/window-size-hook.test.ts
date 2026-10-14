import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, nextTick, ref, type Ref } from "vue"
import { useWindowSize, type WindowSize } from "../hooks/use-window-size.js"
import { GPUIV_CONTEXT } from "../hooks/use-gpuix.js"
import { createGpuivRendererHost } from "../reconciler/vue-renderer.js"
import type { NativeRenderer } from "../types.js"

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); vi.useRealTimers() })
function mount(component: ReturnType<typeof defineComponent>, renderer: NativeRenderer | null) {
  const native = renderer ?? { applyBatch: () => [] }
  const host = createGpuivRendererHost(native, { nextElementId: 0 })
  const app = host.vue.createApp(component)
  app.provide(GPUIV_CONTEXT, { renderer })
  app.mount(host.container)
  host.flushMutations()
  const unmount = () => { app.unmount(); host.flushMutations(); host.detach() }
  cleanups.push(unmount)
  return { host, settle: async () => { await nextTick(); host.flushMutations() }, unmount }
}

describe("shared window-size polling", () => {
  it("uses one query and flush for equal cadences, while keeping writable refs independent", async () => {
    vi.useFakeTimers()
    let width = 800
    const query = vi.fn(() => ({ width, height: 600 }))
    const batch = vi.fn(() => [])
    const sizes: Ref<WindowSize>[] = []
    const Child = defineComponent(() => {
      const size = useWindowSize()
      sizes.push(size)
      return () => h("div", { style: { width: size.value.width } })
    })
    const app = mount(defineComponent(() => () => h("div", Array.from({ length: 6 }, (_, key) => h(Child, { key })))), { getWindowSize: query, applyBatch: batch })
    expect(query).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)
    sizes[0]!.value.width = 123
    expect(sizes[1]!.value.width).toBe(800)
    batch.mockClear()
    width = 900
    await vi.advanceTimersByTimeAsync(100)
    await app.settle()
    expect(query).toHaveBeenCalledTimes(3)
    expect(sizes.map(size => size.value.width)).toEqual(Array(6).fill(900))
    expect(batch).toHaveBeenCalledOnce()
  })

  it("shares with later subscribers and releases the timer after the last unmount", async () => {
    vi.useFakeTimers()
    const query = vi.fn(() => ({ width: 900, height: 600 }))
    const count = ref(1)
    const Child = defineComponent(() => { useWindowSize(); return () => h("div") })
    const app = mount(defineComponent(() => () => h("div", Array.from({ length: count.value }, (_, key) => h(Child, { key })))), { getWindowSize: query, applyBatch: () => [] })
    count.value = 3
    await app.settle()
    expect(query).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)
    count.value = 0
    await app.settle()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(300)
    expect(query).toHaveBeenCalledTimes(2)
    count.value = 1
    await app.settle()
    expect(query).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(1)
  })

  it("isolates renderers and different intervals", async () => {
    vi.useFakeTimers()
    const first = vi.fn(() => ({ width: 700, height: 500 })), second = vi.fn(() => ({ width: 900, height: 600 }))
    const values: Ref<WindowSize>[] = []
    const Child = defineComponent({ props: { interval: Number }, setup(props) { values.push(useWindowSize({ intervalMs: props.interval })); return () => h("div") } })
    mount(defineComponent(() => () => h("div", [h(Child, { interval: 100 }), h(Child, { interval: 250 })])), { getWindowSize: first, applyBatch: () => [] })
    mount(defineComponent(() => () => h(Child, { interval: 100 })), { getWindowSize: second, applyBatch: () => [] })
    expect(vi.getTimerCount()).toBe(3)
    await vi.advanceTimersByTimeAsync(250)
    expect(first).toHaveBeenCalledTimes(7)
    expect(second).toHaveBeenCalledTimes(4)
    expect(values.map(value => value.value.width)).toEqual([700, 700, 900])
  })

  it("retries an opening-window fallback on mount and honours interval=false", async () => {
    vi.useFakeTimers()
    let size: Ref<WindowSize> | undefined
    const query = vi.fn().mockReturnValueOnce(null).mockReturnValue({ width: 1200, height: 800 })
    mount(defineComponent(() => { size = useWindowSize({ intervalMs: false }); return () => h("div") }), { getWindowSize: query, applyBatch: () => [] })
    expect(size!.value).toEqual({ width: 1200, height: 800 })
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(query).toHaveBeenCalledTimes(2)
  })

  it("does not allocate a useless timer without a native size query", () => {
    vi.useFakeTimers()
    let size: Ref<WindowSize> | undefined
    mount(defineComponent(() => { size = useWindowSize(); return () => h("div") }), null)
    expect(size!.value).toEqual({ width: 800, height: 600 })
    expect(vi.getTimerCount()).toBe(0)
  })
})
