import { nextTick, type Component } from "vue"
import { createGpuivRendererHost, GPUIV_CONTEXT, type HostNode, type NativeRenderer, type EventPayload } from "@gpuiv/vue"
import { handleGpuixEvent } from "../../vue/src/reconciler/event-registry.js"

/** Exercise Vue and the actual GPUIV mutation/event protocol without GPU paint. */
export function mountHost(component: Component, overrides: Partial<NativeRenderer> = {}) {
  const operations: unknown[][] = []
  const retained = new Map<number, { parent: number | null; children: Set<number> }>()
  let focused: number | null = null
  const native: NativeRenderer = {
    applyBatch(json) {
      const batch = JSON.parse(json) as unknown[][]
      operations.push(...batch)
      const destroyed = new Set<number>()
      const remove = (id: number) => {
        const node = retained.get(id)
        if (!node) return
        for (const child of [...node.children]) remove(child)
        if (node.parent != null) retained.get(node.parent)?.children.delete(id)
        retained.delete(id)
        destroyed.add(id)
      }
      for (const [op, a, b] of batch) {
        if (op === "createElement") retained.set(a as number, { parent: null, children: new Set() })
        if (op === "appendChild" || op === "insertBefore") {
          const child = retained.get(b as number)
          if (!child) continue
          if (child.parent != null) retained.get(child.parent)?.children.delete(b as number)
          child.parent = a as number
          retained.get(a as number)?.children.add(b as number)
        }
        if (op === "destroyElement") remove(a as number)
      }
      return [...destroyed]
    },
    getWindowSize: () => ({ width: 1000, height: 800 }),
    getElementBounds: () => ({ x: 0, y: 0, width: 600, height: 300 }),
    focusElement: (id) => { focused = id },
    getFocusedElementId: () => focused,
    ...overrides,
  }
  const host = createGpuivRendererHost(native, { nextElementId: 0 })
  const app = host.vue.createApp(component)
  app.provide(GPUIV_CONTEXT, { renderer: native })
  app.mount(host.container)
  host.flushMutations()

  function all(): HostNode[] {
    const walk = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(walk)]
    return walk(host.container)
  }
  function find(target: string | ((node: HostNode) => boolean)): HostNode {
    const result = all().find(typeof target === "string" ? (node) => node.props.testId === target : target)
    if (!result) throw new Error(`Host element not found: ${String(target)}`)
    return result
  }
  async function settle() { await nextTick(); host.flushMutations(); await nextTick() }
  async function fire(target: string | HostNode, eventType: string, payload: Partial<EventPayload> = {}) {
    const node = typeof target === "string" ? find(target) : target
    handleGpuixEvent({ elementId: node.id!, eventType, ...payload } as EventPayload, native)
    await settle()
  }
  function unmount() { app.unmount(); host.flushMutations(); host.detach() }
  return { app, host, native, operations, all, find, settle, fire, unmount,
    text: () => all().map((node) => node.text).filter(Boolean).join(" "),
  }
}
