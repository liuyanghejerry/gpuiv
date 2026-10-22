/// Headless top-up tests for the VirtualList wrapper's pure logic: initial
/// window selection (alignment/pad maths), visibleRange handling with missing
/// indices, window clamping when the count shrinks, scrollToItem's no-widen
/// and no-support paths, and the sticky-header geometry loop driven through
/// a stubbed getVirtualListGeometry. Complements virtual-list.test.tsx.

import { defineComponent, h, nextTick, ref } from "vue"
import { describe, expect, it } from "vitest"
import { VirtualList } from "../components/virtual-list.js"
import type { VirtualListInstance } from "../components/virtual-list.js"
import { HeadlessRenderer } from "./headless.js"
import { mountWithRenderer } from "./custom-renderer-mount.js"

type Mount = ReturnType<typeof mountWithRenderer>

function customProp<T = unknown>(renderer: HeadlessRenderer, id: number, key: string): T | undefined {
  const ops = renderer.opsOf("setCustomProp").filter((op) => op[1] === id && op[2] === key)
  return ops.length ? (ops[ops.length - 1]![3] as T) : undefined
}

function listIdOf(renderer: HeadlessRenderer): number {
  const op = renderer.opsOf("createElement").find((o) => o[2] === "virtual-list")
  if (!op) throw new Error("no virtual-list element")
  return op[1] as number
}

function mountedTexts(renderer: HeadlessRenderer): string[] {
  return renderer
    .opsOf("setText")
    .map((op) => op[1] as number)
    .filter((id) => !renderer.destroyedIds.has(id))
    .map((id) => renderer.textOf(id) as string)
}

interface MountOptions {
  itemCount: number
  stickyIndices?: number[]
  renderStickyHeader?: (index: number) => unknown
  onVisibleRange?: (event: unknown) => void
  overdraw?: number
  estimatedItemHeight?: number
  alignment?: "top" | "bottom"
  followTail?: boolean
}

function mountList(options: MountOptions, renderer: HeadlessRenderer = new HeadlessRenderer()) {
  const instance = ref<VirtualListInstance | null>(null)
  const count = ref(options.itemCount)
  const mounted = mountWithRenderer(
    defineComponent({
      setup: () => () =>
        h(VirtualList, {
          ref: instance,
          itemCount: count.value,
          renderItem: (index: number) => h("text", `row${index}`),
          ...(options.overdraw === undefined ? {} : { overdraw: options.overdraw }),
          estimatedItemHeight: options.estimatedItemHeight ?? 40,
          ...(options.alignment === undefined ? {} : { alignment: options.alignment }),
          ...(options.followTail === undefined ? {} : { followTail: options.followTail }),
          ...(options.stickyIndices === undefined ? {} : { stickyIndices: options.stickyIndices }),
          ...(options.renderStickyHeader === undefined
            ? {}
            : { renderStickyHeader: options.renderStickyHeader }),
          ...(options.onVisibleRange === undefined ? {} : { onVisibleRange: options.onVisibleRange }),
        }),
    }),
    renderer
  )
  return { mounted, renderer, instance, count }
}

async function settle(mount: Mount) {
  await mount.settle()
}

describe("virtual-list initial window (logic)", () => {
  it("starts at the tail with alignment bottom", () => {
    const { renderer } = mountList({ itemCount: 100, alignment: "bottom", overdraw: 100 })
    const id = listIdOf(renderer)
    expect(customProp(renderer, id, "windowStart")).toBe(75)
    expect(mountedTexts(renderer)[0]).toBe("row75")
    expect(customProp(renderer, id, "alignment")).toBe("bottom")
  })

  it("uses the default overdraw of 240 for the pad", () => {
    // pad = ceil((800 + 2*240) / 40) = 32 rows.
    const { renderer } = mountList({ itemCount: 100 })
    const texts = mountedTexts(renderer)
    expect(texts).toHaveLength(32)
    expect(texts[0]).toBe("row0")
    expect(texts.at(-1)).toBe("row31")
  })

  it("clamps the pad to a minimum of two rows", () => {
    const { renderer } = mountList({ itemCount: 10, estimatedItemHeight: 1000, overdraw: 0 })
    expect(mountedTexts(renderer)).toEqual(["row0", "row1"])
  })
})

