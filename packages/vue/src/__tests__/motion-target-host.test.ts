import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, nextTick, ref, type Component } from "vue"
import type { EventPayload } from "@gpuiv/native"
import { motion } from "../components/motion.js"
import { AnimatePresence } from "../components/animate-presence.js"
import { createGpuivRendererHost } from "../reconciler/vue-renderer.js"
import type { BoxShadow, HostNode, MotionStyle } from "../types.js"

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).reverse().forEach(fn => fn()))

function mount(component: Component) {
  const host = createGpuivRendererHost({ applyBatch: () => [] }, { nextElementId: 0 })
  const app = host.vue.createApp(component)
  app.mount(host.container)
  host.flushMutations()
  cleanups.push(() => { app.unmount(); host.flushMutations(); host.detach() })
  const all = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(all)]
  const node = () => all(host.container).find(node => node.props.motion)!
  return {
    node,
    target: () => node().props.motion as { generation: number; animate: MotionStyle; initial?: MotionStyle | false },
    complete: (generation: number) => host.registryContainer.eventHandlers.get(node().id!)?.get("motionComplete")?.({
      elementId: node().id!, eventType: "motionComplete", motionGeneration: generation,
    } as EventPayload),
    settle: async () => { await nextTick(); host.flushMutations(); await nextTick() },
    text: () => all(host.container).map(node => node.text).join(""),
  }
}

const shadow: BoxShadow = { offsetX: 0, offsetY: 2, blurRadius: 4, spreadRadius: 0, color: "#ff000080" }

describe("motion paint target generations", () => {
  it.each(["backgroundColor", "color", "borderColor"] as const)("retargets %s without accepting an earlier completion", async key => {
    const target = ref<MotionStyle>({ [key]: "red" }), completed = vi.fn()
    const app = mount(defineComponent(() => () => h(motion.div, { initial: false, animate: target.value, onMotionComplete: completed })))
    const previous = app.target().generation
    target.value = { [key]: "transparent" }
    await app.settle()
    expect(app.target().generation).toBeGreaterThan(previous)
    expect(app.target().animate).toEqual({ [key]: "transparent" })
    app.complete(previous)
    expect(completed).not.toHaveBeenCalled()
    app.complete(app.target().generation)
    expect(completed).toHaveBeenCalledOnce()
  })

  it("observes mutations inside a reused shadow list, including inset and color", async () => {
    const target = ref<MotionStyle>({ boxShadow: [{ ...shadow }] })
    const app = mount(defineComponent(() => () => h(motion.div, { initial: false, animate: target.value })))
    let previous = app.target().generation
    const first = (target.value.boxShadow as BoxShadow[])[0]!
    for (const update of [() => { first.offsetY = 6 }, () => { first.color = "transparent" }, () => { first.inset = true }, () => { (target.value.boxShadow as BoxShadow[]).push({ ...shadow }) }]) {
      update()
      await app.settle()
      expect(app.target().generation).toBeGreaterThan(previous)
      previous = app.target().generation
    }
    target.value.boxShadow = []
    await app.settle()
    expect(app.target().generation).toBeGreaterThan(previous)
    expect(app.target().animate.boxShadow).toEqual([])
  })

  it("keeps a color-only exit mounted until its own generation completes", async () => {
    const show = ref(true), exited = vi.fn()
    const app = mount(defineComponent(() => () => h(AnimatePresence, { onExitComplete: exited }, {
      default: () => show.value ? h(motion.div, {
        key: "paint", initial: false, animate: { backgroundColor: "red", boxShadow: shadow },
        exit: { backgroundColor: "transparent", boxShadow: [] },
      }, { default: () => h("text", "Color exit") }) : null,
    })))
    const enter = app.target().generation
    show.value = false
    await app.settle()
    const exit = app.target().generation
    expect(exit).toBeGreaterThan(enter)
    expect(app.target().animate).toEqual({ backgroundColor: "transparent", boxShadow: [] })
    app.complete(enter)
    await app.settle()
    expect(app.text()).toBe("Color exit")
    expect(exited).not.toHaveBeenCalled()
    app.complete(exit)
    await app.settle()
    expect(app.text()).toBe("")
    expect(exited).toHaveBeenCalledOnce()
  })

  it("distinguishes an omitted color from null and releases a previously owned color", async () => {
    const target = ref<MotionStyle>({})
    const app = mount(defineComponent(() => () => h(motion.div, { initial: false, animate: target.value })))
    const omitted = app.target().generation
    target.value = { color: null }
    await app.settle()
    expect(app.target().generation).toBeGreaterThan(omitted)
    expect(app.target().animate).toEqual({ color: null })
    target.value = { backgroundColor: "red", color: "blue", borderColor: "green" }
    await app.settle()
    const painted = app.target().generation
    target.value = { backgroundColor: null, color: null, borderColor: null }
    await app.settle()
    expect(app.target().generation).toBeGreaterThan(painted)
    expect(app.target().animate).toEqual({ backgroundColor: null, color: null, borderColor: null })
    const released = app.target().generation
    target.value = {}
    await app.settle()
    expect(app.target().generation).toBeGreaterThan(released)
  })

})
