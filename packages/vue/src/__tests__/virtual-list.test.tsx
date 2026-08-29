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
import type { VirtualListInstance } from "../components/virtual-list.js"
import { GPUIV_CONTEXT } from "../hooks/use-gpuix.js"
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

/// GPU-backed tests for the pinning / anchoring port (upstream 01f5788,
/// ae4766f, 329a52f): top pin on prepend, the followTail hole, and the
/// pixel-stable scrollToItem/getListScrollTop pair.
describeNative("virtual-list pinning and anchoring", () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      h(
        "div",
        {
          key: index,
          style: { display: "flex", height: 40, flexShrink: 0, alignItems: "center" },
        },
        `row-${index}`,
      ),
    )

  // gpui anchors a list on a logical item, so a prepend keeps the rows that
  // are already on screen and pushes the new ones above the viewport. A
  // browser does the same, except that it suppresses scroll anchoring at
  // scrollTop 0. A list pinned to the top must match the browser, or a
  // prepend is never seen.
  //
  // This only bites once the content is taller than the viewport. While it is
  // shorter, gpui re-anchors to item 0 on every layout and hides the drift.
  const growable = (followTail: boolean) => {
    const count = ref(2)
    const App = defineComponent({
      setup: () => () =>
        h(
          "virtual-list",
          {
            overdraw: 0,
            estimatedItemHeight: 40,
            style: { width: 400, height: 160 },
            ...(followTail ? { followTail: true } : {}),
          },
          Array.from({ length: count.value }, (_, index) =>
            h(
              "div",
              {
                key: count.value - index,
                style: { display: "flex", height: 40, flexShrink: 0, alignItems: "center" },
              },
              `row-${count.value - index}`,
            ),
          ),
        ),
    })
    return { App, count }
  }

  it("stays at the top when rows are prepended past the viewport", async () => {
    const { App, count } = growable(false)
    const app = createTestApp(App)
    await app.settle()
    expect(app.renderer.getPaintedText()[0]).toBe("row-2")

    for (let next = 3; next <= 12; next += 1) {
      count.value = next
      await app.settle()
      expect(app.renderer.getPaintedText()[0], `after ${next} rows`).toBe(`row-${next}`)
    }
    app.unmount()
  })

  it("keeps following the tail on a short list that is pinned at the top", async () => {
    // A following list that does not fill its viewport ends layout anchored at
    // {0, 0}, which reads exactly like "the user is at the top". Pinning it
    // there would call stop_following and break the chat tail.
    const count = ref(2)
    const App = defineComponent({
      setup: () => () =>
        h(
          "virtual-list",
          {
            followTail: true,
            overdraw: 0,
            estimatedItemHeight: 40,
            style: { width: 400, height: 160 },
          },
          rows(count.value),
        ),
    })
    const app = createTestApp(App)
    await app.settle()
    count.value = 3
    await app.settle()
    count.value = 12
    await app.settle()
    expect(app.renderer.getPaintedText()).toContain("row-11")
    expect(app.renderer.getPaintedText()).not.toContain("row-0")
    app.unmount()
  })

  it("keeps the scroll anchor when rows are prepended below the top", async () => {
    const { App, count } = growable(false)
    const app = createTestApp(App)
    count.value = 12
    await app.settle()
    const list = app.renderer.findByType("virtual-list")[0]!
    app.renderer.scrollToItem(list.id, 5)
    expect(app.renderer.getPaintedText()[0]).toBe("row-7")

    // Away from the top, a prepend must not move the rows under the pointer.
    count.value = 13
    await app.settle()
    expect(app.renderer.getPaintedText()[0]).toBe("row-7")
    app.unmount()
  })

  it("scrolls to an item with a pixel offset and reports the logical anchor", async () => {
    const App = defineComponent({
      setup: () => () =>
        h(
          "virtual-list",
          { overdraw: 0, estimatedItemHeight: 40, style: { width: 400, height: 160 } },
          rows(100),
        ),
    })
    const app = createTestApp(App)
    await app.settle()
    const list = app.renderer.findByType("virtual-list")[0]!

    // The third element is the list's viewport height (the style height).
    app.renderer.scrollToItem(list.id, 50, 25)
    expect(app.renderer.getListScrollTop(list.id)).toEqual([50, 25, 160])
    expect(app.renderer.getPaintedText()).toContain("row-50")

    // 100px above row 50: layout walks up over rows 49..47 (40px each) and
    // lands 20px into row 47.
    app.renderer.scrollToItem(list.id, 50, -100)
    expect(app.renderer.getListScrollTop(list.id)).toEqual([47, 20, 160])
    const painted = app.renderer.getPaintedText()
    expect(painted).toContain("row-47")
    expect(painted).toContain("row-50")

    // Walking past the first row clamps at the very top.
    app.renderer.scrollToItem(list.id, 1, -400)
    expect(app.renderer.getListScrollTop(list.id)).toEqual([0, 0, 160])

    // A plain div is not a virtual list and has no logical anchor.
    const row = app.renderer.findByText("row-0")
    expect(row).toBeDefined()
    expect(app.renderer.getListScrollTop(row!.id)).toBeNull()
    app.unmount()
  })
})

