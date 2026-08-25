/// Headless tests for the Vue custom renderer core.
///
/// These do not need the native addon: a mock NativeRenderer records the
/// mutation stream that `applyBatch` would receive, so we can assert on the
/// exact protocol emitted by mount/update/remove flows.

import { beforeEach, describe, expect, it } from "vitest"
import { defineComponent, h, ref, nextTick } from "vue"
import type { NativeRenderer } from "../types.js"
import { createGpuivRendererHost, toGpuixStyle } from "../reconciler/vue-renderer.js"

type Op = unknown[]

class MockRenderer implements NativeRenderer {
  applied: Op[] = []
  private ops: Op[] = []

  batch(): void {
    if (this.ops.length === 0) return
    this.applied.push(...JSON.parse(JSON.stringify(this.ops)))
    this.ops = []
  }

  createElement(id: number, elementType: string): void {
    this.ops.push(["createElement", id, elementType])
  }
  destroyElement(id: number): number[] {
    this.ops.push(["destroyElement", id])
    return []
  }
  appendChild(parentId: number, childId: number): void {
    this.ops.push(["appendChild", parentId, childId])
  }
  removeChild(parentId: number, childId: number): void {
    this.ops.push(["removeChild", parentId, childId])
  }
  insertBefore(parentId: number, childId: number, beforeId: number): void {
    this.ops.push(["insertBefore", parentId, childId, beforeId])
  }
  setStyle(id: number, styleJson: string | object): void {
    this.ops.push(["setStyle", id, styleJson])
  }
  setText(id: number, content: string): void {
    this.ops.push(["setText", id, content])
  }
  setEventListener(id: number, eventType: string, hasHandler: boolean): void {
    this.ops.push(["setEventListener", id, eventType, hasHandler])
  }
  setRoot(id: number): void {
    this.ops.push(["setRoot", id])
  }
  commitMutations(): void {
    this.batch()
  }
  setCustomProp(
    id: number,
    key: string,
    value: string | object | number | boolean | null
  ): void {
    this.ops.push(["setCustomPropValue", id, key, value])
  }
  applyBatch(json: string): number[] {
    for (const op of JSON.parse(json) as Op[]) this.ops.push(op)
    this.batch()
    return []
  }
}

function mountApp(component: unknown) {
  const mock = new MockRenderer()
  const host = createGpuivRendererHost(mock, { nextElementId: 0 })
  const app = host.vue.createApp(component as never)
  app.mount(host.container)
  host.flushMutations()
  return { mock, host, app }
}

