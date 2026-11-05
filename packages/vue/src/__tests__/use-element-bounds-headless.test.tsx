/** Headless tests for useElementBounds: measurement through the renderer,
 *  change detection, the still-opening renderer keeping the previous reading,
 *  and the poll timer lifecycle. */

import { defineComponent, h, ref } from "vue"
import { describe, expect, it } from "vitest"
import { useElementBounds } from "../hooks/use-element-bounds.js"
import type { ElementBounds } from "../hooks/use-element-bounds.js"
import { mountHeadless } from "./headless.js"
import type { HeadlessRenderer } from "./headless.js"

type HeadlessApp = ReturnType<typeof mountHeadless>

function mountProbe(options: { intervalMs?: number | false } = {}) {
  const target = ref<{ id?: number } | null>(null)
  const handle = { value: null as ReturnType<typeof useElementBounds> | null }
  const Probe = defineComponent({
    setup() {
      handle.value = useElementBounds(target as never, options)
      return () => h("div", { ref: target })
    },
  })
  const app = mountHeadless(Probe)
  return { app, handle: handle as { value: NonNullable<typeof handle.value> }, renderer: app.renderer }
}

describe("useElementBounds (headless)", () => {
  it("measures once on mount and reports changes through measure()", async () => {
    const { app, handle, renderer } = mountProbe({ intervalMs: false })
    await app.settle()
    const id = app.container.children[0]!.id!

    renderer.elementBounds.set(id, { x: 1, y: 2, width: 30, height: 40 })
    expect(handle.value.measure()).toEqual({ x: 1, y: 2, width: 30, height: 40 })
    expect(handle.value.bounds.value).toEqual({ x: 1, y: 2, width: 30, height: 40 })

    renderer.elementBounds.set(id, { x: 5, y: 2, width: 30, height: 40 })
    expect(handle.value.measure()).toEqual({ x: 5, y: 2, width: 30, height: 40 })
    expect(handle.value.bounds.value?.x).toBe(5)

    // An identical reading does not replace the ref value.
    const before = handle.value.bounds.value
    handle.value.measure()
    expect(handle.value.bounds.value).toBe(before)
    app.unmount()
  })

  it("returns null before the element exists or has painted", async () => {
    const { app, handle, renderer } = mountProbe({ intervalMs: false })
    await app.settle()
    expect(handle.value.measure()).toBeNull()

    const id = app.container.children[0]!.id!
    // A renderer that has no box for the element yet answers null.
    expect(handle.value.measure()).toBeNull()
    renderer.elementBounds.set(id, { x: 0, y: 0, width: 10, height: 10 })
    expect(handle.value.measure()).toEqual({ x: 0, y: 0, width: 10, height: 10 })
    app.unmount()
  })

  it("keeps the previous reading when the renderer throws mid-open", async () => {
    const { app, handle, renderer } = mountProbe({ intervalMs: false })
    await app.settle()
    const id = app.container.children[0]!.id!
    const box: ElementBounds = { x: 3, y: 4, width: 50, height: 60 }
    renderer.elementBounds.set(id, box)
    expect(handle.value.measure()).toEqual(box)

    const original = renderer.getElementBounds.bind(renderer)
    ;(renderer as HeadlessRenderer).getElementBounds = () => {
      throw new Error("renderer is still opening")
    }
    try {
      expect(handle.value.measure(), "the stale reading survives the throw").toEqual(box)
      expect(handle.value.bounds.value).toEqual(box)
    } finally {
      ;(renderer as HeadlessRenderer).getElementBounds = original
    }
    app.unmount()
  })

  it("polls while mounted and stops on unmount", async () => {
    const { app, handle, renderer } = mountProbe({ intervalMs: 16 })
    await app.settle()
    const id = app.container.children[0]!.id!
    renderer.elementBounds.set(id, { x: 0, y: 0, width: 10, height: 10 })
    handle.value.measure()

    renderer.elementBounds.set(id, { x: 8, y: 0, width: 10, height: 10 })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(handle.value.bounds.value?.x, "the poll picked up the move").toBe(8)

    app.unmount()
    renderer.elementBounds.set(id, { x: 99, y: 0, width: 10, height: 10 })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(handle.value.bounds.value?.x, "the timer died with the component").toBe(8)
  })
})