/// Mock-renderer tests for the imperative surface exposed through a template
/// ref: the element id, window widening on scrollToItem, and the at-end
/// sentinel decode in getListScrollTop.
describe("virtual-list imperative api", () => {
  class ScrollMockRenderer extends MockRenderer {
    scrolls: Array<[number, number, number | undefined]> = []
    top: [number, number, number] | null = null
    scrollToItem(elementId: number, index: number, offsetInItem?: number): void {
      this.scrolls.push([elementId, index, offsetInItem])
    }
    getListScrollTop(): Array<number> | null {
      return this.top
    }
  }

  function mountList() {
    const mock = new ScrollMockRenderer()
    const host = createGpuivRendererHost(mock, { nextElementId: 0 })
    const instance = ref<VirtualListInstance | null>(null)
    const Comp = defineComponent({
      setup() {
        return () =>
          h(VirtualList, {
            ref: instance,
            itemCount: 100,
            estimatedItemHeight: 40,
            overdraw: 100,
            renderItem: (i: number) => h("text", `row${i}`),
          })
      },
    })
    const app = host.vue.createApp(Comp as never)
    app.provide(GPUIV_CONTEXT, { renderer: host.renderer })
    app.mount(host.container)
    host.flushMutations()
    return { mock, host, app, instance }
  }

  it("exposes the host element id", () => {
    const { mock, instance } = mountList()
    expect(instance.value?.id).toBe(listId(mock.applied))
  })

  it("widens the mounted window before scrolling to a far row", async () => {
    const { mock, host, instance } = mountList()
    // Initial window = ceil((800 + 200) / 40) = 25 rows.
    const id = instance.value!.id
    mock.applied.length = 0

    instance.value!.scrollToItem(60)
    await nextTick()
    host.flushMutations()

    // Window widened to cover [0, 86) — the union of the current window and
    // the target's padded range [35, 86). Rows 0..24 were already mounted, so
    // the patch mounts the 61 new rows up to row85.
    const texts = mock.applied.filter((o) => o[0] === "setText").map((o) => o[2] as string)
    expect(texts.length).toBe(61)
    expect(texts[0]).toBe("row25")
    expect(texts.at(-1)).toBe("row85")
    expect(mock.scrolls).toEqual([[id, 60, undefined]])

    instance.value!.scrollToItem(60, -100)
    expect(mock.scrolls.at(-1)).toEqual([instance.value!.id, 60, -100])
  })

  it("decodes the at-end sentinel in getListScrollTop", () => {
    const { mock, instance } = mountList()
    mock.top = null
    expect(instance.value!.getListScrollTop()).toBeNull()

    mock.top = [100, 0, 160]
    expect(instance.value!.getListScrollTop()).toEqual({
      itemIndex: 100,
      offsetInItem: 0,
      viewportHeight: 160,
      atEnd: true,
    })

    mock.top = [42, 7, 160]
    expect(instance.value!.getListScrollTop()).toEqual({
      itemIndex: 42,
      offsetInItem: 7,
      viewportHeight: 160,
      atEnd: false,
    })
  })
})

