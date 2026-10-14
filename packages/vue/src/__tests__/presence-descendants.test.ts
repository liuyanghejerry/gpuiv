import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, nextTick, ref, type Component } from "vue"
import { AnimatePresence, usePresence, type SafeToRemove } from "../components/animate-presence.js"
import { motion } from "../components/motion.js"
import { createGpuivRendererHost } from "../reconciler/vue-renderer.js"
import type { HostNode } from "../types.js"

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).reverse().forEach(fn => fn()))
function mount(component: Component) {
  const host = createGpuivRendererHost({ applyBatch: () => [] }, { nextElementId: 0 })
  const app = host.vue.createApp(component)
  app.mount(host.container)
  host.flushMutations()
  cleanups.push(() => { app.unmount(); host.flushMutations(); host.detach() })
  const all = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(all)]
  return { text: () => all(host.container).map(node => node.text).join(""), settle: async () => { await nextTick(); host.flushMutations(); await nextTick() } }
}

describe("presence descendant completion", () => {
  it("closes multiple motion descendants without exit tracks without a reactive loop", async () => {
    const show = ref(true), exited = vi.fn()
    const app = mount(defineComponent(() => () => h(AnimatePresence, { onExitComplete: exited }, { default: () => show.value ? h("div", { key: "panel" }, [
      h(motion.div, { initial: false, animate: { top: 0 } }, { default: () => h("text", "Cancel") }),
      h(motion.div, { initial: false, animate: { top: 0 } }, { default: () => h("text", "Confirm") }),
    ]) : null })))
    show.value = false
    await app.settle()
    expect(app.text()).toBe("")
    expect(exited).toHaveBeenCalledOnce()
  })

  it("waits for every participant and clears completed state when the subtree reenters", async () => {
    const show = ref(true), exited = vi.fn(), reports: SafeToRemove[] = []
    const Child = defineComponent({ props: { label: String }, setup(props) {
      reports.push(usePresence().safeToRemove!)
      return () => h("text", props.label)
    } })
    const app = mount(defineComponent(() => () => h(AnimatePresence, { onExitComplete: exited }, { default: () => show.value ? h("div", { key: "panel" }, [h(Child, { label: "A" }), h(Child, { label: "B" })]) : null })))
    show.value = false
    await app.settle()
    reports[0]!()
    await app.settle()
    expect(app.text()).toBe("AB")
    expect(exited).not.toHaveBeenCalled()
    show.value = true
    await app.settle()
    show.value = false
    await app.settle()
    reports[1]!()
    await app.settle()
    expect(app.text()).toBe("AB")
    reports[0]!()
    reports[0]!()
    await app.settle()
    expect(app.text()).toBe("")
    expect(exited).toHaveBeenCalledOnce()
  })

  it("releases a completed subtree when its last pending participant unmounts", async () => {
    const show = ref(true), count = ref(2), reports: SafeToRemove[] = []
    const Child = defineComponent(() => { reports.push(usePresence().safeToRemove!); return () => h("text", "Child") })
    const Panel = defineComponent(() => () => h("div", Array.from({ length: count.value }, (_, key) => h(Child, { key }))))
    const app = mount(defineComponent(() => () => h(AnimatePresence, null, { default: () => show.value ? h(Panel, { key: "panel" }) : null })))
    show.value = false
    await app.settle()
    reports[0]!()
    await app.settle()
    expect(app.text()).toBe("ChildChild")
    count.value = 1
    await app.settle()
    await app.settle()
    expect(app.text()).toBe("")
  })
})
