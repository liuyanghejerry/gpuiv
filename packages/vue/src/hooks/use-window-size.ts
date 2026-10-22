import { onBeforeUnmount, onMounted, shallowRef, type Ref } from "vue"
import { useGpuix } from "./use-gpuix.js"
import type { EdgeInsets, NativeRenderer, NativeWindowInsets } from "../types.js"

export interface WindowSize {
  width: number
  height: number
}

/** Fallback until the window answers. Only used if the renderer has no size yet. */
const DEFAULT_WINDOW_SIZE: WindowSize = { width: 800, height: 600 }

function readWindowSize(renderer: ReturnType<typeof useGpuix>["renderer"]): WindowSize {
  try {
    const size = renderer?.getWindowSize?.()
    if (size && size.width > 0 && size.height > 0) {
      return { width: size.width, height: size.height }
    }
  } catch {
    // Renderer window is still opening.
  }
  return DEFAULT_WINDOW_SIZE
}

export interface WindowSizeOptions {
  /** Poll interval in milliseconds. Defaults to 100. Set false for one read. */
  intervalMs?: number | false
}

interface WindowSizePoll {
  latest: WindowSize
  subscribers: Set<Ref<WindowSize>>
  timer: ReturnType<typeof setInterval> | null
}

// A window has one size. Components with the same sampling cadence share a
// native query and Vue flush, while retaining independent writable refs.
const sizePolls = new WeakMap<NativeRenderer, Map<number, WindowSizePoll>>()

/**
 * The current window size, sampled every 100ms by default. Subscribers on the
 * same renderer and interval share one poll, including the initial reading.
 *
 * It polls rather than reading once, for the same reason `useWindowInsets`
 * does: the first read can land before the platform window has a size, and a
 * value that stays at the fallback forever is far worse than a late one. Code
 * that converts a mouse position into layout coordinates silently points at
 * the wrong row when this number is stale.
 */
export function useWindowSize(options: WindowSizeOptions = {}): Ref<WindowSize> {
  const { renderer } = useGpuix()
  const intervalMs = options.intervalMs ?? 100
  if (renderer?.getWindowSize && intervalMs !== false) {
    const cadence = Math.max(16, intervalMs)
    let groups = sizePolls.get(renderer)
    if (!groups) {
      groups = new Map()
      sizePolls.set(renderer, groups)
    }
    let poll = groups.get(cadence)
    if (!poll) {
      poll = { latest: readWindowSize(renderer), subscribers: new Set(), timer: null }
      groups.set(cadence, poll)
    }
    const group = poll
    const size = shallowRef<WindowSize>({ ...group.latest })
    const update = () => {
      group.latest = readWindowSize(renderer)
      for (const subscriber of group.subscribers) {
        if (subscriber.value.width !== group.latest.width || subscriber.value.height !== group.latest.height) {
          subscriber.value = { ...group.latest }
        }
      }
    }
    onMounted(() => {
      // The first mount retries a setup-time fallback; further mounts reuse
      // the same reading and do not serialize another UI-thread query.
      group.subscribers.add(size)
      if (group.timer === null) {
        groups.set(cadence, group)
        update()
        group.timer = setInterval(update, cadence)
      } else {
        if (size.value.width !== group.latest.width || size.value.height !== group.latest.height) {
          size.value = { ...group.latest }
        }
      }
    })
    onBeforeUnmount(() => {
      group.subscribers.delete(size)
      if (group.subscribers.size === 0) {
        if (group.timer !== null) clearInterval(group.timer)
        group.timer = null
        if (groups.get(cadence) === group) groups.delete(cadence)
      }
    })
    return size
  }
  // Fallback path: the renderer cannot report a size, or the caller passed
  // `intervalMs: false` for a one-shot read. Either way there is nothing to
  // poll — re-read once on mount in case the window opened after setup.
  const size = shallowRef<WindowSize>(readWindowSize(renderer))
  onMounted(() => {
    const next = readWindowSize(renderer)
    if (next.width !== size.value.width || next.height !== size.value.height) {
      size.value = next
    }
  })
  return size
}

export interface WindowInsets extends NativeWindowInsets {
  /** Y coordinate where unobscured content ends. Equals window height when closed. */
  keyboardTop: number
  keyboardVisible: boolean
  visibleHeight: number
}

export interface WindowInsetsOptions {
  /** Poll interval in milliseconds. Defaults to 100. Set false for one read. */
  intervalMs?: number | false
}

const ZERO_EDGES: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 }

function readWindowInsets(renderer: ReturnType<typeof useGpuix>["renderer"]): WindowInsets {
  let size = { width: 800, height: 600 }
  let insets: NativeWindowInsets = {
    safeArea: ZERO_EDGES,
    ime: ZERO_EDGES,
    effective: ZERO_EDGES,
  }
  try {
    size = renderer?.getWindowSize?.() ?? size
    insets = renderer?.getWindowInsets?.() ?? insets
  } catch {
    // Renderer window is still opening.
  }
  return {
    ...insets,
    keyboardTop: size.height - insets.ime.bottom,
    keyboardVisible: insets.ime.bottom > 0,
    visibleHeight: size.height - insets.effective.top - insets.effective.bottom,
  }
}

function sameWindowInsets(a: WindowInsets, b: WindowInsets): boolean {
  return (
    a.keyboardTop === b.keyboardTop &&
    a.keyboardVisible === b.keyboardVisible &&
    a.visibleHeight === b.visibleHeight &&
    a.safeArea.top === b.safeArea.top &&
    a.safeArea.right === b.safeArea.right &&
    a.safeArea.bottom === b.safeArea.bottom &&
    a.safeArea.left === b.safeArea.left &&
    a.ime.top === b.ime.top &&
    a.ime.right === b.ime.right &&
    a.ime.bottom === b.ime.bottom &&
    a.ime.left === b.ime.left
  )
}

/**
 * Safe-area and software-keyboard geometry, sampled every 100ms by default.
 * Pull-based, not event-driven: an animating keyboard cannot flood Vue with
 * renders, and the ref only updates when the numbers actually change.
 */
export function useWindowInsets(options: WindowInsetsOptions = {}): Ref<WindowInsets> {
  const { renderer } = useGpuix()
  const insets = shallowRef<WindowInsets>(readWindowInsets(renderer))
  const intervalMs = options.intervalMs ?? 100
  let timer: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    const update = () => {
      const next = readWindowInsets(renderer)
      if (!sameWindowInsets(insets.value, next)) {
        insets.value = next
      }
    }
    update()
    if (intervalMs === false) return
    timer = setInterval(update, Math.max(16, intervalMs))
  })

  onBeforeUnmount(() => {
    if (timer !== null) clearInterval(timer)
  })

  return insets
}
