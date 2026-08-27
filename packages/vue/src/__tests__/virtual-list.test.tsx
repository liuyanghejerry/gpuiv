/// Headless tests for the VirtualList windowing wrapper.
///
/// Mounts the component against a mock renderer, then dispatches the native
/// `visibleRange` event through the event registry (exactly as the Rust
/// virtual-list would) and asserts that only the visible window stays mounted.

import { defineComponent, h, ref, nextTick } from "vue"
import { describe, expect, it } from "vitest"
import type { NativeRenderer } from "../types.js"
import { createGpuivRendererHost } from "../reconciler/vue-renderer.js"
import { handleGpuixEvent } from "../reconciler/event-registry.js"
import { VirtualList } from "../components/virtual-list.js"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

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

function mount(component: unknown) {
  const mock = new MockRenderer()
  const host = createGpuivRendererHost(mock, { nextElementId: 0 })
  const app = host.vue.createApp(component as never)
  app.mount(host.container)
  host.flushMutations()
  return { mock, host, app }
}

function listId(applied: Op[]): number {
  const op = applied.find((o) => o[0] === "createElement" && o[2] === "virtual-list")
  if (!op) throw new Error("no virtual-list element")
  return op[1] as number
}

function windowStart(applied: Op[]): number | undefined {
  const op = applied.find(
    (o) => o[0] === "setCustomPropValue" && o[2] === "windowStart",
  )
  return op?.[3] as number | undefined
}

describe("virtual-list windowing", () => {
  it("mounts only the initial window of items", () => {
    const items = Array.from({ length: 100 }, (_, i) => i)
    const Comp = defineComponent({
      setup() {
        return () =>
          h(VirtualList, {
            itemCount: items.length,
            estimatedItemHeight: 40,
            overdraw: 100,
            renderItem: (i: number) => h("text", String(i)),
          })
      },
    })
    const { mock } = mount(Comp)
    const id = listId(mock.applied)

    // Window = ceil((800 + 200) / 40) = 25 rows, starting at 0.
    const texts = mock.applied
      .filter((o) => o[0] === "setText")
      .map((o) => o[2] as string)
    expect(texts.length).toBe(25)
    expect(texts[0]).toBe("0")
    expect(texts.at(-1)).toBe("24")
    expect(windowStart(mock.applied)).toBe(0)
    expect(mock.applied).toContainEqual(["setCustomPropValue", id, "itemCount", 100])
  })

  it("re-windows when the native visibleRange event arrives", async () => {
    const Comp = defineComponent({
      setup() {
        return () =>
          h(VirtualList, {
            itemCount: 100,
            estimatedItemHeight: 40,
            overdraw: 100,
            renderItem: (i: number) => h("text", `row${i}`),
          })
      },
    })
    const { mock, host } = mount(Comp)
    const id = listId(mock.applied)
    // Only assert on the re-window patch, not the initial mount batch.
    mock.applied.length = 0

    handleGpuixEvent(
      { elementId: id, eventType: "visibleRange", startIndex: 50, endIndex: 55 } as never,
      host.renderer,
    )
    await nextTick()
    host.flushMutations()

    const starts = mock.applied.filter(
      (o) => o[0] === "setCustomPropValue" && o[2] === "windowStart",
    )
    // 50 - pad(25) = 25
    expect(starts.at(-1)![3]).toBe(25)
    const texts = mock.applied
      .filter((o) => o[0] === "setText")
      .map((o) => o[2] as string)
    expect(texts).toContain("row25")
    expect(texts).toContain("row79")
    expect(texts).not.toContain("row0")
  })

  it("starts at the tail when followTail is set", () => {
    const Comp = defineComponent({
      setup() {
        return () =>
          h(VirtualList, {
            itemCount: 100,
            estimatedItemHeight: 40,
            overdraw: 100,
            followTail: true,
            renderItem: (i: number) => h("text", `row${i}`),
          })
      },
    })
    const { mock } = mount(Comp)
    expect(windowStart(mock.applied)).toBe(75)
  })
})

/// GPU-backed tests for the native windowed-mode contract: unmounted rows
/// keep estimatedItemHeight, and itemCount without an estimate is ignored.
const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("virtual-list native windowing", () => {
  it("keeps estimated height for rows Vue has not mounted", async () => {
    const startAt = (start: number) =>
      defineComponent({
        setup: () => () =>
          h(
            "virtual-list",
            {
              itemCount: 1000,
              windowStart: start,
              overdraw: 0,
              estimatedItemHeight: 40,
              style: { width: 400, height: 160 },
            },
            Array.from({ length: 8 }, (_, offset) =>
              h(
                "div",
                {
                  key: start + offset,
                  style: { display: "flex", height: 40, flexShrink: 0, alignItems: "center" },
                },
                `row-${start + offset}`,
              ),
            ),
          ),
      })
    const app = createTestApp(startAt(0))
    const list = app.renderer.findByType("virtual-list")[0]!
    app.renderer.scrollToItem(list.id, 50)
    app.renderer.scrollToItem(list.id, 80)
    await app.settle()

    const offset = app.renderer.getScrollOffset(list.id)?.[1] ?? 0
    expect(offset).toBeCloseTo(-80 * 40, 0)
    app.unmount()
  })

  it("ignores itemCount when estimatedItemHeight is missing", async () => {
    const App = defineComponent({
      setup: () => () =>
        h(
          "virtual-list",
          { itemCount: 1000, windowStart: 0, style: { width: 400, height: 160 } },
          Array.from({ length: 8 }, (_, index) =>
            h(
              "div",
              {
                key: index,
                style: { display: "flex", height: 40, flexShrink: 0, alignItems: "center" },
              },
              `row-${index}`,
            ),
          ),
        ),
    })
    const app = createTestApp(App)
    const list = app.renderer.findByType("virtual-list")[0]!
    app.renderer.scrollToItem(list.id, 80)
    await app.settle()

    // Without the estimate, itemCount is ignored: the list stays on its 8
    // mounted children and the scroll clamps to their extent.
    expect(app.renderer.getAllText()).toHaveLength(8)
    expect(app.renderer.getPaintedText().some((line) => line.startsWith("row-"))).toBe(true)
    app.unmount()
  })
})

