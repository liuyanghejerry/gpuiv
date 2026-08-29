/** Windowed wrapper around the native `<virtual-list>` element. */

import { computed, defineComponent, h, ref, type PropType, type VNodeChild } from "vue"
import type { EventPayload } from "@gpuiv/native"
import type { HostNode, VirtualListProps } from "../types.js"
import { useGpuix } from "../hooks/use-gpuix.js"

/** Windowed mode: `itemCount` requires `estimatedItemHeight` for unmounted rows. */
export type WindowedVirtualListProps = Extract<VirtualListProps, { itemCount: number }> & {
  renderItem: (index: number) => unknown
}

/** The logical scroll anchor of a virtual list, as gpui itself scrolls by it. */
export interface VirtualListScrollTop {
  /** Index of the item the viewport top is anchored on. */
  itemIndex: number
  /** Pixel offset of the viewport top into that item; may be negative. */
  offsetInItem: number
  /** Viewport height in pixels. */
  viewportHeight: number
  /** gpui's at-end sentinel: the list rests at its very end
   *  (`itemIndex == itemCount`). The sentinel-to-pixel conversion is
   *  app knowledge (it depends on the trailing edge height), so it stays
   *  with the caller. */
  atEnd: boolean
}

/** Imperative surface of `<VirtualList>`, reached through a template ref. */
export interface VirtualListInstance {
  /** Host element id — for direct `renderer` calls and automation. */
  readonly id: number | undefined
  /** Scroll to a row by global index. `offsetInItem` is in pixels and may be
   *  negative, which anchors the viewport top above the item — the
   *  pixel-stable restore primitive. Widens the mounted window to cover the
   *  target before the scroll lands. */
  scrollToItem(index: number, offsetInItem?: number): void
  /** The list's logical scroll anchor, or null before mount. */
  getListScrollTop(): VirtualListScrollTop | null
}

function computePad(overdraw: number | undefined, estimatedItemHeight: number | undefined): number {
  return Math.max(
    2,
    Math.ceil((800 + (overdraw ?? 240) * 2) / Math.max(1, estimatedItemHeight ?? 48)),
  )
}

function initialWindow(options: {
  itemCount: number
  pad: number
  alignment: WindowedVirtualListProps["alignment"]
  followTail: boolean | undefined
}): { start: number; end: number } {
  if (options.followTail || options.alignment === "bottom") {
    return { start: Math.max(0, options.itemCount - options.pad), end: options.itemCount }
  }
  return { start: 0, end: Math.min(options.itemCount, options.pad) }
}

/** Mounts only the visible window of a virtual list in the component tree. */
export const VirtualList = defineComponent({
  props: {
    itemCount: { type: Number, required: true },
    renderItem: { type: Function as PropType<(index: number) => unknown>, required: true },
    estimatedItemHeight: { type: Number, required: true },
    overdraw: { type: Number, default: 240 },
    alignment: { type: String as PropType<"top" | "bottom">, default: undefined },
    followTail: { type: Boolean, default: undefined },
    onVisibleRange: {
      type: Function as PropType<(event: EventPayload) => void>,
      default: undefined,
    },
  },
  setup(props, { attrs, expose }) {
    const gpuix = useGpuix()
    const root = ref<HostNode | null>(null)
    const range = ref(
      initialWindow({
        itemCount: props.itemCount,
        pad: computePad(props.overdraw, props.estimatedItemHeight),
        alignment: props.alignment,
        followTail: props.followTail,
      }),
    )

    const handleRange = (
      event: EventPayload & { startIndex?: number | null; endIndex?: number | null },
    ): void => {
      const pad = computePad(props.overdraw, props.estimatedItemHeight)
      const next = {
        start: Math.max(0, Math.floor(event.startIndex ?? 0) - pad),
        end: Math.min(props.itemCount, Math.ceil(event.endIndex ?? 0) + pad),
      }
      const current = range.value
      if (current.start !== next.start || current.end !== next.end) {
        range.value = next
      }
      props.onVisibleRange?.(event)
    }

    function scrollToItem(index: number, offsetInItem?: number): void {
      const id = root.value?.id
      if (id == null) {
        throw new Error("VirtualList.scrollToItem() called before the list is mounted")
      }
      const renderer = gpuix.renderer
      if (!renderer?.scrollToItem) {
        throw new Error(
          "VirtualList.scrollToItem() requires a renderer with scrollToItem support",
        )
      }
      // Widen the mounted window so the target row is committed before the
      // frame the queued scroll lands on: native applies the scroll after
      // that frame's child splice, so the window change and the scroll ride
      // the same commit and the row exists when gpui anchors on it.
      const pad = computePad(props.overdraw, props.estimatedItemHeight)
      const start = Math.max(0, index - pad)
      const end = Math.min(props.itemCount, index + 1 + pad)
      const current = range.value
      if (start < current.start || end > current.end) {
        range.value = {
          start: Math.min(current.start, start),
          end: Math.max(current.end, end),
        }
      }
      renderer.scrollToItem(id, index, offsetInItem)
    }

    function getListScrollTop(): VirtualListScrollTop | null {
      const id = root.value?.id
      if (id == null) return null
      const top = gpuix.renderer?.getListScrollTop?.(id)
      if (!top) return null
      return {
        itemIndex: top[0],
        offsetInItem: top[1],
        viewportHeight: top[2],
        atEnd: top[0] >= props.itemCount,
      }
    }

    // `defineExpose` is an SFC-compiler macro; in a plain setup() the setup
    // context's `expose()` is the runtime form.
    expose({
      id: computed(() => root.value?.id ?? undefined),
      scrollToItem,
      getListScrollTop,
    })

    return () => {
      const start = Math.min(range.value.start, props.itemCount)
      const end = Math.min(range.value.end, props.itemCount)
      const windowChildren = Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
        props.renderItem(start + offset) as unknown as VNodeChild,
      )
      return h(
        "virtual-list",
        {
          ref: root,
          ...attrs,
          alignment: props.alignment,
          followTail: props.followTail,
          estimatedItemHeight: props.estimatedItemHeight,
          overdraw: props.overdraw,
          itemCount: props.itemCount,
          windowStart: range.value.start,
          onVisibleRange: handleRange,
        },
        windowChildren,
      )
    }
  },
})