describe("virtual-list visibleRange handling (logic)", () => {
  it("treats missing startIndex and endIndex as zero", async () => {
    const { mounted, renderer } = mountList({ itemCount: 100, followTail: true, overdraw: 100 })
    const id = listIdOf(renderer)
    expect(customProp(renderer, id, "windowStart")).toBe(75)

    renderer.ops.length = 0
    mounted.dispatch({ elementId: id, eventType: "visibleRange" })
    await settle(mounted)
    expect(customProp(renderer, id, "windowStart")).toBe(0)
    expect(mountedTexts(renderer)[0]).toBe("row0")
  })

  it("skips the re-window when the range already matches, but still reports", async () => {
    const onVisibleRange = (event: unknown) => events.push(event)
    const events: unknown[] = []
    const { mounted, renderer } = mountList({
      itemCount: 100,
      overdraw: 100,
      onVisibleRange: onVisibleRange as never,
    })
    const id = listIdOf(renderer)
    mounted.dispatch({ elementId: id, eventType: "visibleRange", startIndex: 0, endIndex: 5 })
    await settle(mounted)
    renderer.ops.length = 0

    mounted.dispatch({ elementId: id, eventType: "visibleRange", startIndex: 0, endIndex: 5 })
    await settle(mounted)
    // No new rows mounted (identical window), no windowStart resend.
    expect(renderer.opsOf("setText")).toHaveLength(0)
    expect(renderer.opsOf("setCustomProp").filter((op) => op[2] === "windowStart")).toHaveLength(0)
    expect(events).toHaveLength(2)
  })

  it("clamps the mounted window when the item count shrinks", async () => {
    const { mounted, renderer, count } = mountList({ itemCount: 100, overdraw: 100 })
    expect(mountedTexts(renderer)).toHaveLength(25)

    count.value = 5
    await settle(mounted)
    // The extra 20 rows unmount; nothing new mounts; windowStart is not moved.
    expect(renderer.opsOf("destroyElement")).toHaveLength(20)
    expect(customProp(renderer, listIdOf(renderer), "windowStart")).toBe(0)
    expect(mountedTexts(renderer)).toEqual(["row0", "row1", "row2", "row3", "row4"])
  })
})

describe("virtual-list scrollToItem (logic)", () => {
  it("scrolls without widening when the padded target fits the window", async () => {
    const scrolls: Array<[number, number, number | undefined]> = []
    class ScrollRecorder extends HeadlessRenderer {
      scrollToItem(elementId: number, index: number, offsetInItem?: number): void {
        scrolls.push([elementId, index, offsetInItem])
      }
    }
    const renderer = new ScrollRecorder()
    const { mounted, instance } = mountList(
      { itemCount: 2, overdraw: 0, estimatedItemHeight: 400 },
      renderer
    )
    const id = instance.value!.id!
    renderer.ops.length = 0

    instance.value!.scrollToItem(1)
    await settle(mounted)
    // pad = 2, window [0,2): target range [0,2) — no new setText ops.
    expect(renderer.opsOf("setText")).toHaveLength(0)
    expect(scrolls).toEqual([[id, 1, undefined]])

    instance.value!.scrollToItem(0, -20)
    expect(scrolls.at(-1)).toEqual([id, 0, -20])
    mounted.unmount()
  })

  it("throws without a renderer-side scrollToItem", () => {
    const { instance } = mountList({ itemCount: 10, overdraw: 0, estimatedItemHeight: 400 })
    expect(() => instance.value!.scrollToItem(0)).toThrow(
      /requires a renderer with scrollToItem support/
    )
  })
})

