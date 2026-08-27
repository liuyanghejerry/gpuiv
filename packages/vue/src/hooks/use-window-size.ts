import { onBeforeUnmount, onMounted, shallowRef, type Ref } from "vue"
import { useGpuix } from "./use-gpuix.js"
import type { EdgeInsets, NativeWindowInsets } from "../types.js"

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

/**
 * The current window size, sampled every 100ms by default.
 *
 * It polls rather than reading once, for the same reason `useWindowInsets`
 * does: the first read can land before the platform window has a size, and a
 * value that stays at the fallback forever is far worse than a late one. Code
 * that converts a mouse position into layout coordinates silently points at
 * the wrong row when this number is stale.
 */
export function useWindowSize(options: WindowSizeOptions = {}): Ref<WindowSize> {
  const { renderer } = useGpuix()
  const size = shallowRef<WindowSize>(readWindowSize(renderer))
  const intervalMs = options.intervalMs ?? 100
  let timer: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    const update = () => {
      const next = readWindowSize(renderer)
      if (next.width !== size.value.width || next.height !== size.value.height) {
        size.value = next
      }
    }
    update()
    if (intervalMs === false) return
    timer = setInterval(update, Math.max(16, intervalMs))
  })

  onBeforeUnmount(() => {
    if (timer !== null) clearInterval(timer)
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
