/// mountHeadless for tests that need a NativeRenderer subclass injected:
/// canvas bridge stubs, scroll recorders, geometry answers. headless.ts
/// itself constructs its own HeadlessRenderer and stays untouched, so this
/// helper mirrors its wiring around a caller-supplied renderer.

import { nextTick } from "vue"
import type { App } from "vue"
import type { EventPayload } from "@gpuiv/native"
import type { NativeRenderer, HostNode } from "../types.js"
import { createGpuivRendererHost, type GpuivRendererHost } from "../reconciler/vue-renderer.js"
import { handleGpuixEvent, idAllocatorFor } from "../reconciler/event-registry.js"
import { GPUIV_CONTEXT } from "../hooks/use-gpuix.js"

export interface CustomRendererApp {
  app: App<HostNode>
  host: GpuivRendererHost
  container: HostNode
  /** Flush Vue's scheduler and push pending mutations into the renderer. */
  settle: () => Promise<void>
  unmount: () => void
  /** Dispatch one protocol event; true when a live handler consumed it. */
  dispatch: (payload: Partial<EventPayload> & { elementId: number; eventType: string }) => boolean
}

/** Mount a component through the real custom renderer onto `renderer`. */
export function mountWithRenderer(
  component: unknown,
  renderer: NativeRenderer
): CustomRendererApp {
  const host = createGpuivRendererHost(renderer, idAllocatorFor(renderer))
  const app = host.vue.createApp(component as never)
  app.provide(GPUIV_CONTEXT, { renderer })
  app.mount(host.container)
  host.flushMutations()
  return {
    app,
    host,
    container: host.container,
    settle: async () => {
      await nextTick()
      host.flushMutations()
    },
    unmount: () => {
      app.unmount()
      host.flushMutations()
    },
    dispatch: (payload) => handleGpuixEvent(payload as EventPayload, renderer),
  }
}