describe("virtual-list sticky headers (logic)", () => {
  type Geometry = Array<number | null> | undefined

  function mountSticky(
    geometry: (index: number) => Geometry,
    options: Partial<MountOptions> = {}
  ) {
    class GeometryRenderer extends HeadlessRenderer {
      getVirtualListGeometry(_elementId: number, index: number): Array<number> | null {
        const geo = geometry(index)
        return (geo as Array<number> | null) ?? null
      }
    }
    const renderer = new GeometryRenderer()
    const pinned = mountList(
      {
        itemCount: 30,
        overdraw: 0,
        estimatedItemHeight: 400,
        stickyIndices: [0, 10, 20],
        ...options,
      },
      renderer
    )
    return { ...pinned, pinnedId: () => listIdOf(renderer) }
  }

  const overlayId = (renderer: HeadlessRenderer): number | undefined => {
    const op = renderer.opsOf("setCustomProp").find((o) => o[2] === "__gpuivPassThrough")
    return op ? (op[1] as number) : undefined
  }

  /** The text painted inside the pinned overlay (a text element wraps its
   *  string child in a #text node, so look one level down). */
  const overlayText = (renderer: HeadlessRenderer): string | undefined => {
    const overlay = overlayId(renderer)
    if (overlay === undefined) return undefined
    const inner = renderer.childrenOf(overlay)[0]!
    return renderer.textOf(renderer.childrenOf(inner)[0] ?? inner)
  }

  it("wraps the list in a relative div only when sticky indices exist", () => {
    const { mounted, renderer } = mountList({ itemCount: 10, overdraw: 0, estimatedItemHeight: 400 })
    expect(renderer.parentOf(listIdOf(renderer))).toBe(mounted.container.id ?? undefined)
    mounted.unmount()

    const sticky = mountSticky(() => undefined)
    expect(sticky.renderer.parentOf(listIdOf(sticky.renderer))).not.toBe(
      sticky.mounted.container.id ?? undefined
    )
    sticky.mounted.unmount()
  })

  it("pins the last header whose row top is above the viewport top", async () => {
    // viewport top = geo[2] = 100; header 0 sits at y=20 (above), header 10
    // at y=150 (below): the loop stops after header 10.
    const { mounted, renderer, pinnedId } = mountSticky((index) =>
      index === 0
        ? [15, 0, 100, 400, 160, 0, 20, 40, 40]
        : index === 10
          ? [15, 0, 100, 400, 160, 0, 150, 40, 40]
          : undefined
    )
    mounted.dispatch({ elementId: pinnedId(), eventType: "visibleRange", startIndex: 0, endIndex: 1 })
    await settle(mounted)

    expect(overlayId(renderer)).toBeDefined()
    // Default pinned content falls back to renderItem.
    expect(overlayText(renderer)).toBe("row0")
    mounted.unmount()
  })

  it("pins via the short-geometry anchor form when the item is unmeasured", async () => {
    // geo.length < 9: a header index below the anchor item is above the fold.
    const { mounted, renderer, pinnedId } = mountSticky((index) =>
      index === 0 ? [5, 0, 100, 400, 160] : index === 10 ? [15, 0, 100, 400, 160] : undefined
    )
    mounted.dispatch({ elementId: pinnedId(), eventType: "visibleRange", startIndex: 0, endIndex: 1 })
    await settle(mounted)
    expect(overlayText(renderer)).toBe("row10")
    mounted.unmount()
  })

  it("skips malformed and missing geometry entries", async () => {
    const { mounted, renderer, pinnedId } = mountSticky((index) =>
      index === 0 ? [1, 2] : index === 10 ? [15, 0, 100, 400, 160] : undefined
    )
    mounted.dispatch({ elementId: pinnedId(), eventType: "visibleRange", startIndex: 0, endIndex: 1 })
    await settle(mounted)
    expect(overlayText(renderer)).toBe("row10")
    mounted.unmount()
  })

  it("renders a custom pinned header through renderStickyHeader", async () => {
    const { mounted, renderer, pinnedId } = mountSticky(
      (index) => (index === 0 ? [15, 0, 100, 400, 160, 0, 20, 40, 40] : undefined),
      { renderStickyHeader: (index: number) => h("text", `pinned-${index}`) }
    )
    mounted.dispatch({ elementId: pinnedId(), eventType: "visibleRange", startIndex: 0, endIndex: 1 })
    await settle(mounted)
    expect(overlayText(renderer)).toBe("pinned-0")
    // The overlay paints after the list and passes pointer events through.
    expect(renderer.lastStyle(overlayId(renderer)!)).toMatchObject({
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      pointerEvents: "none",
    })
    mounted.unmount()
  })

  it("unpins when no header is above the viewport top", async () => {
    const { mounted, renderer, pinnedId } = mountSticky((index) =>
      index === 0 ? [0, 0, 100, 400, 160, 0, 120, 40, 40] : undefined
    )
    mounted.dispatch({ elementId: pinnedId(), eventType: "visibleRange", startIndex: 0, endIndex: 1 })
    await settle(mounted)
    expect(overlayId(renderer)).toBeUndefined()
    mounted.unmount()
  })

  it("leaves the pin untouched when the renderer has no geometry query", async () => {
    const { mounted, renderer } = mountList({
      itemCount: 30,
      overdraw: 0,
      estimatedItemHeight: 400,
      stickyIndices: [0, 10, 20],
    })
    const id = listIdOf(renderer)
    mounted.dispatch({ elementId: id, eventType: "visibleRange", startIndex: 0, endIndex: 1 })
    await settle(mounted)
    expect(overlayId(renderer)).toBeUndefined()
    expect(mountedTexts(renderer).length).toBeGreaterThan(0)
    mounted.unmount()
  })

  it("clears an active pin when the sticky indices disappear", async () => {
    const stickyIndices = ref<number[] | undefined>([0, 10, 20])
    class GeometryRenderer extends HeadlessRenderer {
      getVirtualListGeometry(): Array<number> | null {
        return [15, 0, 100, 400, 160, 0, 20, 40, 40]
      }
    }
    const renderer = new GeometryRenderer()
    const instance = ref<VirtualListInstance | null>(null)
    const mounted = mountWithRenderer(
      defineComponent({
        setup: () => () =>
          h(VirtualList, {
            ref: instance,
            itemCount: 30,
            estimatedItemHeight: 400,
            overdraw: 0,
            stickyIndices: stickyIndices.value,
            renderItem: (index: number) => h("text", `row${index}`),
          }),
      }),
      renderer
    )
    const id = listIdOf(renderer)
    mounted.dispatch({ elementId: id, eventType: "visibleRange", startIndex: 0, endIndex: 1 })
    await settle(mounted)
    // Every header answers "above the viewport top": the last one pins.
    expect(instance.value!.getActiveStickyIndex()).toBe(20)

    stickyIndices.value = undefined
    await settle(mounted)
    // The active pin is recomputed on the next geometry-driven update.
    mounted.dispatch({ elementId: id, eventType: "visibleRange", startIndex: 0, endIndex: 1 })
    await settle(mounted)
    expect(instance.value!.getActiveStickyIndex()).toBeNull()
    mounted.unmount()
  })
})

describe("virtual-list exposed surface (logic)", () => {
  it("reports null before the renderer answers getListScrollTop", () => {
    const { instance } = mountList({ itemCount: 10, overdraw: 0, estimatedItemHeight: 400 })
    expect(instance.value!.getListScrollTop()).toBeNull()
    expect(instance.value!.getActiveStickyIndex()).toBeNull()
  })
})