describe("vue renderer core", () => {
  it("mounts a div with a text child through the mutation protocol", () => {
    const Comp = defineComponent({
      setup: () => () => h("div", { style: { width: 100 } }, [h("span", "hello")]),
    })
    const { mock } = mountApp(Comp)
    const applied = mock.applied

    expect(applied).toContainEqual(["setRoot", 1])
    const creates = applied.filter((op) => op[0] === "createElement")
    expect(new Set(creates.map((op) => op[1]))).toEqual(new Set([1, 2, 3]))
    expect(applied).toContainEqual(["setStyle", 2, { width: 100 }])
    expect(applied).toContainEqual(["appendChild", 2, 3])
    expect(applied).toContainEqual(["appendChild", 1, 2])
    expect(applied).toContainEqual(["setText", 3, "hello"])

    // Protocol invariant: a parent is created before any child attaches to it.
    for (const op of applied.filter((o) => o[0] === "appendChild" || o[0] === "insertBefore")) {
      const parentId = op[1] as number
      const parentCreate = applied.findIndex((o) => o[0] === "createElement" && o[1] === parentId)
      expect(parentCreate).toBeGreaterThanOrEqual(0)
      expect(applied.indexOf(op)).toBeGreaterThan(parentCreate)
    }
  })

  it("writes a single string child as element text content", () => {
    const Comp = defineComponent({
      setup: () => () => h("div", "just text"),
    })
    const { mock } = mountApp(Comp)
    expect(mock.applied).toContainEqual(["setText", 2, "just text"])
  })

  it("normalizes kebab-case style keys to camelCase", () => {
    expect(toGpuixStyle({ "font-size": 12, backgroundColor: "#fff", "--x": 1 })).toEqual({
      fontSize: 12,
      backgroundColor: "#fff",
    })
    expect(toGpuixStyle("padding:12px;color:red")).toEqual({
      padding: "12px",
      color: "red",
    })
    expect(toGpuixStyle([{ width: 1 }, { height: 2 }])).toEqual({ width: 1, height: 2 })
  })

  it("registers events and updates text on state change", async () => {
    const count = ref(0)
    const events: string[] = []
    const Comp = defineComponent({
      setup: () => () =>
        h(
          "div",
          {
            onClick: () => {
              count.value++
            },
            testId: "btn",
          },
          String(count.value)
        ),
    })
    const { mock, host } = mountApp(Comp)

    expect(mock.applied).toContainEqual(["setEventListener", 2, "click", true])
    expect(mock.applied).toContainEqual(["setCustomPropValue", 2, "testId", "btn"])

    // Fire a native click event as the Rust side would.
    const { handleGpuixEvent } = await import("../reconciler/event-registry.js")
    handleGpuixEvent(
      { elementId: 2, eventType: "click" } as never,
      host.renderer
    )
    await nextTick()
    expect(count.value).toBe(1)

    host.flushMutations()
    expect(mock.applied).toContainEqual(["setText", 2, "1"])
  })

  it("removes destroyed subtrees on unmount", () => {
    const Comp = defineComponent({
      setup: () => () => h("div", [h("span", "a"), h("span", "b")]),
    })
    const { mock, host, app } = mountApp(Comp)
    app.unmount()
    host.flushMutations()
    expect(mock.applied).toContainEqual(["removeChild", 1, 2])
    expect(mock.applied).toContainEqual(["destroyElement", 2])
  })

  it("mounts fragment children without sending null ids to Rust", () => {
    const Comp = defineComponent({
      setup: () => () => h("div", [h("span", "a"), "between", h("span", "b")]),
    })
    const { mock } = mountApp(Comp)
    for (const op of mock.applied) {
      expect(op).not.toContain(null)
    }
    // root div + 3 children (span, text node, span)
    expect(mock.applied.filter((o) => o[0] === "appendChild")).toHaveLength(4)
  })

  it("keeps keyed list order when children are reordered", async () => {
    // Interpret the mutation stream into per-parent child id lists,
    // mirroring Rust's RetainedTree semantics.
    function interpret(applied: Op[]): Map<number, number[]> {
      const kids = new Map<number, number[]>()
      const ensure = (id: number): number[] => {
        if (!kids.has(id)) kids.set(id, [])
        return kids.get(id)!
      }
      for (const op of applied) {
        if (op[0] === "appendChild") {
          const arr = ensure(op[1] as number)
          const id = op[2] as number
          const i = arr.indexOf(id)
          if (i !== -1) arr.splice(i, 1)
          arr.push(id)
        } else if (op[0] === "insertBefore") {
          const arr = ensure(op[1] as number)
          const id = op[2] as number
          const before = op[3] as number
          const i = arr.indexOf(id)
          if (i !== -1) arr.splice(i, 1)
          const at = arr.indexOf(before)
          arr.splice(at === -1 ? arr.length : at, 0, id)
        } else if (op[0] === "removeChild") {
          const arr = ensure(op[1] as number)
          const id = op[2] as number
          const i = arr.indexOf(id)
          if (i !== -1) arr.splice(i, 1)
        } else if (op[0] === "createElement") {
          ensure(op[1] as number)
        }
      }
      return kids
    }

    const items = ref([{ id: 1 }, { id: 2 }, { id: 3 }])
    const Comp = defineComponent({
      setup: () => () =>
        h(
          "div",
          items.value.map((i) => h("span", { key: i.id }, String(i.id)))
        ),
    })
    const { mock, host } = mountApp(Comp)

    items.value = [{ id: 2 }, { id: 3 }, { id: 1 }]
    await nextTick()
    host.flushMutations()

    const kids = interpret(mock.applied)
    // div 2 holds the spans; expect item2, item3, item1 in that order.
    expect(kids.get(2)).toHaveLength(3)
    expect(kids.get(2)!.length).toBe(3)
    // Spans were created in order id3=item1, id4=item2, id5=item3.
    expect(kids.get(2)).toEqual([4, 5, 3])
  })
})
