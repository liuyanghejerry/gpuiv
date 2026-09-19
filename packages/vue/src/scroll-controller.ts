import { onBeforeUnmount } from "vue"
import type { NativeRenderer } from "./types.js"
import { useGpuixRequired } from "./hooks/use-gpuix.js"

export interface ScrollToOptions {
  /** GPUI offsets: scrolling down/right uses negative coordinates. */
  x?: number
  y?: number
  behavior?: "instant" | "smooth"
  /** Milliseconds, default 240. Use 0 for reduced motion. */
  duration?: number
  signal?: AbortSignal
}

export type ScrollResult = {
  status: "finished" | "cancelled" | "unavailable" | "timeout"
  /** Last observed native offset, including layout clamping. */
  offset: { x: number; y: number } | null
}

/** One controller per scroll owner. It never reads or modifies GPUI layout.
 * Completion observes stable native offsets after the last command; it is
 * NOT a platform scrollend event. Cancel on wheel/press to yield to the user.
 * Containers must already be mounted and painted before starting a request. */
export function createScrollController(
  renderer: Pick<NativeRenderer, "scrollTo" | "getScrollOffset">,
) {
  const pending = new Map<number, () => void>()
  let disposed = false

  function cancel(elementId?: number) {
    if (elementId !== undefined) pending.get(elementId)?.()
    else for (const stop of [...pending.values()]) stop()
  }

  function scrollTo(elementId: number, options: ScrollToOptions = {}): Promise<ScrollResult> {
    for (const value of [elementId, options.x, options.y, options.duration]) {
      if (value !== undefined && !Number.isFinite(value)) throw new TypeError("Scroll values must be finite")
    }
    if (elementId < 0 || !Number.isSafeInteger(elementId)) throw new RangeError("Invalid element id")
    if ((options.duration ?? 0) < 0) throw new RangeError("Scroll duration must be non-negative")
    cancel(elementId)
    const read = () => {
      const offset = renderer.getScrollOffset?.(elementId)
      return offset && offset.length >= 2 ? { x: offset[0], y: offset[1] } : null
    }
    if (disposed || options.signal?.aborted) return Promise.resolve({ status: "cancelled", offset: null })
    let from: { x: number; y: number } | null
    try { from = read() } catch (error) { return Promise.reject(error) }
    if (!renderer.scrollTo || !from) return Promise.resolve({ status: "unavailable", offset: from })
    const target = { x: options.x ?? from.x, y: options.y ?? from.y }
    const duration = options.behavior === "smooth" ? options.duration ?? 240 : 0

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let done = false
      let last = from
      let stable = 0
      const started = performance.now()
      let settlingSince: number | undefined
      const cleanup = () => {
        done = true
        clearTimeout(timer)
        pending.delete(elementId)
        options.signal?.removeEventListener("abort", stop)
      }
      const finish = (status: ScrollResult["status"], offset: ScrollResult["offset"] = last) => {
        if (done) return
        cleanup()
        resolve({ status, offset })
      }
      const stop = () => finish("cancelled")
      pending.set(elementId, stop)
      options.signal?.addEventListener("abort", stop, { once: true })
      const tick = () => {
        if (done) return
        try {
          const current = read()
          if (!current) return finish("unavailable", null)
          const now = performance.now()
          if (settlingSince !== undefined) {
            stable = Math.abs(current.x - last.x) < 0.1 && Math.abs(current.y - last.y) < 0.1 ? stable + 1 : 0
            last = current
            if (stable >= 3) return finish("finished")
            if (now - settlingSince >= 1000) return finish("timeout")
          } else {
            last = current
            const progress = duration === 0 ? 1 : Math.min(1, (now - started) / duration)
            const eased = 1 - (1 - progress) ** 3
            renderer.scrollTo!(elementId, from.x + (target.x - from.x) * eased, from.y + (target.y - from.y) * eased)
            if (progress === 1) settlingSince = now
          }
          timer = setTimeout(tick, 16)
        } catch (error) {
          cleanup()
          reject(error)
        }
      }
      tick()
    })
  }

  return { scrollTo, cancel, dispose() { disposed = true; cancel() } }
}

/** Component-scoped controller; unmount cancels every pending request. */
export function useScrollController() {
  const controller = createScrollController(useGpuixRequired())
  onBeforeUnmount(controller.dispose)
  return controller
}
