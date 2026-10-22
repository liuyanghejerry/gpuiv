import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, nextTick, ref, type Ref } from "vue"
import { useWindowSize, useWindowInsets, type WindowSize } from "../hooks/use-window-size.js"
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

  it("syncs a later subscriber whose setup reading went stale before its mount", async () => {
    vi.useFakeTimers()
    // The shared group is created (and read) during the first setup; the
    // window then grows before the mounted hooks run, so the second child's
    // setup reading is already stale when it joins the running poll.
    const query = vi.fn().mockReturnValueOnce({ width: 800, height: 600 }).mockReturnValue({ width: 900, height: 600 })
    const sizes: Ref<WindowSize>[] = []
    const Child = defineComponent(() => { sizes.push(useWindowSize()); return () => h("div") })
    mount(defineComponent(() => () => h("div", [h(Child, { key: "a" }), h(Child, { key: "b" })])), { getWindowSize: query, applyBatch: () => [] })
    expect(query).toHaveBeenCalledTimes(2)
    expect(sizes.map(size => size.value.width)).toEqual([900, 900])
    // One poll still serves both.
    expect(vi.getTimerCount()).toBe(1)
  })
})

describe("window insets polling", () => {
  it("derives keyboard geometry from size and insets", async () => {
    vi.useFakeTimers()
    let insets: Ref<ReturnType<typeof useWindowInsets>> | undefined
    const renderer = {
      applyBatch: () => [],
      getWindowSize: () => ({ width: 1000, height: 800 }),
      getWindowInsets: () => ({
        safeArea: { top: 10, right: 0, bottom: 10, left: 0 },
        ime: { top: 0, right: 0, bottom: 300, left: 0 },
        effective: { top: 10, right: 0, bottom: 300, left: 0 },
      }),
    }
    mount(defineComponent(() => { insets = useWindowInsets({ intervalMs: false }); return () => h("div") }), renderer)
    expect(insets!.value).toEqual({
      safeArea: { top: 10, right: 0, bottom: 10, left: 0 },
      ime: { top: 0, right: 0, bottom: 300, left: 0 },
      effective: { top: 10, right: 0, bottom: 300, left: 0 },
      keyboardTop: 500,
      keyboardVisible: true,
      visibleHeight: 490,
    })
  })

  it("reads zero edges and the fallback size without native queries", () => {
    vi.useFakeTimers()
    let insets: Ref<ReturnType<typeof useWindowInsets>> | undefined
    mount(defineComponent(() => { insets = useWindowInsets({ intervalMs: false }); return () => h("div") }), null)
    expect(insets!.value).toEqual({
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      ime: { top: 0, right: 0, bottom: 0, left: 0 },
      effective: { top: 0, right: 0, bottom: 0, left: 0 },
      keyboardTop: 600,
      keyboardVisible: false,
      visibleHeight: 600,
    })
  })

  it("keeps the last good reading when a native query throws", () => {
    vi.useFakeTimers()
    let insets: Ref<ReturnType<typeof useWindowInsets>> | undefined
    const renderer = {
      applyBatch: () => [],
      getWindowSize: () => ({ width: 1000, height: 700 }),
      getWindowInsets: () => { throw new Error("window still opening") },
    }
    mount(defineComponent(() => { insets = useWindowInsets({ intervalMs: false }); return () => h("div") }), renderer)
    // The size query landed before the insets query threw, so the derived
    // keyboard geometry still uses the real height with zero edges.
    expect(insets!.value.keyboardTop).toBe(700)
    expect(insets!.value.keyboardVisible).toBe(false)
    expect(insets!.value.visibleHeight).toBe(700)
  })

  it("updates only when the numbers change, and stops with the last unmount", async () => {
    vi.useFakeTimers()
    let ime = 0
    let effectiveTop = 0
    const renderer = {
      applyBatch: () => [],
      getWindowSize: () => ({ width: 1000, height: 800 }),
      getWindowInsets: () => ({
        safeArea: { top: 10, right: 0, bottom: 10, left: 0 },
        ime: { top: 0, right: 0, bottom: ime, left: 0 },
        effective: { top: effectiveTop, right: 0, bottom: ime, left: 0 },
      }),
    }
    const count = ref(1)
    let insets: Ref<ReturnType<typeof useWindowInsets>> | undefined
    const Child = defineComponent(() => { insets = useWindowInsets(); return () => h("div") })
    const app = mount(defineComponent(() => () => h("div", Array.from({ length: count.value }, (_, key) => h(Child, { key })))), renderer)
    expect(vi.getTimerCount()).toBe(1)
    expect(insets!.value.keyboardVisible).toBe(false)
    expect(insets!.value.visibleHeight).toBe(800)

    // A keyboard appearing changes the derived geometry.
    ime = 300
    const before = insets!.value
    await vi.advanceTimersByTimeAsync(100)
    expect(insets!.value).not.toBe(before)
    expect(insets!.value.keyboardVisible).toBe(true)
    expect(insets!.value.keyboardTop).toBe(500)

    // An unchanged reading keeps the same object; no spurious flush.
    const steady = insets!.value
    await vi.advanceTimersByTimeAsync(300)
    expect(insets!.value).toBe(steady)

    // Safe-area-only changes reach the ref too.
    effectiveTop = 40
    await vi.advanceTimersByTimeAsync(100)
    expect(insets!.value.visibleHeight).toBe(460)

    // The poll dies with the last subscriber.
    count.value = 0
    await app.settle()
    expect(vi.getTimerCount()).toBe(0)
  })
})
