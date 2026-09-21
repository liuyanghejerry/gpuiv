import { onBeforeUnmount, onMounted, shallowRef, type Ref, type ShallowRef } from "vue"
import { useGpuix } from "./use-gpuix.js"
import type { HostNode } from "../types.js"

export interface ElementBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ElementBoundsOptions {
  /** Poll interval in milliseconds. Defaults to 100. Set false to only
   *  measure once on mount and on every {@link measure} call. */
  intervalMs?: number | false
}

export interface ElementBoundsHandle {
  /** Last measured window-space bounds; null until the element has painted. */
  bounds: ShallowRef<ElementBounds | null>
  /** Query the renderer immediately and update {@link bounds}. */
  measure: () => ElementBounds | null
}

/**
 * Last painted window-space bounds of a host element, polled like
 * `useWindowSize`.
 *
 * Bounds are recorded by the native side during **paint**, so a brand-new or
 * just-moved element answers one frame late — polling absorbs that, the same
 * reason `useWindowSize` polls rather than reading once.
 *
 * ```tsx
 * const row = ref<HostNode | null>(null)
 * const { bounds } = useElementBounds(row)
 * // <div ref={row} … />
 * ```
 */
export function useElementBounds(
  target: Ref<HostNode | null | undefined>,
  options: ElementBoundsOptions = {}
): ElementBoundsHandle {
  const { renderer } = useGpuix()
  const bounds = shallowRef<ElementBounds | null>(null)
  const intervalMs = options.intervalMs ?? 100
  let timer: ReturnType<typeof setInterval> | null = null

  const measure = (): ElementBounds | null => {
    const id = target.value?.id
    if (id == null) return null
    let next: ElementBounds | null = null
    try {
      next = renderer?.getElementBounds?.(id) ?? null
    } catch {
      // Renderer is still opening; keep the previous reading.
      return bounds.value
    }
    const prev = bounds.value
    if (
      next !== null &&
      (prev === null ||
        next.x !== prev.x ||
        next.y !== prev.y ||
        next.width !== prev.width ||
        next.height !== prev.height)
    ) {
      bounds.value = next
    }
    return next
  }

  onMounted(() => {
    measure()
    if (intervalMs === false) return
    timer = setInterval(measure, Math.max(16, intervalMs))
  })

  onBeforeUnmount(() => {
    if (timer !== null) clearInterval(timer)
  })

  return { bounds, measure }
}
