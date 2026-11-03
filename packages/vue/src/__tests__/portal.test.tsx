/** GPU-backed portal tests: content sent through Vue's built-in `<Teleport>`
 *  into a host element actually paints inside the target's box, in key order,
 *  and its elements are freed when the portal unmounts. The structural twin
 *  (protocol ops, ordering, identity) is portal-headless.test.tsx. */

import { defineComponent, h, reactive, ref } from "vue"
import { Teleport } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import type { HostNode } from "../types.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const state = reactive({ items: [] as string[], mounted: true })

const Screen = defineComponent({
  setup() {
    const layer = ref<HostNode | null>(null)
    return () =>
      h("div", { style: { width: 200, height: 200 } }, [
        h("div", { ref: layer, testId: "layer", style: { width: 100, height: 100 } }),
        h("div", { testId: "lexical-parent" }, [
          state.mounted && layer.value
            ? h(
                Teleport,
                { to: layer.value },
                () => state.items.map((item) => h("text", { key: item, testId: `item-${item}` }, item))
              )
            : null,
        ]),
      ])
  },
})

describeNative("Teleport portals (gpu)", () => {
  it("paints portal children inside the target, in key order", async () => {
    state.items = ["a", "b"]
    state.mounted = true
    const app = createTestApp(Screen)
    await app.settle()
    try {
      const layer = app.renderer.findByTestId("layer")!
      const layerBox = app.renderer.getElementBounds(layer.id!)!
      const ids = ["a", "b"].map((item) => app.renderer.findByTestId(`item-${item}`)!.id!)

      expect(app.renderer.getPaintedText()).toEqual(["a", "b"])
      for (const id of ids) {
        const box = app.renderer.getElementBounds(id)!
        expect(
          box.x >= layerBox.x && box.y >= layerBox.y &&
            box.x + box.width <= layerBox.x + layerBox.width &&
            box.y + box.height <= layerBox.y + layerBox.height,
          `portal child ${id} must paint inside the layer box ${JSON.stringify(layerBox)}, got ${JSON.stringify(box)}`
        ).toBe(true)
      }
      expect(app.renderer.findByTestId("lexical-parent")!.children.length).toBe(0)

      // Key insertion keeps order and neighbour identity.
      const bId = ids[1]
      state.items = ["a", "b", "c"]
      await app.settle()
      state.items = ["a", "b", "x", "c"]
      await app.settle()
      const order = ["a", "b", "x", "c"].map(
        (item) => app.renderer.findByTestId(`item-${item}`)!.id!
      )
      expect(app.renderer.getPaintedText()).toEqual(["a", "b", "x", "c"])
      expect(order[1]).toBe(bId)
    } finally {
      app.unmount()
    }
  })

  it("frees the portal's elements when it unmounts", async () => {
    state.items = ["a", "b"]
    state.mounted = false
    const app = createTestApp(Screen)
    await app.settle()
    try {
      // The Teleport never mounted: this is the tree without it.
      const without = app.renderer.getRetainedElementCount()

      state.mounted = true
      await app.settle()
      expect(app.renderer.getRetainedElementCount()).toBeGreaterThan(without)

      state.mounted = false
      await app.settle()
      expect(app.renderer.findByTestId("item-a")).toBeUndefined()
      expect(app.renderer.getRetainedElementCount()).toBe(without)
    } finally {
      app.unmount()
    }
  })
})
