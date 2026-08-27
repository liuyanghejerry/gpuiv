/** Windowed wrapper around the native `<virtual-list>` element. */

import { defineComponent, h, ref, type PropType, type VNodeChild } from "vue"
import type { EventPayload } from "@gpuiv/native"
import type { VirtualListProps } from "../types.js"

/** Windowed mode: `itemCount` requires `estimatedItemHeight` for unmounted rows. */
export type WindowedVirtualListProps = Extract<VirtualListProps, { itemCount: number }> & {
  renderItem: (index: number) => unknown
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
  setup(props, { attrs }) {
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

    return () => {
      const start = Math.min(range.value.start, props.itemCount)
      const end = Math.min(range.value.end, props.itemCount)
      const windowChildren = Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
        props.renderItem(start + offset) as unknown as VNodeChild,
      )
      return h(
        "virtual-list",
        {
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
