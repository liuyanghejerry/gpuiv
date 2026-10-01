/** Windowed wrapper around the native `<virtual-list>` element. */

import { computed, defineComponent, h, ref, watch, type PropType, type VNodeChild } from "vue"
import type { EventPayload } from "@gpuiv/native"
import type { HostNode, VirtualListProps } from "../types.js"
import { useGpuix } from "../hooks/use-gpuix.js"

/** Windowed mode: `itemCount` requires `estimatedItemHeight` for unmounted rows. */
export type WindowedVirtualListProps = Extract<VirtualListProps, { itemCount: number }> & {
  renderItem: (index: number) => unknown
}

/** Sticky-header props, shared by the windowed wrapper. `stickyIndices` are
 *  logical indices of section header rows, ascending. */
export type StickyHeaderProps = {
  /** Logical indices of section header rows, ascending. */
  stickyIndices?: number[]
  /** Content for the pinned overlay; defaults to `renderItem(index)`. The
   *  content must paint its own opaque background — rows scroll beneath it. */
  renderStickyHeader?: (index: number) => unknown
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
  inheritAttrs: false,
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
    stickyIndices: { type: Array as PropType<number[]>, default: undefined },
    renderStickyHeader: {
      type: Function as PropType<(index: number) => unknown>,
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

    // A short list can grow without changing its visible range in GPUI: the
    // newly appended rows are still inside the viewport, but were outside our
    // initial mounted window. Fill the existing window up to its bounded
    // overdraw budget before committing the new count.
    watch(() => props.itemCount, (count, previous) => {
      const current = range.value
      if (count > previous && current.end === previous) {
        const capacity = computePad(props.overdraw, props.estimatedItemHeight) * 2
        range.value = { start: current.start, end: Math.max(current.end, Math.min(count, current.start + capacity)) }
      }
    }, { flush: "sync" })

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

    // ── Sticky section header ─────────────────────────────────────────
    //
    // The pinned header is an overlay sibling painted after the list (gpui's
    // draw order is insertion order for overlapping bounds), with
    // a pass-through subtree so the wheel, selection, and clicks reach the
    // list beneath even when header children paint solid backgrounds. Which
    // section is pinned comes from the renderer's
    // geometry query: a header whose row top is above the viewport top — or
    // whose index sits above the scroll anchor — is pinned.
    const activeSticky = ref<number | null>(null)

    function updateSticky(): void {
      const indices = props.stickyIndices
      if (!indices?.length) {
        activeSticky.value = null
        return
      }
      const id = root.value?.id
      if (id == null) return
      const renderer = gpuix.renderer
      if (!renderer?.getVirtualListGeometry) return
      let active: number | null = null
      for (const index of indices) {
        const geo = renderer.getVirtualListGeometry(id, index)
        if (!geo || geo.length < 5) continue
        const anchorIndex = geo[0]
        const viewportTop = geo[2]
        if (geo.length >= 9) {
          const itemTop = geo[6]
          // At or below the viewport top: the row shows in place, and every
          // later header is further down — stop.
          if (itemTop < viewportTop - 0.5) {
            active = index
          } else {
            break
          }
        } else if (index < anchorIndex) {
          // Above the anchor item, so fully above the viewport top.
          active = index
        } else {
          // At or below the anchor but unmeasured: below the viewport.
          break
        }
      }
      activeSticky.value = active
    }

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
      updateSticky()
      props.onVisibleRange?.(event)
    }

    // `defineExpose` is an SFC-compiler macro; in a plain setup() the setup
    // context's `expose()` is the runtime form.
    expose({
      id: computed(() => root.value?.id ?? undefined),
      scrollToItem,
      getListScrollTop,
      getActiveStickyIndex: () => activeSticky.value,
    })

    return () => {
      const start = Math.min(range.value.start, props.itemCount)
      const end = Math.min(range.value.end, props.itemCount)
      const windowChildren = Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
        props.renderItem(start + offset) as unknown as VNodeChild,
      )
      const list = h(
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
      if (!props.stickyIndices?.length) {
        return list
      }
      // With sticky headers the component renders a relative wrapper so the
      // pinned overlay can sit exactly over the list. The overlay paints
      // after the list (gpui draws later overlapping bounds on top) and
      // inserts no blocking hitbox, so wheel, selection, and clicks pass through.
      const pinned = activeSticky.value
      return h("div", { style: { position: "relative", display: "flex", flex: 1, minHeight: 0 } }, [
        list,
        pinned == null
          ? null
          : h(
              "div",
              {
                // Unlike CSS pointer-events, GPUIV's pointerEvents does not
                // inherit. The native build uses this marker to keep every
                // host descendant visual-only, including component output.
                __gpuivPassThrough: true,
                style: {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  pointerEvents: "none",
                },
              },
              [
                (props.renderStickyHeader
                  ? props.renderStickyHeader(pinned)
                  : props.renderItem(pinned)) as unknown as VNodeChild,
              ],
            ),
      ])
    }
  },
})
