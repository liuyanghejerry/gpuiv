/// Unit tests for the renderer context hooks: what a provider supplies, the
/// null default without one, and the hard failure `useGpuixRequired` adds.

import { describe, expect, it } from "vitest"
import { defineComponent, h } from "vue"
import { useGpuix, useGpuixRequired } from "../hooks/use-gpuix.js"
import { createGpuivRendererHost, type GpuivRendererHost } from "../reconciler/vue-renderer.js"
import type { NativeRenderer } from "../types.js"
import { mountHeadless } from "./headless.js"

/** Mount through the real renderer host without providing the context. */
function mountWithoutProvider(
  component: unknown,
  onError?: (error: unknown) => void
): { host: GpuivRendererHost; unmount: () => void } {
  const native: NativeRenderer = { applyBatch: () => [] }
  const host = createGpuivRendererHost(native, { nextElementId: 0 })
  const app = host.vue.createApp(component as never)
  if (onError) app.config.errorHandler = (error) => onError(error)
  app.mount(host.container)
  host.flushMutations()
  return { host, unmount: () => { app.unmount(); host.flushMutations(); host.detach() } }
}

describe("useGpuix", () => {
  it("injects the headless provider's renderer into a component", () => {
    const seen: unknown[] = []
    const app = mountHeadless(
      defineComponent(() => {
        seen.push(useGpuix(), useGpuixRequired())
        return () => h("div")
      })
    )
    expect(seen[0]).toEqual({ renderer: app.renderer })
    // The required variant unwraps the same instance.
    expect(seen[1]).toBe(app.renderer)
    app.unmount()
  })

  it("falls back to a null renderer outside any provider", () => {
    const seen: unknown[] = []
    const mounted = mountWithoutProvider(
      defineComponent(() => {
        seen.push(useGpuix())
        return () => h("div")
      })
    )
    expect(seen).toEqual([{ renderer: null }])
    mounted.unmount()
  })
})

describe("useGpuixRequired", () => {
  it("throws in setup when no provider is above the component", () => {
    const errors: unknown[] = []
    const mounted = mountWithoutProvider(
      defineComponent(() => {
        useGpuixRequired()
        return () => h("div")
      }),
      (error) => errors.push(error)
    )
    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toMatch(/useGpuixRequired must be used within a GpuivProvider/)
    mounted.unmount()
  })
})
